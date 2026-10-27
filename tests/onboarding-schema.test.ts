import { describe, expect, it } from 'vitest'
import { llmOnboardingSchema } from '../server/llm/prompts/onboarding'

// 线上 500 回归用例：模型澄清阶段显式输出 proposal: null，旧的 .optional() 会判失败
// 进而重试 3 次后抛错（前端只看到「服务器内部错误」）。这里锁死两种合法形态。
describe('llmOnboardingSchema', () => {
  it('接受 proposal 为 null 的澄清回复', () => {
    const payload = {
      reply: '沪教版2024的一元二次方程，方向很清楚。先确认一句：这份讲义是你自己学，还是备课/辅导用？',
      quickReplies: ['我自己学，初中生', '我是老师，备课用', '帮孩子辅导用'],
      proposal: null,
    }
    const parsed = llmOnboardingSchema.parse(payload)
    expect(parsed.proposal).toBeNull()
    expect(parsed.quickReplies).toHaveLength(3)
  })

  it('接受省略 proposal 的回复', () => {
    const parsed = llmOnboardingSchema.parse({ reply: '再问一句', quickReplies: ['A'] })
    expect(parsed.proposal).toBeUndefined()
  })

  it('接受非计算机学科的自定义 style/level', () => {
    const payload = {
      reply: '那我先按同步讲义出一版方向',
      quickReplies: [],
      proposal: {
        name: '沪教版2024 一元二次方程：同步讲义与解题训练',
        scope: '概念与一般式 → 四种解法 → 判别式与韦达定理 → 实际问题建模 → 章节复盘',
        style: '教材同步讲解 + 例题步骤拆解',
        level: '初中（八/九年级）零基础起步，随章节递进',
        knownTopics: [],
        extra: '严格对齐沪教版2024 教材的章节顺序与符号习惯',
      },
    }
    const parsed = llmOnboardingSchema.parse(payload)
    expect(parsed.proposal?.style).toBe('教材同步讲解 + 例题步骤拆解')
    expect(parsed.proposal?.level).toBe('初中（八/九年级）零基础起步，随章节递进')
  })

  it('仍然拒绝结构错误的提案（缺少 name）', () => {
    const r = llmOnboardingSchema.safeParse({
      reply: 'x',
      quickReplies: [],
      proposal: { scope: '只有范围' },
    })
    expect(r.success).toBe(false)
  })
})
