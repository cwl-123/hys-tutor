import { dataPath, readJson } from '../repo/json-store'
import { getTopic, listTopics } from './graph-service'
import type { Lesson, QuestionSet, Topic } from '../../shared/types'

export interface LessonDetail {
  topic: Topic
  lesson: Lesson
  questions: QuestionSet | null
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
