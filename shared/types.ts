import { z } from 'zod'

// ---------- 课题 ----------
export const topicProfileSchema = z.object({
  style: z.string().optional().describe('偏好的教学风格，如：通俗直观/严谨推导/实战代码/案例驱动'),
  level: z.string().optional().describe('当前掌握程度，如：完全新手/有一定基础/比较熟悉想精进'),
  extra: z.string().optional().describe('用户自定义的额外要求'),
})
export type TopicProfile = z.infer<typeof topicProfileSchema>

export const topicSchema = z.object({
  id: z.string(),
  name: z.string(),
  createdAt: z.string(),
  llmModel: z.string().optional(),
  profile: topicProfileSchema.optional(),
})
export type Topic = z.infer<typeof topicSchema>

// ---------- 知识图谱 ----------
export const knowledgeNodeSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  deps: z.array(z.string()),
  mastery: z.number().min(0).max(100),
  manualEdited: z.boolean().default(false),
})
export type KnowledgeNode = z.infer<typeof knowledgeNodeSchema>

export const graphSchema = z.object({
  nodes: z.array(knowledgeNodeSchema),
  updatedAt: z.string(),
})
export type Graph = z.infer<typeof graphSchema>

// ---------- 课程 ----------
export const lessonStatusSchema = z.enum([
  'researching',
  'outlining',
  'writing',
  'self-checking',
  'generated',
  'failed',
])
export type LessonStatus = z.infer<typeof lessonStatusSchema>

export const lessonSourceSchema = z.object({
  idx: z.number(),
  title: z.string(),
  url: z.string(),
})
export type LessonSource = z.infer<typeof lessonSourceSchema>

export const lessonSchema = z.object({
  id: z.string(),
  topicId: z.string(),
  nodeIds: z.array(z.string()),
  scheduleReason: z.string(),
  masterySnapshot: z.record(z.string(), z.number()),
  injectedReports: z.array(z.string()),
  researchNoteIds: z.array(z.string()),
  sources: z.array(lessonSourceSchema),
  contentMd: z.string(),
  status: lessonStatusSchema,
  createdAt: z.string(),
})
export type Lesson = z.infer<typeof lessonSchema>

// ---------- 题目 ----------
export const questionTypeSchema = z.enum(['single', 'judge', 'short'])
export type QuestionType = z.infer<typeof questionTypeSchema>

export const questionSchema = z.object({
  id: z.string(),
  nodeId: z.string(),
  type: questionTypeSchema,
  prompt: z.string(),
  options: z.array(z.string()).optional(),
  answer: z.string().optional(),
  referenceAnswer: z.string().optional(),
  explanation: z.string().optional(),
})
export type Question = z.infer<typeof questionSchema>

export const questionSetSchema = z.object({ questions: z.array(questionSchema) })
export type QuestionSet = z.infer<typeof questionSetSchema>

// ---------- 答题与批改 ----------
export const gradeResultSchema = z.object({
  correct: z.boolean().optional(),
  score: z.number().min(0).max(1).optional(),
  feedback: z.string().optional(),
  gradedBy: z.enum(['local', 'llm']),
})
export type GradeResult = z.infer<typeof gradeResultSchema>

export const answerRecordSchema = z.object({
  questionId: z.string(),
  userAnswer: z.string(),
  result: gradeResultSchema.optional(),
  submittedAt: z.string(),
})
export type AnswerRecord = z.infer<typeof answerRecordSchema>

export const attemptSchema = z.object({
  lessonId: z.string(),
  records: z.array(answerRecordSchema),
  status: z.enum(['in_progress', 'submitted', 'graded']),
})
export type Attempt = z.infer<typeof attemptSchema>

// ---------- 掌握分流水 ----------
export const masteryLogEntrySchema = z.object({
  id: z.string(),
  nodeId: z.string(),
  before: z.number(),
  after: z.number(),
  delta: z.number(),
  reason: z.string(),
  sourceType: z.enum(['question', 'manual']),
  createdAt: z.string(),
})
export type MasteryLogEntry = z.infer<typeof masteryLogEntrySchema>

// ---------- 报错记录 ----------
export const errorReportSchema = z.object({
  id: z.string(),
  targetType: z.enum(['lesson', 'question']),
  targetId: z.string(), // questionId（题目报错）或 lessonId（课程报错）
  lessonId: z.string(),
  nodeId: z.string(),
  quote: z.string(),
  note: z.string().optional(),
  createdAt: z.string(),
})
export type ErrorReport = z.infer<typeof errorReportSchema>

// POST /api/reports 入参
export const reportInputSchema = z.object({
  lessonId: z.string(),
  questionId: z.string().optional(),
  nodeId: z.string(),
  quote: z.string().min(1).max(1000),
  note: z.string().max(500).optional(),
})
export type ReportInput = z.infer<typeof reportInputSchema>

// ---------- 研究笔记（备课 Agent 产出，按知识点缓存） ----------
export const researchSourceSchema = z.object({
  title: z.string(),
  url: z.string(),
  fetchedAt: z.string(),
})
export type ResearchSource = z.infer<typeof researchSourceSchema>

export const researchNoteSchema = z.object({
  id: z.string(),
  nodeId: z.string(),
  concepts: z.array(z.string()),
  derivations: z.array(z.string()),
  examples: z.array(z.string()),
  pitfalls: z.array(z.string()),
  sources: z.array(researchSourceSchema),
  searchQueries: z.array(z.string()),
  version: z.number(),
  updatedAt: z.string(),
})
export type ResearchNote = z.infer<typeof researchNoteSchema>

// ---------- 通用工具 ----------
// 掌握分颜色：红 <40 / 黄 40-79 / 绿 ≥80（PRD 领域规则）
export function masteryLevel(mastery: number): 'red' | 'yellow' | 'green' {
  if (mastery < 40) return 'red'
  if (mastery < 80) return 'yellow'
  return 'green'
}

// 掌握分 ≥80 视为已掌握，解锁下游
export const MASTERY_UNLOCK_THRESHOLD = 80
