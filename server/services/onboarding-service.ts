import type { OnboardingAttachmentRef } from '../../shared/types'
import { completeJson } from '../llm/client'
import {
  ONBOARDING_SYSTEM_PROMPT,
  llmOnboardingSchema,
  onboardingUserPrompt,
  type OnboardingPromptAttachment,
} from '../llm/prompts/onboarding'
import {
  loadOnboardingAttachments,
  readAttachmentImageDataUrl,
  type StoredAttachment,
} from './onboarding-attachments'
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

export interface OnboardingChatMessage {
  role: 'user' | 'assistant'
  content: string
  attachments?: OnboardingAttachmentRef[]
}

// 对话轮次上限：达到后强制 AI 收敛出提案，防止无限闲聊
export const ONBOARDING_MAX_TURNS = 8

function cleanText(v: string | undefined): string | undefined {
  const t = v?.trim()
  return t ? t.slice(0, 60) : undefined
}

// 附件正文注入上限：单文件 6000 字、单轮合计 12000 字，避免把上下文撑爆
const MAX_ATTACHMENT_CHARS = 6000
const MAX_TOTAL_ATTACHMENT_CHARS = 12000

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

// 只把「最新一条用户消息」的附件正文送进提示词；更早的附件在历史里保留文件名，
// 其内容已经由上一轮 AI 回复吸收，不必每轮重复搬运（省 token，也避免超长）。
function buildPromptAttachments(
  lastUser: OnboardingChatMessage | undefined,
  loaded: StoredAttachment[],
): OnboardingPromptAttachment[] {
  const refs = lastUser?.attachments ?? []
  if (!refs.length) return []
  const byId = new Map(loaded.map((r) => [r.id, r]))
  let remaining = MAX_TOTAL_ATTACHMENT_CHARS
  return refs.map((ref) => {
    const record = byId.get(ref.id)
    if (!record) return { name: ref.name, kind: ref.kind, missing: true }
    if (record.kind === 'image') return { name: record.name, kind: 'image' }
    const full = record.text ?? ''
    const text = full.slice(0, Math.max(0, Math.min(MAX_ATTACHMENT_CHARS, remaining)))
    remaining -= text.length
    return {
      name: record.name,
      kind: 'text',
      text,
      chars: record.chars,
      truncated: record.truncated || text.length < full.length,
    }
  })
}

// 开课对话：根据对话历史产出引导提问或方向提案；用户发言中的长期偏好异步落档
export async function chatOnboarding(messages: OnboardingChatMessage[]): Promise<OnboardingReply> {
  const userTurns = messages.filter((m) => m.role === 'user').length
  const forceProposal = userTurns >= ONBOARDING_MAX_TURNS
  const lastUser = [...messages].reverse().find((m) => m.role === 'user')

  const loaded = lastUser ? await loadOnboardingAttachments(lastUser.attachments) : []
  const promptAttachments = buildPromptAttachments(lastUser, loaded)
  const imageDataUrls = (
    await Promise.all(
      loaded.filter((r) => r.kind === 'image').map((r) => readAttachmentImageDataUrl(r)),
    )
  ).filter((url): url is string => !!url)

  const [result] = await Promise.all([
    completeJson({
      system: ONBOARDING_SYSTEM_PROMPT,
      prompt: onboardingUserPrompt(
        messages.map((m) => ({
          role: m.role,
          content: m.content,
          attachmentNames: m.attachments?.map((a) => a.name),
        })),
        { forceProposal, attachments: promptAttachments },
      ),
      schema: llmOnboardingSchema,
      temperature: 0.4,
      imageDataUrls,
    }),
    lastUser?.content.trim()
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
