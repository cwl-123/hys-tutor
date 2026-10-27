import { completeJson } from '../llm/client'
import {
  ONBOARDING_SYSTEM_PROMPT,
  llmOnboardingSchema,
  onboardingUserPrompt,
} from '../llm/prompts/onboarding'
import { safeExtractPreferences } from './preference-service'
import type { TopicProfile } from '../../shared/types'

export interface OnboardingProposal {
  name: string
  scope: string
  profile: TopicProfile
}

export interface OnboardingReply {
  reply: string
  quickReplies: string[]
  proposal?: OnboardingProposal
}

// 对话轮次上限：达到后强制 AI 收敛出提案，防止无限闲聊
export const ONBOARDING_MAX_TURNS = 8

function cleanText(v: string | undefined): string | undefined {
  const t = v?.trim()
  return t ? t.slice(0, 60) : undefined
}

function composeProfile(p: {
  style?: string
  level?: string
  extra?: string
  knownTopics: string[]
}): TopicProfile {
  const parts: string[] = []
  const known = p.knownTopics.map((t) => t.trim()).filter(Boolean)
  if (known.length) parts.push(`已熟悉：${known.join('、')}，相关基础可简要带过`)
  if (p.extra?.trim()) parts.push(p.extra.trim())
  const profile: TopicProfile = {}
  const style = cleanText(p.style)
  const level = cleanText(p.level)
  if (style) profile.style = style
  if (level) profile.level = level
  if (parts.length) profile.extra = parts.join('；')
  return profile
}

// 开课对话：根据对话历史产出引导提问或方向提案；用户发言中的长期偏好异步落档
export async function chatOnboarding(
  messages: { role: 'user' | 'assistant'; content: string }[],
): Promise<OnboardingReply> {
  const userTurns = messages.filter((m) => m.role === 'user').length
  const forceProposal = userTurns >= ONBOARDING_MAX_TURNS
  const lastUser = [...messages].reverse().find((m) => m.role === 'user')

  const [result] = await Promise.all([
    completeJson({
      system: ONBOARDING_SYSTEM_PROMPT,
      prompt: onboardingUserPrompt(messages, { forceProposal }),
      schema: llmOnboardingSchema,
      temperature: 0.4,
    }),
    lastUser
      ? safeExtractPreferences(lastUser.content, { kind: 'onboarding', label: '开课对话' })
      : Promise.resolve([]),
  ])

  if (!result.proposal) {
    return { reply: result.reply, quickReplies: result.quickReplies.slice(0, 4) }
  }
  return {
    reply: result.reply,
    quickReplies: [],
    proposal: {
      name: result.proposal.name.trim(),
      scope: result.proposal.scope.trim(),
      profile: composeProfile(result.proposal),
    },
  }
}
