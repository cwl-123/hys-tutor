import { getDb } from '../db'
import { currentUserIdOrNull } from '../repo/context'
import { QuotaError } from '../auth/errors'

export type ActionKind = 'topic' | 'lesson' | 'grade' | 'chat'

const DEFAULT_LIMITS: Record<ActionKind, number> = {
  topic: 5,
  lesson: 10,
  grade: 100,
  chat: 300,
}

const ENV_KEY: Record<ActionKind, string> = {
  topic: 'QUOTA_TOPICS_PER_DAY',
  lesson: 'QUOTA_LESSONS_PER_DAY',
  grade: 'QUOTA_GRADES_PER_DAY',
  chat: 'QUOTA_CHATS_PER_DAY',
}

const LABEL: Record<ActionKind, string> = {
  topic: '新建学习方向',
  lesson: '生成课程',
  grade: '交卷批改',
  chat: 'AI 对话',
}

export function limitFor(kind: ActionKind): number {
  const raw = process.env[ENV_KEY[kind]]
  const n = raw ? Number(raw) : NaN
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_LIMITS[kind]
}

export function startOfToday(): string {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d.toISOString()
}

function usedToday(userId: string, kind: ActionKind): number {
  const row = getDb()
    .prepare(
      `SELECT COUNT(*) AS n FROM usage_events
       WHERE user_id = ? AND kind = ? AND created_at >= ?`,
    )
    .get(userId, kind, startOfToday()) as { n: number }
  return Number(row.n)
}

export function assertQuota(userId: string, kind: ActionKind): void {
  const limit = limitFor(kind)
  const used = usedToday(userId, kind)
  if (used >= limit) {
    throw new QuotaError(
      `今天的${LABEL[kind]}次数已达上限（${limit} 次），明天 0 点恢复；如确需更多请联系管理员`,
    )
  }
}

// 原子式“检查并占用”：先检查再立即写一条，避免长任务并发时都通过检查
export function consumeQuota(userId: string, kind: ActionKind): void {
  assertQuota(userId, kind)
  recordAction(userId, kind)
}

// 动作开始时记一条（成本为 0），用于配额计数；LLM 调用另记 kind='llm'
export function recordAction(userId: string, kind: ActionKind): void {
  try {
    getDb()
      .prepare(
        `INSERT INTO usage_events (user_id, kind, tokens_in, tokens_out, cost_micros, created_at)
         VALUES (?, ?, 0, 0, 0, ?)`,
      )
      .run(userId, kind, new Date().toISOString())
  } catch (err) {
    console.error('[usage] 记录动作失败', err)
  }
}

export interface LlmUsageInput {
  model: string
  tokensIn: number
  tokensOut: number
  estimated?: boolean
  status?: string
}

// 价格表（元 / 百万 token），可用 env 覆盖；仅用于预算熔断，不追求精确
function pricePerMillion(): { input: number; output: number } {
  return {
    input: Number(process.env.LLM_PRICE_IN_PER_M || 2),
    output: Number(process.env.LLM_PRICE_OUT_PER_M || 8),
  }
}

export function recordLlmUsage(input: LlmUsageInput): void {
  const userId = currentUserIdOrNull()
  if (!userId) return
  const price = pricePerMillion()
  const costMicros = Math.round(
    (input.tokensIn / 1_000_000) * price.input * 1_000_000 +
      (input.tokensOut / 1_000_000) * price.output * 1_000_000,
  )
  try {
    getDb()
      .prepare(
        `INSERT INTO usage_events
           (user_id, kind, model, tokens_in, tokens_out, cost_micros, estimated, status, created_at)
         VALUES (?, 'llm', ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        userId,
        input.model,
        Math.max(0, Math.round(input.tokensIn)),
        Math.max(0, Math.round(input.tokensOut)),
        Math.max(0, costMicros),
        input.estimated ? 1 : 0,
        input.status ?? 'ok',
        new Date().toISOString(),
      )
  } catch (err) {
    console.error('[usage] 记录 LLM 用量失败', err)
  }
}

export interface UsageView {
  actions: Record<ActionKind, { used: number; limit: number }>
  tokensIn: number
  tokensOut: number
  costCny: number
  budgetCny: number
  budgetExceeded: boolean
}

export function getUsage(userId: string): UsageView {
  const rows = getDb()
    .prepare(
      `SELECT kind, COUNT(*) AS n,
              COALESCE(SUM(tokens_in), 0) AS ti,
              COALESCE(SUM(tokens_out), 0) AS to_,
              COALESCE(SUM(cost_micros), 0) AS cost
       FROM usage_events
       WHERE user_id = ? AND created_at >= ?
       GROUP BY kind`,
    )
    .all(userId, startOfToday()) as Array<{
    kind: string
    n: number
    ti: number
    to_: number
    cost: number
  }>

  const actions = {} as UsageView['actions']
  for (const kind of Object.keys(DEFAULT_LIMITS) as ActionKind[]) {
    actions[kind] = { used: 0, limit: limitFor(kind) }
  }
  let tokensIn = 0
  let tokensOut = 0
  let costMicros = 0
  for (const r of rows) {
    if (r.kind in actions) actions[r.kind as ActionKind].used = Number(r.n)
    tokensIn += Number(r.ti)
    tokensOut += Number(r.to_)
    costMicros += Number(r.cost)
  }
  const budgetCny = Number(process.env.DAILY_BUDGET_CNY || 50)
  return {
    actions,
    tokensIn,
    tokensOut,
    costCny: Number((costMicros / 1_000_000).toFixed(4)),
    budgetCny,
    budgetExceeded: costMicros / 1_000_000 >= budgetCny,
  }
}

export function getGlobalSpendToday(): { costCny: number; budgetCny: number; overBudget: boolean } {
  const row = getDb()
    .prepare(
      `SELECT COALESCE(SUM(cost_micros), 0) AS cost
       FROM usage_events WHERE created_at >= ?`,
    )
    .get(startOfToday()) as { cost: number }
  const costCny = Number(row.cost) / 1_000_000
  const budgetCny = Number(process.env.DAILY_BUDGET_CNY || 50)
  return { costCny, budgetCny, overBudget: costCny >= budgetCny }
}

// 全站预算熔断：只挡新任务，批改/对话等便宜操作仍可用
export function assertGlobalBudget(): void {
  const s = getGlobalSpendToday()
  if (s.overBudget) {
    throw new QuotaError('今日全站生成额度已用完，明天 0 点恢复；已生成的课程仍可正常学习', 3600)
  }
}