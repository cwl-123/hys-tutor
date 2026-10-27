import { readdir } from 'node:fs/promises'
import { dataPath, newId, nowIso, readJson, withLock, writeJson } from '../repo/json-store'
import { getLLM, getLLMModel, completeJson, completeText, effortParams } from '../llm/client'
import { recordLlmUsage } from './quota-service'
import { runAgent, type AgentTool } from '../agent/loop'
import { normalizeUrl, searchWeb } from '../agent/tools/web-search'
import { searchImages } from '../agent/tools/image-search'
import { fetchPage } from '../agent/tools/web-fetch'
import { notePatchSchema, readResearchNote, saveResearchNote } from '../agent/tools/notes'
import { appendTrace } from '../agent/tools/research-trace'
import { downloadImage, localizeImages } from './asset-store'
import { RESEARCH_SYSTEM_PROMPT, researchUserPrompt } from '../llm/prompts/research'
import {
  OUTLINE_SYSTEM_PROMPT,
  learnerContextText,
  llmOutlineSchema,
  outlineUserPrompt,
  type LlmOutline,
} from '../llm/prompts/outline'
import { WRITE_SYSTEM_PROMPT, REVISE_SYSTEM_PROMPT, writeLessonPrompt, reviseLessonPrompt } from '../llm/prompts/write'
import {
  SELFCHECK_SYSTEM_PROMPT,
  CORRECT_CONTENT_SYSTEM_PROMPT,
  CONTENT_CHECK_SYSTEM_PROMPT,
  llmSelfCheckSchema,
  llmContentCheckSchema,
  selfCheckPrompt,
  contentCheckPrompt,
  correctContentPrompt,
  type LlmSelfCheck,
} from '../llm/prompts/selfcheck'
import { QUIZ_SYSTEM_PROMPT, llmQuizSchema, quizPrompt } from '../llm/prompts/quiz'
import { TAUGHT_SYSTEM_PROMPT, llmTaughtSchema, taughtExtractPrompt } from '../llm/prompts/taught'
import { scheduleNext } from '../../shared/scheduler'
import { getGraph, getTopic } from './graph-service'
import { findLesson } from './lesson-service'
import { preferenceContextText } from './preference-service'
import { listTaught, recordTaught, taughtContextText } from './taught-service'
import { listAttempts } from './attempt-service'
import { MASTERY_UNLOCK_THRESHOLD } from '../../shared/types'
import { errMsg } from '../../shared/error'
import { partitionQuestionDrafts } from '../../shared/quiz-validate'
import { sanitizeCitations, stripTrailingSourceBlock } from '../../shared/lesson-md'
import type {
  ErrorReport,
  KnowledgeNode,
  Lesson,
  Question,
  QuestionSet,
  ResearchNote,
} from '../../shared/types'

export interface StageEvent {
  stage: string
  detail?: unknown
}
export type StageFn = (e: StageEvent) => void

interface LearnerContext {
  masterySnapshot: Record<string, number>
  wrongAnswers: string[]
  reports: ErrorReport[]
  nodeNames: Record<string, string>
  profileText: string
}

// 方向个性化设置文本：备课（大纲+写作）全程注入
function profileTextOf(profile?: { style?: string; level?: string; extra?: string }): string {
  if (!profile) return ''
  const lines: string[] = []
  if (profile.level) lines.push(`学习者当前程度：${profile.level}`)
  if (profile.style) lines.push(`偏好教学风格：${profile.style}`)
  if (profile.extra) lines.push(`用户额外要求：${profile.extra}`)
  return lines.length ? `方向个性化设置：\n- ${lines.join('\n- ')}` : ''
}

const WRONG_SCORE_THRESHOLD = 0.6

async function buildLearnerContext(topicId: string, nodes: KnowledgeNode[]): Promise<LearnerContext> {
  const nodeNames = Object.fromEntries(nodes.map((n) => [n.id, n.name]))
  const masterySnapshot = Object.fromEntries(nodes.map((n) => [n.id, n.mastery]))

  // 错题摘要：扫描历史 attempts，找判错/低分记录，回查题目信息
  const wrongAnswers: string[] = []
  const attemptsDir = dataPath('topics', topicId, 'attempts')
  let attemptFiles: string[] = []
  try {
    attemptFiles = (await readdir(attemptsDir)).filter((f) => f.endsWith('.json'))
  } catch {
    // 还没有任何答题记录
  }
  for (const file of attemptFiles) {
    const attempts = await listAttempts(topicId, file.replace(/\.json$/, ''))
    for (const attempt of attempts) {
      const questions = await readJson<QuestionSet | null>(
        dataPath('topics', topicId, 'lessons', `${attempt.lessonId}.questions.json`),
        null,
      )
      for (const record of attempt.records) {
        const r = record.result
        if (!r) continue
        const isWrong = r.correct === false || (r.score !== undefined && r.score < WRONG_SCORE_THRESHOLD)
        if (!isWrong) continue
        const q =
          attempt.questions.find((x) => x.id === record.questionId) ??
          questions?.questions.find((x) => x.id === record.questionId)
        const nodeName = q ? (nodeNames[q.nodeId] ?? q.nodeId) : '未知知识点'
        const brief = q ? q.prompt.replace(/\s+/g, ' ').slice(0, 60) : record.questionId
        wrongAnswers.push(`- [${nodeName}] 题目「${brief}…」：${r.feedback ? `批改意见「${r.feedback.slice(0, 80)}」` : '回答错误'}`)
      }
    }
  }

  const reports = await readJson<ErrorReport[]>(dataPath('topics', topicId, 'reports.json'), [])
  return { masterySnapshot, wrongAnswers, reports, nodeNames, profileText: '' }
}

// 研究阶段：代码先并行搜 3 个角度，Agent 只负责挑 2~3 篇精读 + 写笔记 + 顺带出大纲。
// 硬预算：抓取≤3、图片≤1、工具总调用≤4、最多 6 轮；超预算立即强制 save_research_note。
const RESEARCH_TOOL_BUDGET: Record<string, number> = { web_fetch: 3, image_search: 1 }
const RESEARCH_MAX_TOOL_CALLS = 4
const RESEARCH_MAX_ROUNDS = 6

function researchQueries(topicName: string, node: KnowledgeNode): string[] {
  const base = node.name.trim()
  // 节点名常常有歧义：「建表与字段布局设计」会被搜成数据库建表。
  // 拼上方向名（如「Excel 数据透视表」）把语义锚回当前课题。
  const scope = topicName.trim().replace(/\s+/g, ' ').slice(0, 24)
  const anchor = scope && !base.includes(scope) ? `${scope} ${base}` : base
  return [`${anchor} 原理 公式 推导`, `${anchor} 实战 案例 工程实践`, `${anchor} 常见误区 易混淆`]
}

interface PrefetchResult {
  text: string
  count: number
  items: { title: string; url: string; snippet: string }[]
}

// 搜索里混进 PDF/文档站/付费预览页，抓取必失败，白耗抓取预算——预搜阶段直接剔除
const SKIP_RESULT_HOST = /(book118|doc88|docin|renrendoc|wenku\.baidu|360doc|max\.book118)/i
const SKIP_RESULT_EXT = /\.(pdf|doc|docx|ppt|pptx|xls|xlsx)(\?|$)/i

function usableSearchResult(url: string): boolean {
  return !SKIP_RESULT_HOST.test(url) && !SKIP_RESULT_EXT.test(url)
}

// 3 路 query 并行搜（searchWeb 内部已是双 provider 并行）；每个角度最多留 3 条，按 URL 去重
async function prefetchResearch(
  topicId: string,
  node: KnowledgeNode,
  queries: string[],
  onStage: StageFn,
): Promise<PrefetchResult> {
  onStage({ stage: 'research-prefetch', detail: { queries } })
  const settled = await Promise.allSettled(queries.map((q) => searchWeb(q)))
  const seen = new Set<string>()
  const picked: { title: string; url: string; snippet: string }[] = []
  for (let i = 0; i < settled.length; i++) {
    const r = settled[i]
    if (r.status !== 'fulfilled') continue
    let kept = 0
    for (const item of r.value) {
      if (!usableSearchResult(item.url)) continue
      const key = normalizeUrl(item.url)
      if (seen.has(key)) continue
      seen.add(key)
      picked.push({ title: item.title, url: item.url, snippet: item.snippet })
      kept++
      if (kept >= 3) break
    }
    void appendTrace(topicId, node.id, {
      kind: 'search',
      query: queries[i],
      results: r.value.map((x) => ({
        title: x.title,
        url: x.url,
        provider: x.provider,
        snippet: x.snippet,
        kept: true,
      })),
    }).catch(() => {})
  }
  const failed = settled.filter((r) => r.status === 'rejected').length
  onStage({
    stage: 'research-prefetch-done',
    detail: { queries: queries.length, results: picked.length, failed },
  })
  return {
    text: picked
      .map((r, i) => `[${i + 1}] ${r.title}\n${r.url}\n${r.snippet.slice(0, 220)}`)
      .join('\n\n'),
    count: picked.length,
    items: picked,
  }
}

interface ResearchOutcome {
  note: ResearchNote
  outline: LlmOutline | null
}

async function runResearch(
  topicId: string,
  topicName: string,
  node: KnowledgeNode,
  learnerCtx: string,
  onStage: StageFn,
): Promise<ResearchOutcome> {
  const existing = await readResearchNote(topicId, node.id)
  if (existing) {
    onStage({ stage: 'research', detail: { cached: true, version: existing.version, nodeId: node.id } })
    return { note: existing, outline: null }
  }

  onStage({ stage: 'research', detail: { cached: false, nodeId: node.id } })
  const queries = researchQueries(topicName, node)
  const prefetched = await prefetchResearch(topicId, node, queries, onStage)

  const tools: AgentTool[] = [
    {
      name: 'web_fetch',
      description: '抓取网页并提取正文（最长 6000 字），附本页配图候选。最多抓 3 篇，抓够就收尾',
      parameters: {
        type: 'object',
        properties: { url: { type: 'string', description: '网页 URL' } },
        required: ['url'],
      },
      execute: async (args) => {
        const url = String(args.url ?? '')
        const page = await fetchPage(url)
        await appendTrace(topicId, node.id, {
          kind: 'fetch',
          url: page.url,
          title: page.title,
          textLength: page.text.length,
        })
        const images = page.images.length
          ? `\n\n本页配图候选（可用 save_research_note 的 images 收藏）：\n${page.images
              .map((img) => `- ${img.url}${img.title ? `（${img.title}）` : ''}`)
              .join('\n')}`
          : ''
        return `标题：${page.title}\n\n${page.text}${images}`
      },
    },
    {
      name: 'image_search',
      description: '搜索配图（示意图/架构图/流程图），最多 1 次；没有贴切的图就跳过',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string', description: '图片搜索关键词' } },
        required: ['query'],
      },
      execute: async (args) => {
        const query = String(args.query ?? '').trim()
        if (!query) return '搜索词为空'
        const images = await searchImages(query)
        return images
          .slice(0, 6)
          .map(
            (img, i) =>
              `[${i + 1}] (${img.provider}) ${img.title ?? '（无标题）'}\n${img.url}${
                img.pageUrl ? `\n出处页：${img.pageUrl}` : ''
              }`,
          )
          .join('\n\n')
      },
    },
    {
      name: 'save_research_note',
      description: '保存研究笔记（研究完成后必须调用一次）',
      parameters: {
        type: 'object',
        properties: {
          concepts: { type: 'array', items: { type: 'string' }, description: '核心概念要点，每条独立成句' },
          derivations: { type: 'array', items: { type: 'string' }, description: '公式/原理推导步骤' },
          examples: { type: 'array', items: { type: 'string' }, description: '典型例题或工程案例' },
          pitfalls: { type: 'array', items: { type: 'string' }, description: '常见误区' },
          sources: {
            type: 'array',
            items: { type: 'object', properties: { title: { type: 'string' }, url: { type: 'string' } }, required: ['title', 'url'] },
            description: '实际参考过的来源',
          },
          images: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                url: { type: 'string', description: '图片直链' },
                title: { type: 'string', description: '图片说明' },
                pageUrl: { type: 'string', description: '图片出处网页' },
              },
              required: ['url'],
            },
            description: '给课件配图收藏的图片（0~2 张，宁缺毋滥）',
          },
        },
        required: ['concepts', 'derivations', 'examples', 'pitfalls', 'sources'],
      },
      execute: async (args) => {
        const patch = notePatchSchema.parse(args)
        if (patch.concepts.length === 0) {
          return '保存失败：concepts 不能为空。请用已抓取正文和候选摘要把 concepts/derivations/examples/pitfalls/sources 填完整后重新调用，不要传空对象。'
        }
        // 配图下载落地（原图可能失效，下载成功才进笔记）
        patch.images = (
          await Promise.all(
            patch.images.map(async (img) => {
              const saved = await downloadImage(topicId, img.url, {
                title: img.title,
                pageUrl: img.pageUrl,
              })
              return saved ? { ...img, localPath: saved.src } : null
            }),
          )
        ).filter((img): img is NonNullable<typeof img> => img !== null)
        const note = await saveResearchNote(topicId, node.id, patch, queries)
        onStage({
          stage: 'research-note-saved',
          detail: {
            noteId: note.id,
            sources: note.sources.length,
            images: note.images?.length ?? 0,
          },
        })
        return '笔记已保存，可以收尾了'
      },
    },
  ]

  await runAgent({
    system: RESEARCH_SYSTEM_PROMPT,
    prompt: researchUserPrompt(topicName, node, existing, {
      prefetched: prefetched.text,
      learnerCtx,
    }),
    tools,
    maxRounds: RESEARCH_MAX_ROUNDS,
    maxToolCalls: RESEARCH_MAX_TOOL_CALLS,
    toolBudgets: RESEARCH_TOOL_BUDGET,
    // 两家搜索源难免给出 403/付费墙；连续 2 次抓不到就收手，用候选摘要落笔记，
    // 不为了「再试一篇」多跑一轮 30s 的 LLM 决策
    maxToolFailures: 2,
    // 研究做完了却没调用 save_research_note 是 flash 的高频失误：
    // 强制收尾一轮把已有上下文落成笔记，别让整节课作废
    requireTool: 'save_research_note',
    onEvent: (e) => {
      if (e.type === 'tool_call') onStage({ stage: 'research-tool', detail: { tool: e.name, args: e.args } })
      else if (e.type === 'tool_result' && !e.ok)
        onStage({ stage: 'research-tool-failed', detail: { tool: e.name, preview: e.preview } })
    },
  })

  let note = await readResearchNote(topicId, node.id)
  // 兜底：模型把 save_research_note 传了空对象 / 完全没保存时，至少用预搜候选摘要落一版笔记，
  // 保证课件引用有来源，而不是拿一份空笔记去写作。
  if (!note || note.concepts.length === 0) {
    note = await saveResearchNote(
      topicId,
      node.id,
      {
        concepts: prefetched.items.map((i) => i.snippet.trim()).filter(Boolean).slice(0, 8),
        derivations: [],
        examples: [],
        pitfalls: [],
        sources: prefetched.items.map((i) => ({ title: i.title, url: i.url })).slice(0, 8),
        images: [],
      },
      queries,
    )
    onStage({
      stage: 'research-fallback',
      detail: { sources: note.sources.length, concepts: note.concepts.length },
    })
  }
  // 大纲不在这里并行跑：high 档下一次大纲调用要 30~40s，和 Agent 抢同一个模型队列
  // 反而把每一轮工具决策拖慢。交给 prepareLesson 在笔记完成后串行生成，总时长更短。
  return { note, outline: null }
}

async function streamWriteOnce(system: string, prompt: string, onStage: StageFn): Promise<string> {
  const model = getLLMModel()
  const stream = await getLLM().chat.completions.create({
    model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: prompt },
    ],
    temperature: 0.5,
    stream: true,
    stream_options: { include_usage: true },
    // 软限长：提示词已压到 2800~3500 字，这里再兜一层，避免 6k 字的长文把后续全部拖慢
    max_tokens: Number(process.env.LLM_WRITE_MAX_TOKENS || 4096),
    ...effortParams(),
  })
  let content = ''
  let tokensIn = 0
  let tokensOut = 0
  for await (const chunk of stream) {
    if (chunk.usage) {
      tokensIn = chunk.usage.prompt_tokens ?? 0
      tokensOut = chunk.usage.completion_tokens ?? 0
    }
    const delta = chunk.choices[0]?.delta?.content
    if (delta) {
      content += delta
      onStage({ stage: 'write-delta', detail: { text: delta } })
    }
  }
  recordLlmUsage({ model, tokensIn, tokensOut, status: 'ok' })
  if (!content.trim()) throw new Error('写作阶段未产出内容')
  return content
}

// 写作重试一次：空输出（provider 偶发空流）不该让前面 3 分钟的研究白费。
// 重试那次不重复推流，成功后一次性补一条 delta，避免页面出现两遍草稿。
async function streamWriteLesson(system: string, prompt: string, onStage: StageFn): Promise<string> {
  try {
    return await streamWriteOnce(system, prompt, onStage)
  } catch (err) {
    if (!(err instanceof Error) || err.message !== '写作阶段未产出内容') throw err
    onStage({ stage: 'write-retry', detail: { reason: err.message } })
    const content = await streamWriteOnce(system, prompt, () => {})
    onStage({ stage: 'write-delta', detail: { text: content } })
    return content
  }
}

// 归档本课用过的案例（供后续课程避免重复）；失败不影响备课
async function recordTaughtForLesson(
  topicId: string,
  lessonId: string,
  node: KnowledgeNode,
  objectives: string[],
  contentMd: string,
  onStage: StageFn,
): Promise<void> {
  try {
    const out = await completeJson({
      system: TAUGHT_SYSTEM_PROMPT,
      prompt: taughtExtractPrompt(node.name, contentMd),
      schema: llmTaughtSchema,
      temperature: 0.2,
    })
    await recordTaught(topicId, {
      lessonId,
      nodeId: node.id,
      nodeName: node.name,
      objectives,
      examples: out.examples,
    })
    onStage({ stage: 'taught-recorded', detail: { nodeId: node.id, examples: out.examples.length } })
  } catch (err) {
    onStage({ stage: 'taught-skip', detail: { message: errMsg(err) } })
  }
}

// 备课主流程：schedule → research → outline → write → self-check（Design.md §1.1）
// opts.nodeId：用户指定知识点；opts.lessonId：后台任务预分配的课程 id
export async function prepareLesson(
  topicId: string,
  onStage: StageFn = () => {},
  opts: { nodeId?: string; lessonId?: string } = {},
): Promise<{ lesson: Lesson; questions: QuestionSet }> {
  const topic = await getTopic(topicId)
  const graph = await getGraph(topicId)
  if (!topic || !graph) throw new Error(`课题不存在或图谱为空：${topicId}`)

  // 1. 选题：用户指定 or 排课引擎
  let node: KnowledgeNode
  let reason: string
  if (opts.nodeId) {
    const picked = graph.nodes.find((n) => n.id === opts.nodeId)
    if (!picked) throw new Error(`知识点不存在：${opts.nodeId}`)
    const byId = new Map(graph.nodes.map((n) => [n.id, n]))
    const locked = picked.deps.filter((d) => (byId.get(d)?.mastery ?? 0) < MASTERY_UNLOCK_THRESHOLD)
    if (locked.length) {
      throw new Error(
        `「${picked.name}」的前置未达标：${locked.map((d) => `${byId.get(d)?.name ?? d}=${byId.get(d)?.mastery ?? 0}`).join('、')}（需 ≥${MASTERY_UNLOCK_THRESHOLD}）`,
      )
    }
    node = picked
    reason = `你指定学习：${picked.name}${picked.deps.length ? `（前置 ${picked.deps.map((d) => byId.get(d)?.name ?? d).join('、')} 均已达标）` : ''}`
  } else {
    onStage({ stage: 'schedule' })
    const sched = scheduleNext(graph.nodes)
    if (!sched.nodeId) throw new Error(sched.reason)
    node = graph.nodes.find((n) => n.id === sched.nodeId)!
    reason = sched.reason
  }
  onStage({ stage: 'scheduled', detail: { nodeId: node.id, nodeName: node.name, reason } })

  const ctx = await buildLearnerContext(topicId, graph.nodes)
  ctx.profileText = profileTextOf(topic.profile)
  const preferenceText = await preferenceContextText()
  const taughtText = taughtContextText(await listTaught(topicId))
  const learnerCtx = learnerContextText({
    masterySnapshot: ctx.masterySnapshot,
    wrongAnswers: ctx.wrongAnswers,
    reports: ctx.reports.filter((r) => r.nodeId === node.id || node.deps.includes(r.nodeId)),
    nodeNames: ctx.nodeNames,
    profileText: ctx.profileText,
    preferenceText,
    taughtText,
  })

  // 2. 研究：3 路并行预搜 + 有界 Agent（笔记缓存命中则跳过）
  const research = await runResearch(topicId, topic.name, node, learnerCtx, onStage)
  const note = research.note

  // 3. 大纲：研究收尾时已顺带产出则直接复用，省一次 LLM 往返
  let outline: LlmOutline
  if (research.outline) {
    outline = research.outline
    onStage({
      stage: 'outline-done',
      detail: {
        focus: outline.focus,
        sections: outline.sections.length,
        difficulty: outline.difficulty,
        objectives: outline.objectives.length,
        merged: true,
      },
    })
  } else {
    onStage({ stage: 'outline' })
    outline = await completeJson({
      system: OUTLINE_SYSTEM_PROMPT,
      prompt: outlineUserPrompt(node, note, learnerCtx),
      schema: llmOutlineSchema,
    })
    onStage({
      stage: 'outline-done',
      detail: {
        focus: outline.focus,
        sections: outline.sections.length,
        difficulty: outline.difficulty,
        objectives: outline.objectives.length,
      },
    })
  }

  // 4. 写作（流式）
  onStage({ stage: 'write' })
  const draft = await streamWriteLesson(
    WRITE_SYSTEM_PROMPT,
    writeLessonPrompt({ topicName: topic.name, node, outline, note, learnerCtx }),
    onStage,
  )

  // 5. 写作一完成立刻落草稿：后面任何一步失败都不会把 3 分钟的正文丢掉
  const lessonId = opts.lessonId ?? newId('l')
  const file = dataPath('topics', topicId, 'lessons', `${lessonId}.json`)
  const base: Lesson = {
    id: lessonId,
    topicId,
    nodeIds: [node.id],
    scheduleReason: reason,
    masterySnapshot: ctx.masterySnapshot,
    injectedReports: ctx.reports.filter((r) => r.nodeId === node.id).map((r) => r.id),
    researchNoteIds: [note.id],
    sources: note.sources.map((s, i) => ({ idx: i + 1, title: s.title, url: s.url })),
    objectives: outline.objectives,
    difficulty: outline.difficulty,
    contentMd: draft,
    status: 'writing',
    createdAt: nowIso(),
  }
  await withLock(file, () => writeJson(file, base))
  onStage({ stage: 'draft-saved', detail: { lessonId, wordCount: draft.length } })

  // 6. 引用落地校验 + 配图落地：这些是纯后处理，不需要模型，也不该阻塞出题
  const cited = sanitizeCitations(stripTrailingSourceBlock(draft), note.sources.length)
  if (cited.removed.length) {
    onStage({ stage: 'citations-sanitized', detail: { removed: cited.removed.length } })
  }
  const localized = await localizeImages(topicId, cited.md, { dropFailed: true })
  const lesson: Lesson = {
    ...base,
    images: localized.images,
    contentMd: localized.contentMd,
    status: 'generated',
  }
  // 与 lesson-jobs 的状态回写共用同一把文件锁，防止占位状态覆盖成品
  await withLock(file, () => writeJson(file, lesson))

  onStage({ stage: 'done', detail: { lessonId, nodeId: node.id, wordCount: localized.contentMd.length } })

  // 7. 出题 / 质检 / 案例归档串行后台跑：先让用户读课；串行避免同一节课并发打 3 路 LLM
  void (async () => {
    try {
      await ensureQuestions(lessonId)
    } catch (err) {
      console.error('[lesson] 后台出题失败', lessonId, err)
    }
    try {
      await runQualityPass(topicId, lesson, note, node, outline)
    } catch (err) {
      console.error('[lesson] 后台质检失败', lessonId, err)
    }
    try {
      await recordTaughtForLesson(topicId, lessonId, node, outline.objectives, localized.contentMd, () => {})
    } catch (err) {
      console.error('[lesson] 后台归档失败', lessonId, err)
    }
  })()

  // 题目稍后由后台写入；先返回空题集，调用方不会因为「没题」判定备课失败
  const questions: QuestionSet = { generatedAt: nowIso(), questions: [] }
  return { lesson, questions }
}

const FORMAT_ISSUE_RE =
  /图片|配图|链接|url|引用|来源标注|\[\d+\]|格式|排版|markdown|标题层级|字数|篇幅|重复|标点|拼写/i
const FACTUAL_ISSUE_RE = /矛盾|事实|不符|不准确|错误|编造|虚构|无依据|缺乏依据|依据不足|无来源|无法支撑|无法对应|与笔记|误导/

// 质检 issue 分类：图片 URL / 引用越界 / 排版属于后处理能修的，不触发全文重写
export function isFactualIssue(issue: string): boolean {
  return FACTUAL_ISSUE_RE.test(issue) && !FORMAT_ISSUE_RE.test(issue)
}

// 课后异步质检：只对「与笔记事实矛盾」的实质问题重写一次正文，其余问题交给后处理
async function runQualityPass(
  topicId: string,
  lesson: Lesson,
  note: ResearchNote,
  node: KnowledgeNode,
  outline: LlmOutline,
): Promise<void> {
  const check = await completeJson({
    system: CONTENT_CHECK_SYSTEM_PROMPT,
    prompt: contentCheckPrompt(node, note, lesson.contentMd, outline.objectives),
    schema: llmContentCheckSchema,
    temperature: 0.2,
  })
  const factual = check.issues.filter(isFactualIssue).slice(0, 5)
  if (!check.needsCorrection || factual.length === 0) {
    if (check.issues.length) {
      console.info('[quality] 仅格式类问题，已交给后处理，不重写正文', { issues: check.issues.length })
    }
    return
  }

  const rewritten = await completeText({
    system: CORRECT_CONTENT_SYSTEM_PROMPT,
    prompt: correctContentPrompt(node, lesson.contentMd, factual),
    temperature: 0.2,
  })
  if (!rewritten.trim()) return
  const cited = sanitizeCitations(stripTrailingSourceBlock(rewritten), lesson.sources.length)
  const localized = await localizeImages(topicId, cited.md, { dropFailed: true })
  const file = dataPath('topics', topicId, 'lessons', `${lesson.id}.json`)
  await withLock(file, async () => {
    const current = await readJson<Lesson | null>(file, null)
    if (!current || current.status !== 'generated') return
    current.contentMd = localized.contentMd
    current.images = localized.images
    current.revisedAt = nowIso()
    await writeJson(file, current)
  })
  console.info('[quality] 已按事实性问题修正正文', { lessonId: lesson.id, issues: factual.length })
}

// AI 优化课件：基于研究笔记 + 用户意见重写正文，重跑自查出题，原地覆盖
export async function reviseLesson(
  lessonId: string,
  instruction: string,
  onStage: StageFn = () => {},
): Promise<Lesson> {
  const detail = await findLesson(lessonId)
  if (!detail) throw new Error('课程不存在')
  const { topic, lesson } = detail
  // 后台任务会先把状态置为 revising，两种状态都允许
  if (lesson.status !== 'generated' && lesson.status !== 'revising') {
    throw new Error('仅生成完成的课程可以优化')
  }

  const graph = await getGraph(topic.id)
  const node = graph?.nodes.find((n) => n.id === lesson.nodeIds[0])
  const note = node ? await readResearchNote(topic.id, node.id) : null

  onStage({ stage: 'revise', detail: { instruction } })
  const preferenceText = await preferenceContextText()
  const revised = await streamWriteLesson(
    REVISE_SYSTEM_PROMPT,
    reviseLessonPrompt({
      contentMd: lesson.contentMd,
      instruction,
      noteJson: note ? JSON.stringify(note, null, 2) : '（无研究笔记）',
      sources: lesson.sources.map((s) => `[${s.idx}] ${s.title} ${s.url}`).join('\n') || '（无来源）',
      preferenceText,
    }),
    onStage,
  )

  onStage({ stage: 'self-check' })
  let contentMd = revised
  let questions: QuestionSet | null = null
  if (node && note) {
    try {
      let check: LlmSelfCheck | null = null
      let dropped: string[] = []
      let valid: LlmSelfCheck['questions'] = []
      for (let attempt = 0; attempt < 3; attempt++) {
        check = await completeJson({
          system: SELFCHECK_SYSTEM_PROMPT,
          prompt: selfCheckPrompt(node, note, revised, lesson.objectives ?? [], dropped),
          schema: llmSelfCheckSchema,
          temperature: 0.2,
        })
        const part = partitionQuestionDrafts(check.questions)
        valid = part.valid
        dropped = part.dropped
        if (dropped.length === 0) break
      }
      if (!check) throw new Error('出题失败：模型未返回自查结果')
      // 结构校验不通过的坏题不落地：够 3 题就用合法题继续，否则抛给外层 catch 保留原有题目
      if (dropped.length) {
        if (valid.length < 3) throw new Error(`出题结构校验未通过：${dropped.join('；')}`)
        console.warn('[self-check] 优化课件时剔除坏题后继续', { dropped, kept: valid.length })
        check = { ...check, questions: valid }
      }
      contentMd =
        check.needsCorrection && check.issues.length
          ? await completeText({
              system: CORRECT_CONTENT_SYSTEM_PROMPT,
              prompt: correctContentPrompt(node, revised, check.issues),
              temperature: 0.2,
            })
          : revised
      questions = {
        generatedAt: nowIso(),
        questions: check.questions.map<Question>((q, i) => ({
          id: `q_${i + 1}`,
          nodeId: node.id,
          type: q.type,
          prompt: q.prompt,
          options: q.options,
          answer: q.answer,
          referenceAnswer: q.referenceAnswer,
          explanation: q.explanation,
        })),
      }
    } catch (err) {
      // 自查尽力而为：失败则保留重写正文与原有题目，不中断优化
      onStage({
        stage: 'self-check-skipped',
        detail: { message: errMsg(err) },
      })
    }
  }

  // 引用落地校验：剔除越界来源引用 [n]，再落图（外链落地、失败剔除）
  const cited = sanitizeCitations(stripTrailingSourceBlock(contentMd), lesson.sources.length)
  const localized = await localizeImages(topic.id, cited.md, {
    dropFailed: true,
  })
  lesson.contentMd = localized.contentMd
  lesson.images = localized.images
  lesson.status = 'generated'
  lesson.error = undefined
  lesson.revisedAt = nowIso()
  await withLock(dataPath('topics', topic.id, 'lessons', `${lessonId}.json`), () =>
    writeJson(dataPath('topics', topic.id, 'lessons', `${lessonId}.json`), lesson),
  )
  if (questions) {
    await writeJson(dataPath('topics', topic.id, 'lessons', `${lessonId}.questions.json`), questions)
  }
  if (node) {
    await recordTaughtForLesson(topic.id, lessonId, node, lesson.objectives ?? [], localized.contentMd, onStage)
  }
  onStage({ stage: 'done', detail: { lessonId, wordCount: localized.contentMd.length } })
  return lesson
}

// 再次测验：围绕本课知识点重新出一套新题（避开历史出过的题），覆盖当前题集
// 同一节课只跑一个出题任务：后台自动出题和用户点「生成课末题」共用同一个 Promise
const quizJobs = new Map<string, Promise<QuestionSet>>()

export function isQuizRunning(lessonId: string): boolean {
  return quizJobs.has(lessonId)
}

export function ensureQuestions(lessonId: string): Promise<QuestionSet> {
  const running = quizJobs.get(lessonId)
  if (running) return running
  const job = regenerateQuestions(lessonId).finally(() => {
    quizJobs.delete(lessonId)
  })
  quizJobs.set(lessonId, job)
  return job
}

export async function regenerateQuestions(lessonId: string): Promise<QuestionSet> {
  const detail = await findLesson(lessonId)
  if (!detail) throw new Error('课程不存在')
  const { topic, lesson, questions: current } = detail
  if (lesson.status !== 'generated') throw new Error('课程尚未生成完成，暂不能出题')

  const graph = await getGraph(topic.id)
  const node = graph?.nodes.find((n) => n.id === lesson.nodeIds[0])
  if (!node) throw new Error('知识点不存在')
  const storedNote = await readResearchNote(topic.id, node.id)
  // 老课件可能没有研究笔记：给一个空笔记，课程正文本身仍可出题
  const note = storedNote ?? {
    id: '',
    nodeId: node.id,
    concepts: [],
    derivations: [],
    examples: [],
    pitfalls: [],
    sources: [],
    images: [],
    searchQueries: [],
    version: 0,
    updatedAt: nowIso(),
  }

  const attempts = await listAttempts(topic.id, lessonId)
  const avoidPrompts = [
    ...(current?.questions ?? []).map((q) => q.prompt),
    ...attempts.flatMap((a) => a.questions.map((q) => q.prompt)),
  ]

  // 结构校验失败带原因重试；仍有坏题时只要合法题 ≥3 道就用合法题（坏题不入库）
  let valid: LlmSelfCheck['questions'] = []
  let dropReasons: string[] = []
  for (let attempt = 0; attempt < 3; attempt++) {
    const result = await completeJson({
      system: QUIZ_SYSTEM_PROMPT,
      prompt: quizPrompt(node, note, lesson.contentMd, [...new Set(avoidPrompts)], dropReasons, lesson.objectives ?? []),
      schema: llmQuizSchema,
      temperature: 0.7,
    })
    const part = partitionQuestionDrafts(result.questions)
    valid = part.valid
    dropReasons = part.dropped
    if (dropReasons.length === 0) break
  }
  if (dropReasons.length) {
    if (valid.length < 3) throw new Error(`出题结构校验未通过：${dropReasons.join('；')}`)
    console.warn('[quiz] 剔除坏题后继续', { dropped: dropReasons, kept: valid.length })
  }
  const questions: QuestionSet = {
    generatedAt: nowIso(),
    questions: valid.map<Question>((q, i) => ({
      id: `q_${i + 1}`,
      nodeId: node.id,
      type: q.type,
      prompt: q.prompt,
      options: q.options,
      answer: q.answer,
      referenceAnswer: q.referenceAnswer,
      explanation: q.explanation,
    })),
  }
  await writeJson(dataPath('topics', topic.id, 'lessons', `${lessonId}.questions.json`), questions)
  return questions
}
