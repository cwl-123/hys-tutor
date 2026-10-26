import { describe, expect, it } from 'vitest'
import { QUIZ_SYSTEM_PROMPT, quizPrompt } from '../server/llm/prompts/quiz'
import { SELFCHECK_SYSTEM_PROMPT, selfCheckPrompt } from '../server/llm/prompts/selfcheck'
import { QUESTION_FIELD_CHECKLIST, QUESTION_OUTPUT_SAMPLE } from '../server/llm/prompts/question-format'

const node = {
  id: 'n1',
  name: '离线评估指标',
  description: 'AUC 等离线指标',
  deps: [],
  mastery: 50,
  manualEdited: false,
  x: 0,
  y: 0,
}
const note = {
  id: 'note1',
  nodeId: 'n1',
  concepts: ['AUC 是排序指标'],
  derivations: [],
  examples: [],
  pitfalls: [],
  sources: [{ title: 'A', url: 'https://example.com', fetchedAt: '' }],
  images: [],
  searchQueries: [],
  version: 1,
  updatedAt: '',
}

const content = '## 引入\nAUC 讲的是排序能力 [1]。'

describe('出题提示词', () => {
  it('两种题型样例都覆盖 single/judge/short 三种题型', () => {
    const types = [...QUESTION_OUTPUT_SAMPLE.matchAll(/"type": "(\w+)"/g)].map((m) => m[1])
    expect(types).toEqual(['single', 'single', 'judge', 'judge', 'short'])
  })

  it('样例里的 options 不带 "A." 前缀（与正文规则一致，避免自相矛盾）', () => {
    expect(QUESTION_OUTPUT_SAMPLE).not.toMatch(/"options": \["A\./)
    expect(QUIZ_SYSTEM_PROMPT.length).toBeGreaterThan(0)
    expect(SELFCHECK_SYSTEM_PROMPT.length).toBeGreaterThan(0)
  })

  it('再次测验会把上一轮剔除原因回灌给模型', () => {
    const prompt = quizPrompt(node, note, content, [], ['第5题（short）简答题缺少参考答案'])
    expect(prompt).toContain('上一轮出题有以下结构问题')
    expect(prompt).toContain('第5题（short）简答题缺少参考答案')
    expect(prompt).toContain(QUESTION_FIELD_CHECKLIST)
  })

  it('首次出题（无历史问题）不出现重试段落', () => {
    const prompt = quizPrompt(node, note, content, [])
    expect(prompt).not.toContain('上一轮出题有以下结构问题')
  })

  it('自查出题同样带字段核对清单与 5 题样例', () => {
    const prompt = selfCheckPrompt(node, note as never, content, ['能解释 AUC'])
    expect(prompt).toContain(QUESTION_FIELD_CHECKLIST)
    expect(prompt).toContain('referenceAnswer')
    expect(prompt).toContain('2 single + 2 judge + 1 short')
  })

  it('自查重试把剔除原因与明确字段要求一起回灌', () => {
    const prompt = selfCheckPrompt(node, note as never, content, [], ['第5题（short）简答题缺少参考答案'])
    expect(prompt).toContain('第5题（short）简答题缺少参考答案')
    expect(prompt).toContain('short 题必须给 referenceAnswer')
  })
})