// 提示词准确率基准：用真实课题数据把「大纲 / 自查出题 / 再次测验」各跑 N 轮，
// 统计每一轮是否通过 —— 改提示词前后各跑一次，就能看出到底有没有变好。
//
// 用法：
//   pnpm exec vite-node scripts/bench-prompts.ts
//   pnpm exec vite-node scripts/bench-prompts.ts --rounds 3 --stage selfcheck
//   pnpm exec vite-node scripts/bench-prompts.ts --model deepseek-flash --topic t_xxx --node offline_evaluation
//
// 注意：会真实调用 LLM（消耗 token），默认 2 轮，只读数据、不写任何文件。
import { loadEnv } from 'vite'
import { readdir } from 'node:fs/promises'
import { dataPath, readJson } from '../server/repo/json-store'
import { completeJson } from '../server/llm/client'
import { OUTLINE_SYSTEM_PROMPT, learnerContextText, llmOutlineSchema, outlineUserPrompt } from '../server/llm/prompts/outline'
import { SELFCHECK_SYSTEM_PROMPT, llmSelfCheckSchema, selfCheckPrompt } from '../server/llm/prompts/selfcheck'
import { QUIZ_SYSTEM_PROMPT, llmQuizSchema, quizPrompt } from '../server/llm/prompts/quiz'
import { partitionQuestionDrafts } from '../shared/quiz-validate'
import type { Lesson, KnowledgeNode, ResearchNote, Topic } from '../shared/types'

Object.assign(process.env, loadEnv('development', process.cwd(), ''))

interface Args {
  rounds: number
  stage: 'all' | 'outline' | 'selfcheck' | 'quiz'
  model?: string
  topicId?: string
  nodeId?: string
}

function parseArgs(argv: string[]): Args {
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag)
    return i >= 0 ? argv[i + 1] : undefined
  }
  const stage = (get('--stage') ?? 'all') as Args['stage']
  return {
    rounds: Math.max(1, Number(get('--rounds') ?? 2)),
    stage: ['all', 'outline', 'selfcheck', 'quiz'].includes(stage) ? stage : 'all',
    model: get('--model'),
    topicId: get('--topic'),
    nodeId: get('--node'),
  }
}

async function pickTopic(topicId?: string): Promise<Topic> {
  if (topicId) {
    const t = await readJson<Topic | null>(dataPath('topics', topicId, 'topic.json'), null)
    if (!t) throw new Error(`课题不存在：${topicId}`)
    return t
  }
  const dirs = await readdir(dataPath('topics')).catch(() => [] as string[])
  for (const id of dirs) {
    const t = await readJson<Topic | null>(dataPath('topics', id, 'topic.json'), null)
    if (t) return t
  }
  throw new Error('没有找到任何课题，请先在页面创建一个')
}

// 挑一个「有研究笔记 + 有已生成课件」的知识点，作为固定基准输入
async function pickSample(topicId: string, nodeId?: string) {
  const graph = await readJson<{ nodes: KnowledgeNode[] } | null>(dataPath('topics', topicId, 'graph.json'), null)
  if (!graph) throw new Error('图谱为空')
  const nodes = nodeId ? graph.nodes.filter((n) => n.id === nodeId) : graph.nodes
  if (nodes.length === 0) throw new Error(`知识点不存在：${nodeId}`)

  const files = await readdir(dataPath('topics', topicId, 'lessons')).catch(() => [] as string[])
  const lessons: Lesson[] = []
  for (const f of files) {
    if (!f.endsWith('.json') || f.includes('.questions.')) continue
    const l = await readJson<Lesson | null>(dataPath('topics', topicId, 'lessons', f), null)
    if (l?.status === 'generated' && l.contentMd.trim()) lessons.push(l)
  }
  for (const n of nodes) {
    const note = await readJson<ResearchNote | null>(dataPath('topics', topicId, 'research', `${n.id}.json`), null)
    const lesson = lessons.find((l) => l.nodeIds.includes(n.id))
    if (note && lesson) {
      return {
        node: n,
        note,
        contentMd: lesson.contentMd,
        objectives: lesson.objectives ?? [],
        graphNodes: graph.nodes,
      }
    }
  }
  throw new Error('没找到「研究笔记 + 已生成课件」都齐的知识点，先在网上完整生成一节课当基准')
}

interface Row {
  label: string
  ok: boolean
  detail: string
  ms: number
}

async function timed<T>(fn: () => Promise<T>): Promise<{ value?: T; error?: unknown; ms: number }> {
  const t0 = Date.now()
  try {
    return { value: await fn(), ms: Date.now() - t0 }
  } catch (error) {
    return { error, ms: Date.now() - t0 }
  }
}

function errText(err: unknown): string {
  const e = err as { issues?: { path: (string | number)[]; message: string }[]; message?: string }
  if (Array.isArray(e?.issues) && e.issues.length) {
    return `schema：${e.issues
      .slice(0, 2)
      .map((i) => `${i.path.join('.')} ${i.message}`)
      .join('；')}`
  }
  return (e?.message ?? String(err)).slice(0, 120)
}

async function benchOutline(sample: Awaited<ReturnType<typeof pickSample>>, rounds: number): Promise<Row[]> {
  const ctx = learnerContextText({
    masterySnapshot: Object.fromEntries(sample.graphNodes.map((n) => [n.id, n.mastery])),
    wrongAnswers: [],
    reports: [],
    nodeNames: Object.fromEntries(sample.graphNodes.map((n) => [n.id, n.name])),
  })
  const rows: Row[] = []
  for (let i = 0; i < rounds; i++) {
    const r = await timed(() =>
      completeJson({
        system: OUTLINE_SYSTEM_PROMPT,
        prompt: outlineUserPrompt(sample.node, sample.note, ctx),
        schema: llmOutlineSchema,
      }),
    )
    rows.push({
      label: `大纲 #${i + 1}`,
      ok: !r.error,
      detail: r.error
        ? errText(r.error)
        : `${r.value!.sections.length} 节 / ${r.value!.objectives.length} 目标 / ${r.value!.difficulty}`,
      ms: r.ms,
    })
  }
  return rows
}

async function benchSelfCheck(sample: Awaited<ReturnType<typeof pickSample>>, rounds: number): Promise<Row[]> {
  const rows: Row[] = []
  for (let i = 0; i < rounds; i++) {
    const r = await timed(() =>
      completeJson({
        system: SELFCHECK_SYSTEM_PROMPT,
        prompt: selfCheckPrompt(sample.node, sample.note, sample.contentMd, sample.objectives),
        schema: llmSelfCheckSchema,
        temperature: 0.2,
      }),
    )
    if (r.error) {
      rows.push({ label: `自查出题 #${i + 1}`, ok: false, detail: errText(r.error), ms: r.ms })
      continue
    }
    const part = partitionQuestionDrafts(r.value!.questions)
    rows.push({
      label: `自查出题 #${i + 1}`,
      ok: part.dropped.length === 0,
      detail: part.dropped.length ? part.dropped.join('；') : `5 题全部合法（${part.valid.map((q) => q.type).join('/')}）`,
      ms: r.ms,
    })
  }
  return rows
}

async function benchQuiz(sample: Awaited<ReturnType<typeof pickSample>>, rounds: number): Promise<Row[]> {
  const rows: Row[] = []
  for (let i = 0; i < rounds; i++) {
    const r = await timed(() =>
      completeJson({
        system: QUIZ_SYSTEM_PROMPT,
        prompt: quizPrompt(sample.node, sample.note, sample.contentMd, []),
        schema: llmQuizSchema,
        temperature: 0.7,
      }),
    )
    if (r.error) {
      rows.push({ label: `再次测验 #${i + 1}`, ok: false, detail: errText(r.error), ms: r.ms })
      continue
    }
    const part = partitionQuestionDrafts(r.value!.questions)
    rows.push({
      label: `再次测验 #${i + 1}`,
      ok: part.dropped.length === 0,
      detail: part.dropped.length ? part.dropped.join('；') : '5 题全部合法',
      ms: r.ms,
    })
  }
  return rows
}

const args = parseArgs(process.argv.slice(2))
if (args.model) process.env.LLM_MODEL = args.model
if (!process.env.LLM_API_KEY) throw new Error('缺少 LLM_API_KEY（.env）')

const topic = await pickTopic(args.topicId)
const sample = await pickSample(topic.id, args.nodeId)
console.log(`课题：${topic.name}（${topic.id}）`)
console.log(`基准知识点：${sample.node.name}（${sample.node.id}）  正文 ${sample.contentMd.length} 字`)
console.log(`模型：${process.env.LLM_MODEL}  轮次：${args.rounds}\n`)

const rows: Row[] = []
if (args.stage === 'all' || args.stage === 'outline') rows.push(...(await benchOutline(sample, args.rounds)))
if (args.stage === 'all' || args.stage === 'selfcheck') rows.push(...(await benchSelfCheck(sample, args.rounds)))
if (args.stage === 'all' || args.stage === 'quiz') rows.push(...(await benchQuiz(sample, args.rounds)))

for (const r of rows) {
  console.log(`${r.ok ? '✅' : '❌'} ${r.label.padEnd(14)} ${String(r.ms / 1000).padStart(5)}s  ${r.detail}`)
}
const pass = rows.filter((r) => r.ok).length
console.log(`\n通过率：${pass}/${rows.length}（${Math.round((pass / rows.length) * 100)}%）`)
process.exit(pass === rows.length ? 0 : 1)