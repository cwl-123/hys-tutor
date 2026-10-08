import { dataPath, newId, readJson, writeJson } from '../repo/json-store'
import type { Attempt, Question, QuestionSet } from '../../shared/types'

function attemptsFile(topicId: string, lessonId: string): string {
  return dataPath('topics', topicId, 'attempts', `${lessonId}.json`)
}

// 作答与题型是否匹配（防回填到已换新的题集：旧答案 "B" 对上判断题就是错位）
function answerFitsType(q: Question, userAnswer: string): boolean {
  if (q.type === 'judge') return ['对', '错'].includes(userAnswer)
  if (q.type === 'single') return /^[A-D]$/.test(userAnswer.trim())
  return true
}

// 读取某课全部测验记录（按时间升序）
// 兼容旧版单对象格式（无 id/questions/masteryChanges/createdAt）；
// 旧记录缺题目快照时回填当前题集（含答案，用于回看）——仅限题集从未被「再次测验」换新
// （无 generatedAt）且每条作答与题目类型匹配，否则不回填，由前端降级为仅展示判分记录
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
    if (qs && !qs.generatedAt) {
      for (const a of list) {
        const fits =
          a.questions.length === 0 &&
          a.records.every((r) => {
            const q = qs.questions.find((x) => x.id === r.questionId)
            return q ? answerFitsType(q, r.userAnswer) : false
          })
        if (fits) a.questions = qs.questions
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
