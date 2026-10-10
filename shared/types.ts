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
  'revising',
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

// 课件配图：src 为本地素材路径 /api/topics/<tid>/assets/<file>；originUrl 记原图直链（图片来源展示）
export const lessonImageSchema = z.object({
  src: z.string(),
  alt: z.string().optional(),
  originUrl: z.string().optional(),
  pageUrl: z.string().optional(),
})
export type LessonImage = z.infer<typeof lessonImageSchema>

export const lessonSchema = z.object({
  id: z.string(),
  topicId: z.string(),
  nodeIds: z.array(z.string()),
  scheduleReason: z.string(),
  masterySnapshot: z.record(z.string(), z.number()),
  injectedReports: z.array(z.string()),
  researchNoteIds: z.array(z.string()),
  sources: z.array(lessonSourceSchema),
  images: z.array(lessonImageSchema).optional(), // 旧课件无此字段
  contentMd: z.string(),
  status: lessonStatusSchema,
  createdAt: z.string(),
  revisedAt: z.string().optional(),
  error: z.string().optional(), // status=failed 时的失败原因
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

export const questionSetSchema = z.object({
  generatedAt: z.string().optional(), // 题集生成时间，交卷时做乐观并发校验
  questions: z.array(questionSchema),
})
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

export const masteryChangeSchema = z.object({
  nodeId: z.string(),
  nodeName: z.string(),
  before: z.number(),
  after: z.number(),
  delta: z.number(),
  reason: z.string(),
})
export type MasteryChange = z.infer<typeof masteryChangeSchema>

// 一次测验记录：同一课可多次测验（再次测验生成新题），每次交卷追加一条
export const attemptSchema = z.object({
  id: z.string(),
  lessonId: z.string(),
  // 题目快照（含答案/讲解），回看历史记录用；旧格式记录可能缺失
  questions: z.array(questionSchema).default([]),
  records: z.array(answerRecordSchema),
  masteryChanges: z.array(masteryChangeSchema).default([]),
  status: z.enum(['in_progress', 'submitted', 'graded']),
  createdAt: z.string().default(''),
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

// 研究阶段收集的配图：url 为原图直链，localPath 为下载落地后的课件引用路径
export const researchImageSchema = z.object({
  url: z.string(),
  title: z.string().optional(),
  pageUrl: z.string().optional(),
  localPath: z.string().optional(),
})
export type ResearchImage = z.infer<typeof researchImageSchema>

export const researchNoteSchema = z.object({
  id: z.string(),
  nodeId: z.string(),
  concepts: z.array(z.string()),
  derivations: z.array(z.string()),
  examples: z.array(z.string()),
  pitfalls: z.array(z.string()),
  sources: z.array(researchSourceSchema),
  images: z.array(researchImageSchema).optional(), // 旧笔记无此字段
  searchQueries: z.array(z.string()),
  version: z.number(),
  updatedAt: z.string(),
})
export type ResearchNote = z.infer<typeof researchNoteSchema>

// ---------- 学习者偏好档案 ----------
export const preferenceSourceSchema = z.object({
  kind: z.enum(['manual', 'lesson-chat', 'lesson-revise', 'report']),
  label: z.string().optional(), // 来源描述，如「双塔召回」课件对话
})
export type PreferenceSource = z.infer<typeof preferenceSourceSchema>

export const preferenceSchema = z.object({
  id: z.string(),
  text: z.string().min(1).max(200),
  source: preferenceSourceSchema,
  createdAt: z.string(),
})
export type Preference = z.infer<typeof preferenceSchema>

// ---------- 通用工具 ----------
// 掌握分颜色：红 <40 / 黄 40-79 / 绿 ≥80（PRD 领域规则）
export function masteryLevel(mastery: number): 'red' | 'yellow' | 'green' {
  if (mastery < 40) return 'red'
  if (mastery < 80) return 'yellow'
  return 'green'
}

// 掌握分 ≥80 视为已掌握，解锁下游
export const MASTERY_UNLOCK_THRESHOLD = 80
