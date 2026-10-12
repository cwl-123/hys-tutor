import { z } from 'zod'

export const llmOnboardingSchema = z.object({
  reply: z.string().describe('给用户的回复：引导提问，或对提案的说明'),
  quickReplies: z
    .array(z.string())
    .max(4)
    .default([])
    .describe('2~4 个快捷回复选项，让用户点选而不是打字；给出提案时必须为空数组'),
  proposal: z
    .object({
      name: z.string().describe('收敛后的具体学习方向名（可调研的课题名）'),
      scope: z.string().describe('学习范围说明：覆盖哪些板块、按什么顺序学（50 字内）'),
      style: z.enum(['通俗直观', '严谨推导', '实战代码', '案例驱动']).optional(),
      level: z.enum(['完全新手', '有一定基础', '比较熟悉想精进']).optional(),
      extra: z.string().optional().describe('额外学习要求（不含已掌握内容）'),
      knownTopics: z.array(z.string()).default([]).describe('用户已熟悉的内容（基础讲解会跳过）'),
    })
    .optional()
    .describe('信息足够时给出的方向提案；仍需澄清时省略'),
})
export type LlmOnboarding = z.infer<typeof llmOnboardingSchema>

export const ONBOARDING_SYSTEM_PROMPT = `你是「课程顾问」，帮一个想自学但描述不清需求的人理清学习方向。通过多轮对话摸清他的目标，最终产出一份结构化的学习方向提案。

引导策略：
1. 每轮最多问 1~2 个问题，禁止一次性列问题清单轰炸用户
2. 提问时附 2~4 个快捷回复选项（quickReplies），选项要具体、互斥、口语化，让用户可以点选而不是打字
3. 主动从用户表述中推断，而非事事追问：用户说「PE、PB 我比较熟」就直接记下，确认即可不必追问细节
4. 要摸清的四件事（按优先级）：① 学习动机与目标场景（学了用来做什么）② 已有基础与盲区（哪些熟、哪些不懂）③ 偏好的讲法（案例/推导/代码）④ 范围边界（哪些不学）
5. 信息足够（通常 2~4 轮）就输出 proposal：
   - name 要收敛成具体、可调研的课题名（如「价值投资：公司基本面分析」而非「看公司」）
   - scope 说明覆盖板块与学习顺序
   - style/level 根据对话推断（用户没明说就给最合理的）
   - knownTopics 记录用户明确表示已熟悉的内容
   - extra 记录其他学习要求（如「多结合真实公司案例」）
6. 用户继续补充或修正时，更新 proposal 并在 reply 里简要说明改了什么
7. 用户跑题时温和拉回：我们是在确定一个学习方向
8. reply 口语化、简短（3 句以内），不要端架子、不要说教

只输出合法 JSON：{"reply": "...", "quickReplies": [...], "proposal": {...}}。还需澄清时省略 proposal；给出 proposal 时 quickReplies 为空数组。`

export function onboardingUserPrompt(
  messages: { role: 'user' | 'assistant'; content: string }[],
  opts: { forceProposal: boolean },
): string {
  const history = messages
    .map((m) => `${m.role === 'user' ? '用户' : '顾问'}：${m.content.slice(0, 500)}`)
    .join('\n')
  const userTurns = messages.filter((m) => m.role === 'user').length
  const directive = opts.forceProposal
    ? '已达到对话轮次上限，本轮必须基于现有信息尽力收敛输出 proposal（可在 reply 中说明确认后还能调整）。'
    : '若信息仍不足请继续提问；信息足够则输出 proposal。'
  return `对话记录：\n${history}\n\n（用户已发言 ${userTurns} 轮）${directive}`
}
