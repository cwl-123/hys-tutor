// 出题结构校验：LLM 通过 zod schema 只保证字段形状，不保证语义合法
// （single 可能缺 options/answer，导致判分时 answer ?? '' 永远判错）。
// 这里做语义级校验，坏题必须被拦下而不是悄悄进课件。

export interface QuestionDraftLike {
  type: 'single' | 'judge' | 'short'
  prompt: string
  options?: string[]
  answer?: string
  referenceAnswer?: string
  explanation?: string
}

const JUDGE_ANSWERS = new Set(['对', '错', '正确', '错误', '√', '×', 'T', 'F', 'TRUE', 'FALSE', 'YES', 'NO'])

// 返回 null 表示合法；否则返回一句人话原因（用于日志/进度展示）
export function validateQuestionDraft(q: QuestionDraftLike, index: number): string | null {
  const label = `第${index + 1}题（${q.type}）`
  if (!q.prompt?.trim()) return `${label}题干为空`
  if (q.type === 'single') {
    const options = (q.options ?? []).map((o) => o.trim()).filter(Boolean)
    if (options.length < 2) return `${label}选项不足 2 个`
    const letter = q.answer?.trim().toUpperCase().match(/^[A-Z]/)?.[0]
    if (!letter) return `${label}缺少正确选项字母`
    if (letter.charCodeAt(0) - 65 >= options.length) {
      return `${label}答案 ${letter} 超出选项范围（共 ${options.length} 个选项）`
    }
    return null
  }
  if (q.type === 'judge') {
    const a = q.answer?.trim() ?? ''
    if (!JUDGE_ANSWERS.has(a) && !JUDGE_ANSWERS.has(a.toUpperCase())) {
      return `${label}判断题答案必须是「对/错」，实际为「${a || '空'}」`
    }
    return null
  }
  // short
  if (!q.referenceAnswer?.trim()) return `${label}简答题缺少参考答案`
  return null
}

// 拆分合法/坏题；dropped 为逐题剔除原因
export function partitionQuestionDrafts<T extends QuestionDraftLike>(
  drafts: T[],
): { valid: T[]; dropped: string[] } {
  const valid: T[] = []
  const dropped: string[] = []
  drafts.forEach((d, i) => {
    const reason = validateQuestionDraft(d, i)
    if (reason) dropped.push(reason)
    else valid.push(d)
  })
  return { valid, dropped }
}
