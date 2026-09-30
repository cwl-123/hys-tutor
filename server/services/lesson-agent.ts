import { readdir } from 'node:fs/promises'
import { dataPath, newId, nowIso, readJson, writeJson } from '../repo/json-store'
import { getLLM, getLLMModel, completeJson } from '../llm/client'
import { runAgent, type AgentTool } from '../agent/loop'
import { searchWeb } from '../agent/tools/web-search'
import { fetchPage } from '../agent/tools/web-fetch'
import { notePatchSchema, readResearchNote, saveResearchNote } from '../agent/tools/notes'
import { RESEARCH_SYSTEM_PROMPT, researchUserPrompt } from '../llm/prompts/research'
import {
  OUTLINE_SYSTEM_PROMPT,
  learnerContextText,
  llmOutlineSchema,
  outlineUserPrompt,
} from '../llm/prompts/outline'
import { WRITE_SYSTEM_PROMPT, writeLessonPrompt } from '../llm/prompts/write'
import { SELFCHECK_SYSTEM_PROMPT, llmSelfCheckSchema, selfCheckPrompt } from '../llm/prompts/selfcheck'
import { scheduleNext } from './scheduler'
import { getGraph, getTopic } from './graph-service'
import type {
  Attempt,
  ErrorReport,
  KnowledgeNode,
  Lesson,
  Question,
  QuestionSet,
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
    const attempt = await readJson<Attempt | null>(dataPath('topics', topicId, 'attempts', file), null)
    if (!attempt) continue
    const questions = await readJson<QuestionSet | null>(
      dataPath('topics', topicId, 'lessons', `${attempt.lessonId}.questions.json`),
      null,
    )
    for (const record of attempt.records) {
      const r = record.result
      if (!r) continue
      const isWrong = r.correct === false || (r.score !== undefined && r.score < WRONG_SCORE_THRESHOLD)
      if (!isWrong) continue
      const q = questions?.questions.find((x) => x.id === record.questionId)
      const nodeName = q ? (nodeNames[q.nodeId] ?? q.nodeId) : '未知知识点'
      const brief = q ? q.prompt.replace(/\s+/g, ' ').slice(0, 60) : record.questionId
      wrongAnswers.push(`- [${nodeName}] 题目「${brief}…」：${r.feedback ? `批改意见「${r.feedback.slice(0, 80)}」` : '回答错误'}`)
    }
  }

  const reports = await readJson<ErrorReport[]>(dataPath('topics', topicId, 'reports.json'), [])
  return { masterySnapshot, wrongAnswers, reports, nodeNames }
}

// 研究阶段：Agent 自主搜索+精读+保存笔记；已有笔记则跳过（缓存命中，备课 < 1 分钟的关键）
async function runResearch(
  topicId: string,
  topicName: string,
  node: KnowledgeNode,
  onStage: StageFn,
) {
  const existing = await readResearchNote(topicId, node.id)
  if (existing) {
    onStage({ stage: 'research', detail: { cached: true, version: existing.version, nodeId: node.id } })
    return existing
  }

  onStage({ stage: 'research', detail: { cached: false, nodeId: node.id } })
  const searchedQueries: string[] = []
  const tools: AgentTool[] = [
    {
      name: 'web_search',
      description: '联网搜索（Tavily + 博查双路合并），返回标题/URL/摘要列表',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string', description: '搜索关键词（中文或英文）' } },
        required: ['query'],
      },
      execute: async (args) => {
        const query = String(args.query ?? '').trim()
        if (!query) return '搜索词为空'
        const results = await searchWeb(query)
        searchedQueries.push(query)
        return results
          .slice(0, 8)
          .map((r, i) => `[${i + 1}] (${r.provider}) ${r.title}\n${r.url}\n${r.snippet}`)
          .join('\n\n')
      },
    },
    {
      name: 'web_fetch',
      description: '抓取网页并提取正文（markdown 化前的纯文本，最长 6000 字）',
      parameters: {
        type: 'object',
        properties: { url: { type: 'string', description: '网页 URL' } },
        required: ['url'],
      },
      execute: async (args) => {
        const page = await fetchPage(String(args.url ?? ''))
        return `标题：${page.title}\n\n${page.text}`
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
        },
        required: ['concepts', 'derivations', 'examples', 'pitfalls', 'sources'],
      },
      execute: async (args) => {
        const patch = notePatchSchema.parse(args)
        const note = await saveResearchNote(topicId, node.id, patch, searchedQueries)
        onStage({ stage: 'research-note-saved', detail: { noteId: note.id, sources: note.sources.length } })
        return '笔记已保存，可以收尾了'
      },
    },
  ]

  await runAgent({
    system: RESEARCH_SYSTEM_PROMPT,
    prompt: researchUserPrompt(topicName, node, existing),
    tools,
    onEvent: (e) => {
      if (e.type === 'tool_call') onStage({ stage: 'research-tool', detail: { tool: e.name, args: e.args } })
      else if (e.type === 'tool_result' && !e.ok) onStage({ stage: 'research-tool-failed', detail: { tool: e.name, preview: e.preview } })
    },
  })

  const note = await readResearchNote(topicId, node.id)
  if (!note) throw new Error('研究阶段未产出笔记（Agent 未调用 save_research_note）')
  return note
}

async function streamWriteLesson(system: string, prompt: string, onStage: StageFn): Promise<string> {
  const stream = await getLLM().chat.completions.create({
    model: getLLMModel(),
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: prompt },
    ],
    temperature: 0.5,
    stream: true,
  })
  let content = ''
  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content
    if (delta) {
      content += delta
      onStage({ stage: 'write-delta', detail: { text: delta } })
    }
  }
  if (!content.trim()) throw new Error('写作阶段未产出内容')
  return content
}

// 备课主流程：schedule → research → outline → write → self-check（Design.md §1.1）
export async function prepareLesson(
  topicId: string,
  onStage: StageFn = () => {},
): Promise<{ lesson: Lesson; questions: QuestionSet }> {
  const topic = await getTopic(topicId)
  const graph = await getGraph(topicId)
  if (!topic || !graph) throw new Error(`课题不存在或图谱为空：${topicId}`)

  // 1. 排课（纯规则）
  onStage({ stage: 'schedule' })
  const sched = scheduleNext(graph.nodes)
  if (!sched.nodeId) throw new Error(sched.reason)
  const node = graph.nodes.find((n) => n.id === sched.nodeId)!
  onStage({ stage: 'scheduled', detail: { nodeId: node.id, nodeName: node.name, reason: sched.reason } })

  const ctx = await buildLearnerContext(topicId, graph.nodes)
  const learnerCtx = learnerContextText({
    masterySnapshot: ctx.masterySnapshot,
    wrongAnswers: ctx.wrongAnswers,
    reports: ctx.reports.filter((r) => r.nodeId === node.id || node.deps.includes(r.nodeId)),
    nodeNames: ctx.nodeNames,
  })

  // 2. 研究（Agent 工具循环，笔记缓存命中则跳过）
  const note = await runResearch(topicId, topic.name, node, onStage)

  // 3. 大纲
  onStage({ stage: 'outline' })
  const outline = await completeJson({
    system: OUTLINE_SYSTEM_PROMPT,
    prompt: outlineUserPrompt(node, note, learnerCtx),
    schema: llmOutlineSchema,
  })
  onStage({ stage: 'outline-done', detail: { focus: outline.focus, sections: outline.sections.length } })

  // 4. 写作（流式）
  onStage({ stage: 'write' })
  const draft = await streamWriteLesson(
    WRITE_SYSTEM_PROMPT,
    writeLessonPrompt({ topicName: topic.name, node, outline, note, learnerCtx }),
    onStage,
  )

  // 5. 自查 + 出题
  onStage({ stage: 'self-check' })
  const check = await completeJson({
    system: SELFCHECK_SYSTEM_PROMPT,
    prompt: selfCheckPrompt(node, note, draft),
    schema: llmSelfCheckSchema,
    temperature: 0.2,
  })
  const contentMd = check.correctedContent?.trim() ? check.correctedContent : draft
  onStage({
    stage: 'self-check-done',
    detail: { issues: check.issues, corrected: Boolean(check.correctedContent?.trim()) },
  })

  // 落盘
  const lessonId = newId('l')
  const lesson: Lesson = {
    id: lessonId,
    topicId,
    nodeIds: [node.id],
    scheduleReason: sched.reason,
    masterySnapshot: ctx.masterySnapshot,
    injectedReports: ctx.reports.filter((r) => r.nodeId === node.id).map((r) => r.id),
    researchNoteIds: [note.id],
    sources: note.sources.map((s, i) => ({ idx: i + 1, title: s.title, url: s.url })),
    contentMd,
    status: 'generated',
    createdAt: nowIso(),
  }
  const questions: QuestionSet = {
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
  await writeJson(dataPath('topics', topicId, 'lessons', `${lessonId}.json`), lesson)
  await writeJson(dataPath('topics', topicId, 'lessons', `${lessonId}.questions.json`), questions)

  onStage({ stage: 'done', detail: { lessonId, nodeId: node.id, wordCount: contentMd.length } })
  return { lesson, questions }
}
