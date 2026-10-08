import { z } from 'zod'

// ---------- 课件 AI 对话式优化 ----------
// 用户引用：可只带章节（改本节）或只带选中的一段话（划词引用）
export const lessonQuoteSchema = z.object({
  heading: z.string().optional(),
  text: z.string().optional(),
})
export type LessonQuote = z.infer<typeof lessonQuoteSchema>

// AI 修改建议：contentMd 为应用后的完整正文（局部修改时仅替换了目标章节）
export const lessonChatProposalSchema = z.object({
  contentMd: z.string(),
  scope: z.enum(['full', 'section']),
  targetHeading: z.string().optional(),
  summary: z.string(),
})
export type LessonChatProposal = z.infer<typeof lessonChatProposalSchema>

export const lessonChatMessageSchema = z.object({
  id: z.string(),
  role: z.enum(['user', 'assistant']),
  content: z.string(),
  quote: lessonQuoteSchema.optional(),
  proposal: lessonChatProposalSchema.optional(),
  applied: z.boolean().default(false),
  createdAt: z.string(),
})
export type LessonChatMessage = z.infer<typeof lessonChatMessageSchema>

// 课件修改版本（应用前快照，供撤销）
export const lessonVersionSchema = z.object({
  id: z.string(),
  contentMd: z.string(),
  summary: z.string(),
  createdAt: z.string(),
})
export type LessonVersion = z.infer<typeof lessonVersionSchema>