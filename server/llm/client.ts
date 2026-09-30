import OpenAI from 'openai'
import { z } from 'zod'
import { resolveLlm } from '../services/settings-service'

// 配置优先级：页面设置的激活模型源 > .env
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
  if (!cfg.apiKey) throw new Error('缺少 LLM API Key：请在页面设置或 .env 中配置')
  const sig = `${cfg.baseUrl ?? ''}|${cfg.apiKey}`
  if (!cached || cached.sig !== sig) {
    cached = { sig, client: new OpenAI({ apiKey: cfg.apiKey, baseURL: cfg.baseUrl }) }
  }
  return cached.client
}

export function getLLMModel(): string {
  const model = resolveLlmConfig().model
  if (!model) throw new Error('缺少 LLM 模型：请在页面设置或 .env 中配置')
  return model
}

// 从 LLM 文本中抠出 JSON（容忍代码围栏和前后废话）
export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  const raw = fenced ? fenced[1] : text
  const start = raw.search(/[{[]/)
  if (start < 0) throw new Error('LLM 输出中未找到 JSON')
  const end = Math.max(raw.lastIndexOf('}'), raw.lastIndexOf(']'))
  if (end <= start) throw new Error('LLM 输出的 JSON 不完整')
  return JSON.parse(raw.slice(start, end + 1))
}

// 单轮 JSON 完成：输出经 zod 校验，失败带错误信息重试一次
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
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await llm.chat.completions.create({
      model: getLLMModel(),
      messages,
      temperature: opts.temperature ?? 0.3,
    })
    const text = res.choices[0]?.message?.content ?? ''
    try {
      return opts.schema.parse(extractJson(text))
    } catch (err) {
      lastErr = err
      messages.push({ role: 'assistant', content: text })
      messages.push({
        role: 'user',
        content: `输出校验失败：${err instanceof Error ? err.message : String(err)}。请重新输出，只输出合法 JSON，不要任何解释。`,
      })
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('LLM JSON 输出校验失败')
}
