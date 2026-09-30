import { readdir } from 'node:fs/promises'
import { dataPath, readJson } from '../repo/json-store'
import { getTopic, listTopics } from './graph-service'
import type { LessonMeta } from '../../shared/api'
import type { Lesson, QuestionSet, Topic } from '../../shared/types'

export interface LessonDetail {
  topic: Topic
  lesson: Lesson
  questions: QuestionSet | null
}

function lessonTitle(lesson: Lesson, nodeNames: Record<string, string>): string {
  const heading = lesson.contentMd.match(/^#\s+(.+)$/m)?.[1]?.trim()
  if (heading) return heading
  return lesson.nodeIds.map((id) => nodeNames[id] ?? id).join(' + ')
}

// GET /api/topics/:id/lessons — 该课题全部课程（按时间倒序）
export async function listLessons(topicId: string): Promise<LessonMeta[]> {
  const dir = dataPath('topics', topicId, 'lessons')
  let files: string[]
  try {
    files = (await readdir(dir)).filter((f) => f.endsWith('.json') && !f.endsWith('.questions.json'))
  } catch {
    return []
  }
  const graph = await readJson<{ nodes?: { id: string; name: string }[] } | null>(
    dataPath('topics', topicId, 'graph.json'),
    null,
  )
  const nodeNames = Object.fromEntries((graph?.nodes ?? []).map((n) => [n.id, n.name]))
  const metas: LessonMeta[] = []
  for (const f of files) {
    const lesson = await readJson<Lesson | null>(dataPath('topics', topicId, 'lessons', f), null)
    if (!lesson) continue
    metas.push({
      id: lesson.id,
      title: lessonTitle(lesson, nodeNames),
      nodeIds: lesson.nodeIds,
      scheduleReason: lesson.scheduleReason,
      status: lesson.status,
      createdAt: lesson.createdAt,
      wordCount: lesson.contentMd.length,
    })
  }
  return metas.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

// 按 lessonId 反查所属课题（课题数极少，逐个探测即可）
export async function findLesson(lessonId: string): Promise<LessonDetail | null> {
  const topics = await listTopics()
  for (const t of topics) {
    const lesson = await readJson<Lesson | null>(
      dataPath('topics', t.id, 'lessons', `${lessonId}.json`),
      null,
    )
    if (lesson) {
      const questions = await readJson<QuestionSet | null>(
        dataPath('topics', t.id, 'lessons', `${lessonId}.questions.json`),
        null,
      )
      return { topic: t, lesson, questions }
    }
  }
  return null
}

export async function getLessonDetail(topicId: string, lessonId: string): Promise<LessonDetail | null> {
  const topic = await getTopic(topicId)
  if (!topic) return null
  const lesson = await readJson<Lesson | null>(
    dataPath('topics', topicId, 'lessons', `${lessonId}.json`),
    null,
  )
  if (!lesson) return null
  const questions = await readJson<QuestionSet | null>(
    dataPath('topics', topicId, 'lessons', `${lessonId}.questions.json`),
    null,
  )
  return { topic, lesson, questions }
}

// 出题答案脱敏：前端在批改前不能拿到 answer / referenceAnswer / explanation
export function stripQuestions(qs: QuestionSet): QuestionSet {
  return {
    questions: qs.questions.map((q) => ({
      id: q.id,
      nodeId: q.nodeId,
      type: q.type,
      prompt: q.prompt,
      options: q.options,
    })),
  }
}
