import type { GradeResult, MasteryLogEntry, Question, Topic } from './types'

// 课题统计（首页卡片展示）
export interface TopicStats {
  nodeCount: number
  lessonCount: number
  lastLessonAt: string | null
}
export type TopicWithStats = Topic & { stats: TopicStats }

// 课程列表项（不含正文，供图谱页挂载展示）
export interface LessonMeta {
  id: string
  title: string
  nodeIds: string[]
  scheduleReason: string
  status:
    | 'researching'
    | 'outlining'
    | 'writing'
    | 'self-checking'
    | 'revising'
    | 'generated'
    | 'failed'
  error?: string // status=failed 时的失败原因
  createdAt: string
  wordCount: number
}

// 交卷接口（POST /api/lessons/:id/submit）前后端共用类型

export interface SubmitAnswerInput {
  questionId: string
  userAnswer: string
}

export interface MasteryChange {
  nodeId: string
  nodeName: string
  before: number
  after: number
  delta: number
  reason: string
}

export interface SubmitResult {
  lessonId: string
  results: Record<string, GradeResult>
  masteryChanges: MasteryChange[]
  masteryLogs: MasteryLogEntry[]
  // 判分后才回传的答案讲解（按 questionId）
  revealed: Record<string, Pick<Question, 'answer' | 'referenceAnswer' | 'explanation'>>
}
