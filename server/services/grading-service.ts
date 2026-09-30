import { completeJson } from '../llm/client'
import { GRADE_SYSTEM_PROMPT, gradeShortPrompt, llmGradeSchema } from '../llm/prompts/grade'
import type { GradeResult, Question } from '../../shared/types'

const JUDGE_TRUE = ['对', '正确', '是', '√', 'T', 'TRUE', 'YES', 'A']
const JUDGE_FALSE = ['错', '错误', '否', '×', 'F', 'FALSE', 'NO', 'B']

// 客观题答案归一化：single 取首字母大写；judge 归一到 对/错
export function normalizeObjectiveAnswer(type: 'single' | 'judge', raw: string): string {
  const t = raw.trim().toUpperCase()
  if (type === 'single') {
    return t.match(/^[A-Z]/)?.[0] ?? t
  }
  if (JUDGE_TRUE.includes(t) || JUDGE_TRUE.includes(raw.trim())) return '对'
  if (JUDGE_FALSE.includes(t) || JUDGE_FALSE.includes(raw.trim())) return '错'
  return raw.trim()
}

// 客观题本地秒判（< 1s，无 LLM 调用）
export function gradeObjective(q: Question, userAnswer: string): GradeResult {
  const type = q.type as 'single' | 'judge'
  const correct =
    normalizeObjectiveAnswer(type, userAnswer) === normalizeObjectiveAnswer(type, q.answer ?? '')
  return { correct, gradedBy: 'local' }
}

// 简答题 LLM 批改（打分 + 评语）
export async function gradeShort(q: Question, userAnswer: string): Promise<GradeResult> {
  const res = await completeJson({
    system: GRADE_SYSTEM_PROMPT,
    prompt: gradeShortPrompt(q, userAnswer),
    schema: llmGradeSchema,
    temperature: 0.1,
  })
  return { score: res.score, feedback: res.feedback, gradedBy: 'llm' }
}
