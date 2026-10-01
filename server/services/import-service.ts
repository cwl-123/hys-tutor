import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { maskKey } from './settings-service'

// 从本机 AI 编程工具（OpenCode / Codex / Claude Code）的配置里扫描可复用的 LLM 配置
// key 不出服务端：列表只返回脱敏 key，导入时由服务端重新读文件取真实 key

export interface ImportCandidate {
  id: string // 如 'opencode:deepseek' / 'codex' / 'claude-code'
  source: string // 来源工具展示名
  name: string // 建议的模型源名称
  baseUrl?: string
  model: string // 建议模型（该源模型列表的第一个）
  models: string[] // 该源已配置的模型列表
  apiKeyMasked: string
}

interface FullCandidate extends Omit<ImportCandidate, 'apiKeyMasked'> {
  apiKey: string
}

function readJsonFile(file: string): unknown {
  try {
    return JSON.parse(readFileSync(file, 'utf-8'))
  } catch {
    return null
  }
}

// OpenCode: ~/.config/opencode/opencode.json 的 provider 段（options.apiKey/baseURL + models）
function scanOpenCode(home: string): FullCandidate[] {
  const file = path.join(home, '.config', 'opencode', 'opencode.json')
  if (!existsSync(file)) return []
  const raw = readJsonFile(file) as {
    provider?: Record<
      string,
      { name?: string; options?: { apiKey?: string; baseURL?: string }; models?: object }
    >
  } | null
  if (!raw?.provider) return []
  const out: FullCandidate[] = []
  for (const [key, p] of Object.entries(raw.provider)) {
    const apiKey = p?.options?.apiKey?.trim()
    if (!apiKey) continue
    const baseUrl = p?.options?.baseURL?.trim() || undefined
    if (baseUrl && /aihubmix/i.test(baseUrl)) continue // 按需求不导入 AiHubMix
    const models = p?.models ? Object.keys(p.models) : []
    out.push({
      id: `opencode:${key}`,
      source: 'OpenCode',
      name: p?.name?.trim() || `OpenCode · ${key}`,
      baseUrl,
      model: models[0] ?? '',
      models,
      apiKey,
    })
  }
  return out
}

// Codex: ~/.codex/config.toml（model_provider + model + 对应 base_url）+ auth.json 的 OPENAI_API_KEY
function scanCodex(home: string): FullCandidate[] {
  const authFile = path.join(home, '.codex', 'auth.json')
  const configFile = path.join(home, '.codex', 'config.toml')
  if (!existsSync(authFile)) return []
  const auth = readJsonFile(authFile) as { OPENAI_API_KEY?: string } | null
  const apiKey = auth?.OPENAI_API_KEY?.trim()
  if (!apiKey) return []
  let toml = ''
  try {
    toml = readFileSync(configFile, 'utf-8')
  } catch {
    return []
  }
  const model = toml.match(/^\s*model\s*=\s*"([^"]+)"/m)?.[1] ?? ''
  const providerKey = toml.match(/^\s*model_provider\s*=\s*"([^"]+)"/m)?.[1]
  let baseUrl: string | undefined
  if (providerKey) {
    const section = toml.match(
      new RegExp(`\\[model_providers\\.${providerKey}\\]([\\s\\S]*?)(?=\\n\\[|$)`),
    )?.[1]
    baseUrl = section?.match(/^\s*base_url\s*=\s*"([^"]+)"/m)?.[1]
  }
  if (baseUrl && /aihubmix/i.test(baseUrl)) return []
  return [
    {
      id: 'codex',
      source: 'Codex',
      name: 'Codex 配置',
      baseUrl,
      model,
      models: model ? [model] : [],
      apiKey,
    },
  ]
}

// Claude Code: ~/.claude/settings.json 的 env（仅当配置了自定义网关 BASE_URL 才可能是 OpenAI 兼容）
function scanClaudeCode(home: string): FullCandidate[] {
  const file = path.join(home, '.claude', 'settings.json')
  if (!existsSync(file)) return []
  const raw = readJsonFile(file) as {
    env?: { ANTHROPIC_AUTH_TOKEN?: string; ANTHROPIC_BASE_URL?: string; ANTHROPIC_MODEL?: string }
  } | null
  const env = raw?.env
  const apiKey = env?.ANTHROPIC_AUTH_TOKEN?.trim()
  const baseUrl = env?.ANTHROPIC_BASE_URL?.trim()
  if (!apiKey || !baseUrl) return [] // 订阅 OAuth 无可复用 key，跳过
  if (/aihubmix/i.test(baseUrl)) return []
  const model = env?.ANTHROPIC_MODEL?.trim() ?? ''
  return [
    {
      id: 'claude-code',
      source: 'Claude Code',
      name: 'Claude Code 配置',
      baseUrl,
      model,
      models: model ? [model] : [],
      apiKey,
    },
  ]
}

function scanAll(home: string): FullCandidate[] {
  return [...scanOpenCode(home), ...scanCodex(home), ...scanClaudeCode(home)]
}

export function listImportCandidates(home: string = homedir()): ImportCandidate[] {
  return scanAll(home).map(({ apiKey, ...c }) => ({ ...c, apiKeyMasked: maskKey(apiKey) }))
}

// 导入时按 id 重新扫描取真实 key；找不到（配置已被删/改）返回 null
export function findCandidate(id: string, home: string = homedir()): FullCandidate | null {
  return scanAll(home).find((c) => c.id === id) ?? null
}
