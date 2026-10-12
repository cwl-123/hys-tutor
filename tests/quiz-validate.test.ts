import { describe, expect, it } from 'vitest'
import { partitionQuestionDrafts, validateQuestionDraft } from '../shared/quiz-validate'

describe('validateQuestionDraft', () => {
  it('合法题目通过', () => {
    expect(
      validateQuestionDraft(
        { type: 'single', prompt: 'p', options: ['a', 'b', 'c', 'd'], answer: 'B' },
        0,
      ),
    ).toBeNull()
    expect(validateQuestionDraft({ type: 'judge', prompt: 'p', answer: '对' }, 0)).toBeNull()
    expect(validateQuestionDraft({ type: 'short', prompt: 'p', referenceAnswer: 'r' }, 0)).toBeNull()
  })

  it('single 缺 options / 缺 answer / answer 越界都被拦下', () => {
    expect(validateQuestionDraft({ type: 'single', prompt: 'p', answer: 'A' }, 0)).toContain('选项')
    expect(
      validateQuestionDraft({ type: 'single', prompt: 'p', options: ['a', 'b'] }, 0),
    ).toContain('字母')
    expect(
      validateQuestionDraft({ type: 'single', prompt: 'p', options: ['a', 'b'], answer: 'D' }, 0),
    ).toContain('超出选项范围')
  })

  it('judge 答案必须能对/错归一；short 必须有参考答案', () => {
    expect(validateQuestionDraft({ type: 'judge', prompt: 'p', answer: '可能吧' }, 1)).toContain(
      '对/错',
    )
    expect(validateQuestionDraft({ type: 'short', prompt: 'p' }, 2)).toContain('参考答案')
    expect(validateQuestionDraft({ type: 'single', prompt: '  ', options: ['a', 'b'], answer: 'A' }, 0)).toContain(
      '题干为空',
    )
  })
})

describe('partitionQuestionDrafts', () => {
  it('拆分合法题与坏题，坏题带原因', () => {
    const { valid, dropped } = partitionQuestionDrafts([
      { type: 'single', prompt: 'p', options: ['a', 'b', 'c', 'd'], answer: 'B' },
      { type: 'judge', prompt: 'p', answer: '没准' },
      { type: 'short', prompt: 'p', referenceAnswer: 'r' },
    ])
    expect(valid).toHaveLength(2)
    expect(dropped).toHaveLength(1)
    expect(dropped[0]).toContain('第2题')
  })
})
