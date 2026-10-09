import { describe, expect, it } from 'vitest'
import { llmSelfCheckSchema } from '../server/llm/prompts/selfcheck'
import { llmQuizSchema } from '../server/llm/prompts/quiz'

function q(type: 'single' | 'judge' | 'short') {
  return { type, prompt: '题干', options: type === 'single' ? ['A', 'B', 'C', 'D'] : undefined, answer: 'B', explanation: '讲解' }
}

// 课末题集固定 5 题：2 单选 + 2 判断 + 1 简答
describe('出题 schema', () => {
  it('自查出题：恰好 5 题，多/少都拒绝', () => {
    const five = { issues: [], questions: [q('single'), q('single'), q('judge'), q('judge'), q('short')] }
    expect(llmSelfCheckSchema.safeParse(five).success).toBe(true)
    expect(llmSelfCheckSchema.safeParse({ ...five, questions: five.questions.slice(0, 3) }).success).toBe(false)
    expect(llmSelfCheckSchema.safeParse({ ...five, questions: [...five.questions, q('judge')] }).success).toBe(false)
  })

  it('自查出题：issues 为对象数组时也能解析并归一成字符串', () => {
    const five = {
      issues: [{ location: '第 4 节', problem: '与笔记矛盾' }],
      questions: [q('single'), q('single'), q('judge'), q('judge'), q('short')],
    }
    const parsed = llmSelfCheckSchema.safeParse(five)
    expect(parsed.success).toBe(true)
    expect(parsed.success && parsed.data.issues).toEqual(['第 4 节：与笔记矛盾'])
    expect(parsed.success && parsed.data.needsCorrection).toBe(false)
  })

  it('再次测验出题：恰好 5 题', () => {
    const five = { questions: [q('single'), q('single'), q('judge'), q('judge'), q('short')] }
    expect(llmQuizSchema.safeParse(five).success).toBe(true)
    expect(llmQuizSchema.safeParse({ questions: five.questions.slice(0, 4) }).success).toBe(false)
  })
})
