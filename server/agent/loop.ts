import type OpenAI from 'openai'
import { getLLM, getLLMModel } from '../llm/client'

export interface AgentTool {
  name: string
  description: string
  parameters: Record<string, unknown> // JSON Schema
  execute: (args: Record<string, unknown>) => Promise<unknown>
}

export type AgentEvent =
  | { type: 'round'; round: number }
  | { type: 'tool_call'; name: string; args: unknown }
  | { type: 'tool_result'; name: string; ok: boolean; preview: string }
  | { type: 'final'; content: string }

export interface RunAgentOptions {
  system: string
  prompt: string
  tools: AgentTool[]
  maxRounds?: number
  toolTimeoutMs?: number
  toolResultMaxChars?: number
  onEvent?: (e: AgentEvent) => void
}

const MAX_ROUNDS = 12
const TOOL_TIMEOUT_MS = 90_000
const TOOL_RESULT_MAX_CHARS = 4000

function safeParseArgs(raw: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw || '{}')
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} 超时（${ms}ms）`)), ms)
    p.then(
      (v) => {
        clearTimeout(timer)
        resolve(v)
      },
      (e) => {
        clearTimeout(timer)
        reject(e)
      },
    )
  })
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}\n…[内容已截断]` : text
}

// 手写工具循环：LLM 反复选择工具，直到不再调用工具（输出最终文本）或轮次耗尽
export async function runAgent(opts: RunAgentOptions): Promise<string> {
  const llm = getLLM()
  const maxRounds = opts.maxRounds ?? MAX_ROUNDS
  const toolTimeoutMs = opts.toolTimeoutMs ?? TOOL_TIMEOUT_MS
  const resultMaxChars = opts.toolResultMaxChars ?? TOOL_RESULT_MAX_CHARS

  const tools: OpenAI.Chat.Completions.ChatCompletionTool[] = opts.tools.map((t) => ({
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }))
  const byName = new Map(opts.tools.map((t) => [t.name, t]))
  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: 'system', content: opts.system },
    { role: 'user', content: opts.prompt },
  ]

  for (let round = 1; round <= maxRounds; round++) {
    opts.onEvent?.({ type: 'round', round })
    const res = await llm.chat.completions.create({
      model: getLLMModel(),
      messages,
      tools: tools.length > 0 ? tools : undefined,
      temperature: 0.3,
    })
    const msg = res.choices[0]?.message
    if (!msg) throw new Error('LLM 未返回内容')
    messages.push(msg)

    const calls = (msg.tool_calls ?? []).filter(
      (c): c is OpenAI.Chat.Completions.ChatCompletionMessageFunctionToolCall => c.type === 'function',
    )
    if (calls.length === 0) {
      const content = msg.content ?? ''
      opts.onEvent?.({ type: 'final', content })
      return content
    }

    for (const call of calls) {
      const tool = byName.get(call.function.name)
      const args = safeParseArgs(call.function.arguments)
      let ok = true
      let resultText: string
      if (!tool) {
        ok = false
        resultText = `未知工具：${call.function.name}`
      } else {
        opts.onEvent?.({ type: 'tool_call', name: tool.name, args })
        try {
          const result = await withTimeout(tool.execute(args), toolTimeoutMs, tool.name)
          resultText = truncate(typeof result === 'string' ? result : JSON.stringify(result, null, 2), resultMaxChars)
        } catch (err) {
          ok = false
          resultText = `工具执行失败：${err instanceof Error ? err.message : String(err)}`
        }
      }
      opts.onEvent?.({ type: 'tool_result', name: call.function.name, ok, preview: resultText.slice(0, 200) })
      messages.push({ role: 'tool', tool_call_id: call.id, content: resultText })
    }
  }

  // 轮次耗尽：不带工具强制收尾
  const res = await llm.chat.completions.create({ model: getLLMModel(), messages })
  const content = res.choices[0]?.message?.content ?? ''
  opts.onEvent?.({ type: 'final', content })
  return content
}
