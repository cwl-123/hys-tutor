import { readFileSync } from 'node:fs'
import { dataPath, writeJson } from '../repo/json-store'

// LLM 配置：页面可改，落盘 data/settings.json（本地、git 忽略）；缺省回退 .env
export interface LlmSettings {
  baseUrl?: string
  apiKey?: string
  model?: string
}

function load(): LlmSettings {
  try {
    return JSON.parse(readFileSync(dataPath('settings.json'), 'utf-8')) as LlmSettings
  } catch {
    return {}
  }
}

let cache: LlmSettings = load()

export function getSettings(): LlmSettings {
  return { ...cache }
}

export async function updateSettings(patch: Partial<LlmSettings>): Promise<LlmSettings> {
  const next: LlmSettings = { ...cache }
  if (patch.baseUrl !== undefined) next.baseUrl = patch.baseUrl.trim() || undefined
  if (patch.model !== undefined) next.model = patch.model.trim() || undefined
  if (patch.apiKey !== undefined && patch.apiKey.trim()) next.apiKey = patch.apiKey.trim()
  cache = next
  await writeJson(dataPath('settings.json'), next)
  return getSettings()
}

export function maskKey(key?: string): string {
  if (!key) return ''
  if (key.length <= 10) return '****'
  return `${key.slice(0, 6)}…${key.slice(-4)}`
}
