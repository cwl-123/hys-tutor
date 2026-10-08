import { dataPath, newId, nowIso, readJson, writeJson } from '../repo/json-store'
import { completeJson, completeText } from '../llm/client'
import {
  LESSON_PLAN_SYSTEM_PROMPT,
  LESSON_REWRITE_SYSTEM_PROMPT,
  LESSON_SECTION_EDIT_SYSTEM_PROMPT,
  lessonPlanUserPrompt,
  lessonRewritePrompt,
  lessonSectionEditPrompt,
  llmLessonPlanSchema,
} from '../llm/prompts/lesson-chat'
import { readResearchNote } from '../agent/tools/notes'
import { getGraph } from './graph-service'
import { findLesson, type LessonDetail } from './lesson-service'
import { findSectionByHeading, listHeadings, replaceSection } from '../../shared/lesson-md'
import type {
  LessonChatMessage,
  LessonQuote,
  LessonVersion,
} from '../../shared/lesson-chat'

export interface LessonChatProposal {
  contentMd: string
  scope: 'full' | 'section'
  targetHeading?: string
  summary: string
}

export interface LessonChatState {
  messages: LessonChatMessage[]
  versions: LessonVersion[]
}

const MAX_MESSAGES = 200
const MAX_VERSIONS = 20

function chatFile(topicId: string, lessonId: string): string {
  return dataPath('topics', topicId, 'lesson-chats', `${lessonId}.json`)
}

function versionsFile(topicId: string, lessonId: string): string {
  return dataPath('topics', topicId, 'lesson-versions', `${lessonId}.json`)
}

function lessonFile(topicId: string, lessonId: string): string {
  return dataPath('topics', topicId, 'lessons', `${lessonId}.json`)
}

function httpError(message: string, status: number): Error {
  return Object.assign(new Error(message), { status })
}

async function loadMessages(topicId: string, lessonId: string): Promise<LessonChatMessage[]> {
  const data = await readJson<{ messages?: LessonChatMessage[] }>(chatFile(topicId, lessonId), {})
  return data.messages ?? []
}

async function loadVersions(topicId: string, lessonId: string): Promise<LessonVersion[]> {
  return readJson<LessonVersion[]>(versionsFile(topicId, lessonId), [])
}

async function requireGenerated(lessonId: string): Promise<LessonDetail> {
  const detail = await findLesson(lessonId)
  if (!detail) throw httpError('课程不存在', 404)
  if (detail.lesson.status !== 'generated') throw httpError('课程尚未生成完成，暂不能优化', 409)
  return detail
}

// 去掉模型可能整体包裹的 ``` 围栏
function stripFences(text: string): string {
  const trimmed = text.trim()
  const m = trimmed.match(/^```[a-zA-Z]*\s*\n([\s\S]*?)\n```$/)
  return (m ? m[1] : trimmed).trim()
}

// 基于当前课件 + 研究笔记 + 用户诉求，产出一处修改建议（不落盘）
// 两步：先 JSON 分类（短文本，可靠），再纯文本生成正文（长 markdown，避免 JSON 转义损坏）
async function computeEdit(
  detail: LessonDetail,
  input: { message: string; quote?: LessonQuote; history: { role: 'user' | 'assistant'; content: string }[] },
): Promise<{ reply: string; proposal?: LessonChatProposal }> {
  const { topic, lesson } = detail
  const nodeId = lesson.nodeIds[0]
  const graph = await getGraph(topic.id)
  const node = graph?.nodes.find((n) => n.id === nodeId)
  const note = nodeId ? await readResearchNote(topic.id, nodeId) : null
  const noteJson = note ? JSON.stringify(note, null, 2) : '（无研究笔记）'
  const sources = lesson.sources.map((s) => `[${s.idx}] ${s.title} ${s.url}`).join('\n') || '（无来源）'
  const headings = listHeadings(lesson.contentMd)

  const plan = await completeJson({
    system: LESSON_PLAN_SYSTEM_PROMPT,
    prompt: lessonPlanUserPrompt({
      topicName: topic.name,
      nodeName: node?.name ?? nodeId ?? '本课',
      contentMd: lesson.contentMd,
      headings,
      noteJson,
      sources,
      quote: input.quote,
      message: input.message,
      history: input.history,
    }),
    schema: llmLessonPlanSchema,
    temperature: 0.3,
  })

  if (plan.scope === 'none') return { reply: plan.reply }

  if (plan.scope === 'section') {
    const target = plan.targetHeading?.trim()
    const section = target ? findSectionByHeading(lesson.contentMd, target) : null
    if (!section?.heading) {
      return {
        reply: `${plan.reply}\n（未能确定要改的章节，请点「改本节」或直接选中要改的段落再引用一次）`,
      }
    }
    const revised = await completeText({
      system: LESSON_SECTION_EDIT_SYSTEM_PROMPT,
      prompt: lessonSectionEditPrompt({
        topicName: topic.name,
        nodeName: node?.name ?? nodeId ?? '本课',
        contentMd: lesson.contentMd,
        targetHeading: section.heading,
        noteJson,
        sources,
        quote: input.quote,
        message: input.message,
      }),
      temperature: 0.5,
    })
    const nextContent = replaceSection(lesson.contentMd, section.heading, stripFences(revised))
    if (nextContent === null) return { reply: plan.reply }
    return {
      reply: plan.reply,
      proposal: {
        contentMd: nextContent,
        scope: 'section',
        targetHeading: section.heading,
        summary: plan.summary?.trim() || `修订「${section.heading}」`,
      },
    }
  }

  // full：整篇重写
  const revised = await completeText({
    system: LESSON_REWRITE_SYSTEM_PROMPT,
    prompt: lessonRewritePrompt({
      topicName: topic.name,
      nodeName: node?.name ?? nodeId ?? '本课',
      contentMd: lesson.contentMd,
      noteJson,
      sources,
      message: input.message,
    }),
    temperature: 0.55,
  })
  return {
    reply: plan.reply,
    proposal: {
      contentMd: stripFences(revised),
      scope: 'full',
      summary: plan.summary?.trim() || '整篇重写',
    },
  }
}

// GET：读取课件对话历史与版本
export async function getLessonChat(lessonId: string): Promise<LessonChatState> {
  const detail = await findLesson(lessonId)
  if (!detail) throw httpError('课程不存在', 404)
  const [messages, versions] = await Promise.all([
    loadMessages(detail.topic.id, lessonId),
    loadVersions(detail.topic.id, lessonId),
  ])
  return { messages, versions }
}

// POST：追加一轮对话，返回新增的用户/助手消息与完整历史
export async function postLessonChat(
  lessonId: string,
  input: { message: string; quote?: LessonQuote },
): Promise<LessonChatState & { userMessage: LessonChatMessage; assistantMessage: LessonChatMessage }> {
  const detail = await requireGenerated(lessonId)
  const messages = await loadMessages(detail.topic.id, lessonId)
  const history = messages.slice(-6).map((m) => ({
    role: m.role,
    content: m.quote?.text ? `${m.content}（引用：${m.quote.text.slice(0, 200)}）` : m.content,
  }))

  const userMessage: LessonChatMessage = {
    id: newId('cm'),
    role: 'user',
    content: input.message,
    quote: input.quote,
    applied: false,
    createdAt: nowIso(),
  }
  const result = await computeEdit(detail, { ...input, history })
  const assistantMessage: LessonChatMessage = {
    id: newId('cm'),
    role: 'assistant',
    content: result.reply,
    proposal: result.proposal,
    applied: false,
    createdAt: nowIso(),
  }

  const next = [...messages, userMessage, assistantMessage].slice(-MAX_MESSAGES)
  await writeJson(chatFile(detail.topic.id, lessonId), { messages: next })
  const versions = await loadVersions(detail.topic.id, lessonId)
  return { messages: next, versions, userMessage, assistantMessage }
}

// POST apply：把某条建议写入课件，并留下版本快照
export async function applyLessonChat(
  lessonId: string,
  messageId: string,
): Promise<LessonChatState & { contentMd: string }> {
  const detail = await requireGenerated(lessonId)
  const { topic, lesson } = detail
  const messages = await loadMessages(topic.id, lessonId)
  const message = messages.find((m) => m.id === messageId)
  if (!message?.proposal) throw httpError('该消息没有可应用的修改', 400)
  if (message.applied) throw httpError('该修改已应用', 400)

  const versions = await loadVersions(topic.id, lessonId)
  versions.push({
    id: newId('v'),
    contentMd: lesson.contentMd,
    summary: `修改前：${message.proposal.summary}`,
    createdAt: nowIso(),
  })
  const trimmedVersions = versions.slice(-MAX_VERSIONS)

  lesson.contentMd = message.proposal.contentMd
  lesson.revisedAt = nowIso()
  message.applied = true

  await writeJson(lessonFile(topic.id, lessonId), lesson)
  await writeJson(chatFile(topic.id, lessonId), { messages })
  await writeJson(versionsFile(topic.id, lessonId), trimmedVersions)

  return { contentMd: lesson.contentMd, messages, versions: trimmedVersions }
}

// POST undo：撤销最近一次已应用的修改
export async function undoLessonChat(
  lessonId: string,
): Promise<LessonChatState & { contentMd: string }> {
  const detail = await requireGenerated(lessonId)
  const { topic, lesson } = detail
  const versions = await loadVersions(topic.id, lessonId)
  if (versions.length === 0) throw httpError('没有可撤销的修改', 400)

  const last = versions.pop()!
  lesson.contentMd = last.contentMd
  lesson.revisedAt = nowIso()

  await writeJson(lessonFile(topic.id, lessonId), lesson)
  await writeJson(versionsFile(topic.id, lessonId), versions)
  const messages = await loadMessages(topic.id, lessonId)
  return { contentMd: lesson.contentMd, messages, versions }
}