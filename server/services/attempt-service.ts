import { dataPath, newId, readJson, writeJson } from '../repo/json-store'
import type { Attempt, QuestionSet } from '../../shared/types'

function attemptsFile(topicId: string, lessonId: string): string {
  return dataPath('topics', topicId, 'attempts', `${lessonId}.json`)
}

// 读取某课全部测验记录（按时间升序）
// 兼容旧版单对象格式（无 id/questions/masteryChanges/createdAt）；
// 旧记录缺题目快照时，若题目 id 与当前题集吻合则回填（含答案，用于回看）
export async function listAttempts(topicId: string, lessonId: string): Promise<Attempt[]> {
  const raw = await readJson<Attempt[] | Attempt | null>(attemptsFile(topicId, lessonId), null)
  if (!raw) return []
  const list = (Array.isArray(raw) ? raw : [raw]).map((a) => ({
    ...a,
    id: a.id ?? newId('a'),
    questions: a.questions ?? [],
    masteryChanges: a.masteryChanges ?? [],
    createdAt: a.createdAt ?? a.records?.[0]?.submittedAt ?? '',
  }))
  if (list.some((a) => a.questions.length === 0)) {
    const qs = await readJson<QuestionSet | null>(
      dataPath('topics', topicId, 'lessons', `${lessonId}.questions.json`),
      null,
    )
    if (qs) {
      for (const a of list) {
        if (a.questions.length === 0 && a.records.every((r) => qs.questions.some((q) => q.id === r.questionId))) {
          a.questions = qs.questions
        }
      }
    }
  }
  return list.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

// 追加一次测验记录（同一课多次测验，整文件重写）
export async function appendAttempt(topicId: string, attempt: Attempt): Promise<void> {
  const list = await listAttempts(topicId, attempt.lessonId)
  await writeJson(attemptsFile(topicId, attempt.lessonId), [...list, attempt])
}
