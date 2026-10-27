import type OpenAI from 'openai'
import { getLLM, getLLMModel, thinkingDisabledParams } from '../llm/client'
import { errMsg } from '../../shared/error'
import { recordLlmUsage } from '../services/quota-service'

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
  /** 单轮内工具并发数上限（默认 3）：同轮多个抓取不再串行等 */
  toolConcurrency?: number
  toolTimeoutMs?: number
  toolResultMaxChars?: number
  /** 非收尾工具的总调用次数上限；达到后只允许 requireTool，逼模型收尾 */
  maxToolCalls?: number
  /** 单个工具的调用次数上限（requireTool 不受限） */
  toolBudgets?: Record<string, number>
  /** 循环结束时若该工具仍未被调用，强制再要一轮并指定该 function（用于「必须落成结果」的收尾工具） */
  requireTool?: string
  onEvent?: (e: AgentEvent) => void
}

const MAX_ROUNDS = 12
const TOOL_CONCURRENCY = 3
const TOOL_TIMEOUT_MS = 60_000
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

// 手写工具循环：LLM 反复选择工具，直到不再调用工具（输出最终文本）或轮次/预算耗尽。
// 预算耗尽时工具直接返回「请收尾」，再由 requireTool 强制落成笔记——不让研究无限膨胀。
export async function runAgent(opts: RunAgentOptions): Promise<string> {
  const llm = getLLM()
  const maxRounds = opts.maxRounds ?? MAX_ROUNDS
  const concurrency = Math.max(1, opts.toolConcurrency ?? TOOL_CONCURRENCY)
  const toolTimeoutMs = opts.toolTimeoutMs ?? TOOL_TIMEOUT_MS
  const resultMaxChars = opts.toolResultMaxChars ?? TOOL_RESULT_MAX_CHARS
  const maxToolCalls = opts.maxToolCalls ?? Number.POSITIVE_INFINITY
  const requireTool = opts.requireTool

  const tools: OpenAI.Chat.Completions.ChatCompletionTool[] = opts.tools.map((t) => ({
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }))
  const byName = new Map(opts.tools.map((t) => [t.name, t]))
  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: 'system', content: opts.system },
    { role: 'user', content: opts.prompt },
  ]
  const calledTools = new Set<string>()
  const perTool = new Map<string, number>()
  let totalToolCalls = 0
  let finalContent = ''
  let budgetExhausted = false

  const budgetBlocked = (name: string): string | null => {
    if (requireTool && name === requireTool) return null
    const limit = opts.toolBudgets?.[name]
    const used = perTool.get(name) ?? 0
    if (limit !== undefined && used >= limit) {
      return `工具「${name}」本次预算已用完（上限 ${limit} 次）。请立即使用已有信息${
        requireTool ? `调用 ${requireTool}` : '收尾'
      }，不要再调用其他工具。`
    }
    if (totalToolCalls >= maxToolCalls) {
      return `工具总预算已用完（上限 ${maxToolCalls} 次）。请立即${
        requireTool ? `调用 ${requireTool}` : '基于已有信息收尾'
      }，不要再调用其他工具。`
    }
    return null
  }

  // 单次工具调用：只返回结果，消息由主循环按原始顺序追加（并发时顺序不能乱）
  const runToolCall = async (
    call: OpenAI.Chat.Completions.ChatCompletionMessageFunctionToolCall,
  ): Promise<{ ok: boolean; resultText: string }> => {
    const tool = byName.get(call.function.name)
    const args = safeParseArgs(call.function.arguments)
    let ok = true
    let resultText: string
    if (!tool) {
      ok = false
      resultText = `未知工具：${call.function.name}`
    } else {
      calledTools.add(tool.name)
      opts.onEvent?.({ type: 'tool_call', name: tool.name, args })
      const blocked = budgetBlocked(tool.name)
      if (blocked) {
        // 预算拦截不是工具故障：给模型一条明确的收尾指令，不往前端报 error
        budgetExhausted = true
        resultText = blocked
      } else {
        if (!requireTool || tool.name !== requireTool) {
          totalToolCalls++
          perTool.set(tool.name, (perTool.get(tool.name) ?? 0) + 1)
        }
        try {
          const result = await withTimeout(tool.execute(args), toolTimeoutMs, tool.name)
          resultText = truncate(
            typeof result === 'string' ? result : JSON.stringify(result, null, 2),
            resultMaxChars,
          )
        } catch (err) {
          ok = false
          resultText = `工具执行失败：${errMsg(err)}`
        }
      }
    }
    opts.onEvent?.({ type: 'tool_result', name: call.function.name, ok, preview: resultText.slice(0, 200) })
    return { ok, resultText }
  }

  for (let round = 1; round <= maxRounds; round++) {
    opts.onEvent?.({ type: 'round', round })
    const model = getLLMModel()
    const res = await llm.chat.completions.create({
      model,
      messages,
      tools: tools.length > 0 ? tools : undefined,
      temperature: 0.3,
      ...thinkingDisabledParams(),
    })
    recordLlmUsage({
      model,
      tokensIn: res.usage?.prompt_tokens ?? 0,
      tokensOut: res.usage?.completion_tokens ?? 0,
      status: 'ok',
    })
    const msg = res.choices[0]?.message
    if (!msg) throw new Error('LLM 未返回内容')
    messages.push(msg)

    const calls = (msg.tool_calls ?? []).filter(
      (c): c is OpenAI.Chat.Completions.ChatCompletionMessageFunctionToolCall => c.type === 'function',
    )
    if (calls.length === 0) {
      finalContent = msg.content ?? ''
      break
    }

    // 同一轮的多个工具并发执行（最多 concurrency 个），结果按调用顺序回填
    for (let i = 0; i < calls.length; i += concurrency) {
      const batch = calls.slice(i, i + concurrency)
      const results = await Promise.all(batch.map((call) => runToolCall(call)))
      batch.forEach((call, idx) => {
        messages.push({ role: 'tool', tool_call_id: call.id, content: results[idx].resultText })
      })
    }

    // 预算已耗尽且没拿到收尾结果：不再给模型空转的机会，直接进入强制收尾
    if (budgetExhausted && requireTool && !calledTools.has(requireTool)) break
    if (totalToolCalls >= maxToolCalls && requireTool && !calledTools.has(requireTool)) break
  }

  // 必需工具漏调（flash 常见：研究做完却忘了 save_research_note，导致整节课报废）：
  // 强制指定 function 再要一轮，已有对话上下文都在，模型只需把内容落成笔记
  if (requireTool && !calledTools.has(requireTool) && byName.has(requireTool)) {
    const model = getLLMModel()
    // 注意：provider 的思考模式不支持 tool_choice（会 400），所以这里用一条强指令催收尾，
    // 而不是强制指定 function。预算耗尽时这句是唯一出口，flash 基本都会照做。
    const res = await llm.chat.completions.create({
      model,
      messages: [
        ...messages,
        {
          role: 'user',
          content: `现在请立即调用 ${requireTool}，把已经读到的内容落成结果。参数必须完整填写（绝不能传空对象），用已抓取的正文和候选摘要补全所有必填字段；不要再调用其他工具，也不要输出解释。`,
        },
      ],
      tools,
      ...thinkingDisabledParams(),
    })
    recordLlmUsage({
      model,
      tokensIn: res.usage?.prompt_tokens ?? 0,
      tokensOut: res.usage?.completion_tokens ?? 0,
      status: 'ok',
    })
    const msg = res.choices[0]?.message
    if (msg) {
      messages.push(msg)
      const calls = (msg.tool_calls ?? []).filter(
        (c): c is OpenAI.Chat.Completions.ChatCompletionMessageFunctionToolCall => c.type === 'function',
      )
      for (const call of calls) {
        const r = await runToolCall(call)
        messages.push({ role: 'tool', tool_call_id: call.id, content: r.resultText })
      }
      finalContent = finalContent || msg.content || ''
    }
  }

  if (finalContent) {
    opts.onEvent?.({ type: 'final', content: finalContent })
    return finalContent
  }

  // 轮次耗尽：不带工具强制收尾
  const model = getLLMModel()
  const res = await llm.chat.completions.create({ model, messages, ...thinkingDisabledParams() })
  recordLlmUsage({
    model,
    tokensIn: res.usage?.prompt_tokens ?? 0,
    tokensOut: res.usage?.completion_tokens ?? 0,
    status: 'ok',
  })
  const content = res.choices[0]?.message?.content ?? ''
  opts.onEvent?.({ type: 'final', content })
  return content
}