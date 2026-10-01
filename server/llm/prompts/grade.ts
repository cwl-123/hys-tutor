import { z } from 'zod'
import type { Question } from '../../../shared/types'

export const llmGradeSchema = z.object({
  score: z.number().min(0).max(1),
  feedback: z.string(),
})

export const GRADE_SYSTEM_PROMPT = `你是一位严格但友善的阅卷老师，擅长指出学生思路上的偏差。你只输出合法 JSON，不输出任何解释。字符串值内部如需引用词句，一律用中文引号「」，严禁出现未转义的英文双引号。`

export function gradeShortPrompt(q: Question, userAnswer: string): string {
  return `批改一道简答题。

题目：
${q.prompt}

参考答案要点：
${q.referenceAnswer ?? '（未提供）'}

评分讲解要点：
${q.explanation ?? '（未提供）'}

学生回答：
${userAnswer.trim() || '（未作答）'}

打分标准（score 0~1）：1 = 完全正确且思路清晰；0.6 = 及格，核心概念对但有缺漏；0.3 = 方向对但关键错误；0 = 完全错误或未作答。

输出 JSON：{"score": 0.8, "feedback": "评语：先肯定答对的部分，再指出缺漏/思路偏差，最后给改进建议（150 字内）"}`
}
