import { describe, expect, it } from 'vitest'
import { llmOutlineSchema } from '../server/llm/prompts/outline'

// 大纲是全链路里模型最爱「小地方走样」的一步：citations 写成字符串、difficulty 写成近义词、
// objectives 多给一条。这些都是可归一的小错，不该整轮重试。
function base(over: Record<string, unknown> = {}) {
  return {
    focus: '讲清 AUC 与 GAUC',
    objectives: ['能解释 AUC', '能区分 AUC 与 GAUC'],
    difficulty: '进阶',
    sections: [
      { title: '引入', points: ['场景'], citations: [1] },
      { title: '核心', points: ['定义'], citations: [1, 2] },
      { title: '小结', points: ['回顾'], citations: [] },
    ],
    teachingNotes: '',
    ...over,
  }
}

describe('大纲 schema 归一', () => {
  it('标准输出原样通过', () => {
    const parsed = llmOutlineSchema.parse(base())
    expect(parsed.difficulty).toBe('进阶')
    expect(parsed.sections[1].citations).toEqual([1, 2])
  })

  it('citations 写成 ["1", "[2,3]"] 也能归一成数字', () => {
    const parsed = llmOutlineSchema.parse(
      base({
        sections: [
          { title: 'a', points: ['x'], citations: ['1', '[2, 3]'] },
          { title: 'b', points: ['y'], citations: '4' },
          { title: 'c', points: ['z'] },
        ],
      }),
    )
    expect(parsed.sections[0].citations).toEqual([1, 2, 3])
    expect(parsed.sections[1].citations).toEqual([4])
    expect(parsed.sections[2].citations).toEqual([])
  })

  it('citations 里的 0 / 负数 / 非数字被剔除', () => {
    const parsed = llmOutlineSchema.parse(
      base({
        sections: [
          { title: 'a', points: ['x'], citations: [0, -1, 'abc', 2] },
          { title: 'b', points: ['y'], citations: [] },
          { title: 'c', points: ['z'], citations: [] },
        ],
      }),
    )
    expect(parsed.sections[0].citations).toEqual([2])
  })

  it('difficulty 写成近义词也能落到三档', () => {
    expect(llmOutlineSchema.parse(base({ difficulty: '中等' })).difficulty).toBe('进阶')
    expect(llmOutlineSchema.parse(base({ difficulty: '基础' })).difficulty).toBe('入门')
    expect(llmOutlineSchema.parse(base({ difficulty: '困难' })).difficulty).toBe('高级')
    expect(llmOutlineSchema.parse(base({ difficulty: '随便写' })).difficulty).toBe('进阶')
  })

  it('objectives 超过 4 条截断，points 只给一段字符串则按行拆', () => {
    const parsed = llmOutlineSchema.parse(
      base({
        objectives: ['a', 'b', 'c', 'd', 'e'],
        sections: [
          { title: 'a', points: '第一点\n第二点', citations: [1] },
          { title: 'b', points: ['y'], citations: [1] },
          { title: 'c', points: ['z'], citations: [1] },
        ],
      }),
    )
    expect(parsed.objectives).toHaveLength(4)
    expect(parsed.sections[0].points).toEqual(['第一点', '第二点'])
  })

  it('section 少于 3 个仍然判失败（内容确实不够）', () => {
    expect(
      llmOutlineSchema.safeParse(
        base({ sections: [{ title: 'a', points: ['x'], citations: [1] }] }),
      ).success,
    ).toBe(false)
  })
})