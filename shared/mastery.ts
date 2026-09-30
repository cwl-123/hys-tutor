// 掌握分算法规则（Design.md §3，MVP 版）
// 阈值集中在 MASTERY_RULES，便于调参；纯函数，前后端共用

export const MASTERY_RULES = {
  objectiveCorrectDelta: 10, // 客观题答对
  objectiveWrongDelta: -8, // 客观题答错
  shortPassScore: 0.6, // 简答及格线
  shortScale: 25, // delta = (score - pass) * scale
  min: 0,
  max: 100,
} as const

export function clampMastery(value: number): number {
  return Math.max(MASTERY_RULES.min, Math.min(MASTERY_RULES.max, Math.round(value)))
}

export interface MasteryDeltaInput {
  type: 'objective' | 'short'
  correct?: boolean // objective
  score?: number // short，0~1
}

// 单题掌握分增减；非法输入返回 0
export function masteryDelta(input: MasteryDeltaInput): number {
  if (input.type === 'objective') {
    if (input.correct === undefined) return 0
    return input.correct ? MASTERY_RULES.objectiveCorrectDelta : MASTERY_RULES.objectiveWrongDelta
  }
  if (input.score === undefined || Number.isNaN(input.score)) return 0
  const score = Math.max(0, Math.min(1, input.score))
  return Math.round((score - MASTERY_RULES.shortPassScore) * MASTERY_RULES.shortScale)
}
