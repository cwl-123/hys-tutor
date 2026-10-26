import OpenAI from 'openai'
import { z } from 'zod'
import { resolveLlm } from '../services/settings-service'
import { recordLlmUsage } from '../services/quota-service'
import { errMsg } from '../../shared/error'

// 配置优先级：.env 平台配置（公网版不再支持页面设置）
export interface ResolvedLlmConfig {
  apiKey: string
  baseUrl?: string
  model: string
}

export function resolveLlmConfig(): ResolvedLlmConfig {
  const r = resolveLlm()
  return { apiKey: r.apiKey, baseUrl: r.baseUrl, model: r.model }
}

let cached: { sig: string; client: OpenAI } | null = null

export function getLLM(): OpenAI {
  const cfg = resolveLlmConfig()
  if (!cfg.apiKey) throw new Error('缺少 LLM API Key：请在服务端 .env 中配置')
  const sig = `${cfg.baseUrl ?? ''}|${cfg.apiKey}`
  if (!cached || cached.sig !== sig) {
    cached = {
      sig,
      client: new OpenAI({
        apiKey: cfg.apiKey,
        baseURL: cfg.baseUrl,
        timeout: Number(process.env.LLM_TIMEOUT_MS || 120_000),
        maxRetries: Number(process.env.LLM_MAX_RETRIES || 2),
      }),
    }
  }
  return cached.client
}

export function getLLMModel(): string {
  const model = resolveLlmConfig().model
  if (!model) throw new Error('缺少 LLM 模型：请在服务端 .env 中配置')
  return model
}

// 修复字符串值内未转义的英文双引号（LLM 高频毛病，语言类课题尤甚）：
// 字符串内遇到的 " 若其后（跳过空白）不是结构符 , } ] : 也不是结尾，则视为内容并转义
export function repairJson(raw: string): string {
  let out = ''
  let inStr = false
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i]
    if (!inStr) {
      if (c === '"') inStr = true
      out += c
      continue
    }
    if (c === '\\') {
      out += c + (raw[i + 1] ?? '')
      i++
      continue
    }
    if (c !== '"') {
      // 字符串内出现未转义的换行/制表符是常见非法 JSON（长 markdown 尤甚），转义兜底
      if (c === '\n') out += '\\n'
      else if (c === '\r') out += '\\r'
      else if (c === '\t') out += '\\t'
      else out += c
      continue
    }
    let j = i + 1
    while (j < raw.length && (raw[j] === ' ' || raw[j] === '\t' || raw[j] === '\n' || raw[j] === '\r')) j++
    const next = raw[j]
    if (next === undefined || next === ',' || next === '}' || next === ']' || next === ':') {
      inStr = false
      out += c
    } else {
      out += '\\"'
    }
  }
  return out
}

// 从 start 起按括号配对找第一个完整 JSON 值的结尾（跳过字符串内容与转义）；
// 找不到返回 -1。用于切掉模型在完整 JSON 后面多吐的碎片。
export function findJsonEnd(text: string, start: number): number {
  let depth = 0
  let inStr = false
  for (let i = start; i < text.length; i++) {
    const c = text[i]
    if (inStr) {
      if (c === '\\') i++
      else if (c === '"') inStr = false
      continue
    }
    if (c === '"') inStr = true
    else if (c === '{' || c === '[') depth++
    else if (c === '}' || c === ']') {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}

// 从 LLM 文本中抠出 JSON（容忍代码围栏和前后废话；二次尝试修复未转义引号）
export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  const raw = fenced ? fenced[1] : text
  const starts: number[] = []
  const firstBracket = raw.search(/[{[]/)
  if (firstBracket < 0) throw new Error('LLM 输出中未找到 JSON')
  starts.push(firstBracket)
  // 正文里先出现了 [1] 这类引用标记时，真正的对象在后面
  const firstBrace = raw.indexOf('{')
  if (firstBrace > firstBracket) starts.push(firstBrace)

  const candidates: string[] = []
  const lastEnd = Math.max(raw.lastIndexOf('}'), raw.lastIndexOf(']'))
  for (const start of starts) {
    // 首选取「括号配平的位置」：模型常在完整 JSON 后面续吐一段碎片
    // （如 "]}, ], \"teachingNotes\""），用 lastIndexOf 会把尾巴一起切进来导致整轮报废
    const balanced = findJsonEnd(raw, start)
    if (balanced > start) candidates.push(raw.slice(start, balanced + 1))
    if (lastEnd > start && lastEnd !== balanced) candidates.push(raw.slice(start, lastEnd + 1))
  }
  if (candidates.length === 0) throw new Error('LLM 输出的 JSON 不完整')

  let firstErr: unknown
  let primitive: unknown
  let hasPrimitive = false
  let best: { value: unknown; len: number } | null = null
  for (const slice of candidates) {
    let parsed: unknown
    try {
      parsed = JSON.parse(slice)
    } catch (err) {
      firstErr ??= err
      try {
        parsed = JSON.parse(repairJson(slice))
      } catch {
        continue // 尝试下一个切法
      }
    }
    // 解析成数字/字符串说明切错位置了（切到了 "[1]" 这类引用），留作兜底继续找
    if (parsed === null || typeof parsed !== 'object') {
      if (!hasPrimitive) {
        primitive = parsed
        hasPrimitive = true
      }
      continue
    }
    // 多个起点都能解析时取最长的：完整 JSON 一定比正文里的 [1] 长
    if (!best || slice.length > best.len) best = { value: parsed, len: slice.length }
  }
  if (best) return best.value
  if (hasPrimitive) return primitive
  throw firstErr instanceof Error ? firstErr : new Error('LLM 输出的 JSON 无法解析')
}

// zod 报错压成一行人话：英文 issue 对模型没用，字段路径 + 期望才管用
export function formatZodIssues(err: unknown): string {
  if (!(err instanceof z.ZodError)) return errMsg(err)
  return err.issues
    .slice(0, 6)
    .map((i) => `${i.path.join('.') || '(根)'}：${i.message}`)
    .join('；')
}

// JSON 模式（response_format=json_object）能力缓存：null=未探测
let jsonModeCapability: boolean | null = null

// provider 不支持 response_format 时会回 400；只在参数被拒时降级，其余错误照抛
function isUnsupportedParamError(err: unknown): boolean {
  const e = err as { status?: number; message?: string; error?: { message?: string } }
  const msg = `${e?.message ?? ''} ${e?.error?.message ?? ''}`.toLowerCase()
  const aboutParam = msg.includes('response_format') || msg.includes('json_object') || msg.includes('json mode')
  return aboutParam && (e?.status === 400 || e?.status === 422 || e?.status === 404 || e?.status === undefined)
}

// 单轮 JSON 完成：输出经 zod 校验，失败带错误信息重试（共 3 次）
export async function completeJson<T>(opts: {
  system: string
  prompt: string
  schema: z.ZodType<T>
  temperature?: number
}): Promise<T> {
  const llm = getLLM()
  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: 'system', content: opts.system },
    { role: 'user', content: opts.prompt },
  ]
  let lastErr: unknown
  let attempt = 0
  while (attempt < 3) {
    const model = getLLMModel()
    const wantJsonMode = process.env.LLM_JSON_MODE !== '0' && jsonModeCapability !== false
    let res: OpenAI.Chat.Completions.ChatCompletion
    try {
      res = await llm.chat.completions.create({
        model,
        messages,
        temperature: opts.temperature ?? 0.3,
        // 强约束成 JSON：模型少吐一句解释，就少一类「JSON 里混碎片」的报废
        ...(wantJsonMode ? { response_format: { type: 'json_object' as const } } : {}),
      })
      if (wantJsonMode) jsonModeCapability = true
    } catch (err) {
      if (wantJsonMode && isUnsupportedParamError(err)) {
        jsonModeCapability = false
        console.warn('[completeJson] provider 不支持 response_format，降级为纯文本 JSON 解析', {
          message: errMsg(err),
        })
        continue // 不计入重试次数，同一轮换普通模式再来一次
      }
      throw err
    }
    attempt++
    recordLlmUsage({
      model,
      tokensIn: res.usage?.prompt_tokens ?? 0,
      tokensOut: res.usage?.completion_tokens ?? 0,
      status: 'ok',
    })
    const text = res.choices[0]?.message?.content ?? ''
    try {
      if (!text.trim()) throw new Error('模型返回空内容')
      return opts.schema.parse(extractJson(text))
    } catch (err) {
      lastErr = err
      // 排障关键：记录模型实际返回（截断），否则线上只剩"未找到 JSON"无从排查
      console.error('[completeJson] 输出校验失败', {
        attempt,
        finishReason: res.choices[0]?.finish_reason,
        contentLen: text.length,
        contentPreview: text.slice(0, 500),
        error: errMsg(err),
      })
      messages.push({ role: 'assistant', content: text || '（空）' })
      messages.push({
        role: 'user',
        content: `输出校验失败：${formatZodIssues(err) || errMsg(err)}。请修正后重新输出完整 JSON，只输出 JSON 不要解释；字符串值内部严禁出现未转义的英文双引号（引用词句用「」）。`,
      })
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('LLM JSON 输出校验失败')
}

// 单轮纯文本完成：用于长 markdown 生成（不经 JSON，避免长文本转义损坏）
// 空输出重试一次：provider 偶发返回空 content，不该让整节课作废
export async function completeText(opts: {
  system: string
  prompt: string
  temperature?: number
}): Promise<string> {
  const llm = getLLM()
  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: 'system', content: opts.system },
    { role: 'user', content: opts.prompt },
  ]
  for (let attempt = 1; attempt <= 2; attempt++) {
    const model = getLLMModel()
    const res = await llm.chat.completions.create({
      model,
      messages,
      temperature: opts.temperature ?? 0.5,
    })
    recordLlmUsage({
      model,
      tokensIn: res.usage?.prompt_tokens ?? 0,
      tokensOut: res.usage?.completion_tokens ?? 0,
      status: 'ok',
    })
    const text = res.choices[0]?.message?.content ?? ''
    if (text.trim()) return text
    console.warn('[completeText] 模型返回空内容', { attempt, finishReason: res.choices[0]?.finish_reason })
  }
  throw new Error('LLM 未返回内容')
}
