import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { dataPath, writeJson } from '../repo/json-store'

// 模型源（provider）：名称 + BaseURL + Key + 模型；激活源决定所有 LLM 调用
export interface ProviderConfig {
  id: string
  name: string
  baseUrl?: string
  apiKey?: string
  model: string
}

export interface Settings {
  providers: ProviderConfig[]
  activeProviderId?: string
}

export interface ResolvedLlm {
  apiKey: string
  baseUrl?: string
  model: string
  providerName: string
  source: '页面设置' | '.env'
}

function settingsFile(): string {
  return dataPath('settings.json')
}

function loadRaw(): unknown {
  try {
    return JSON.parse(readFileSync(settingsFile(), 'utf-8'))
  } catch {
    return null
  }
}

// 兼容旧版单配置格式 {baseUrl,apiKey,model} → 单 provider
function migrate(raw: unknown): Settings {
  const r = raw as Record<string, unknown> | null
  if (r && Array.isArray(r.providers)) {
    return {
      providers: (r.providers as ProviderConfig[]).map((p) => ({ ...p })),
      activeProviderId: typeof r.activeProviderId === 'string' ? r.activeProviderId : undefined,
    }
  }
  if (r && (r.model || r.baseUrl || r.apiKey)) {
    return {
      providers: [
        {
          id: 'p_default',
          name: '默认',
          baseUrl: typeof r.baseUrl === 'string' ? r.baseUrl : undefined,
          apiKey: typeof r.apiKey === 'string' ? r.apiKey : undefined,
          model: typeof r.model === 'string' ? r.model : '',
        },
      ],
      activeProviderId: 'p_default',
    }
  }
  return { providers: [], activeProviderId: undefined }
}

const cache: Settings = migrate(loadRaw())

export function getSettings(): Settings {
  return { providers: cache.providers.map((p) => ({ ...p })), activeProviderId: cache.activeProviderId }
}

function isValid(p: ProviderConfig | undefined): p is ProviderConfig {
  return !!p && !!p.model && !!p.apiKey
}

// 生效配置：激活的页面 provider > .env
export function resolveLlm(): ResolvedLlm {
  const active =
    cache.providers.find((p) => p.id === cache.activeProviderId) ?? undefined
  if (isValid(active)) {
    return {
      apiKey: active.apiKey!,
      baseUrl: active.baseUrl || undefined,
      model: active.model,
      providerName: active.name,
      source: '页面设置',
    }
  }
  return {
    apiKey: process.env.LLM_API_KEY ?? '',
    baseUrl: process.env.LLM_BASE_URL || undefined,
    model: process.env.LLM_MODEL ?? '',
    providerName: '.env 默认',
    source: '.env',
  }
}

export interface ProviderInput {
  id?: string
  name: string
  baseUrl?: string
  model: string
  apiKey?: string // 留空 = 保持原 key
}

export async function updateSettings(patch: {
  providers?: ProviderInput[]
  activeProviderId?: string | null
}): Promise<Settings> {
  if (patch.providers) {
    const oldById = new Map(cache.providers.map((p) => [p.id, p]))
    cache.providers = patch.providers.map((inp) => {
      const existing = inp.id ? oldById.get(inp.id) : undefined
      return {
        id: existing?.id ?? `p_${randomUUID().slice(0, 8)}`,
        name: inp.name.trim() || '未命名',
        baseUrl: inp.baseUrl?.trim() || undefined,
        model: inp.model.trim(),
        apiKey: inp.apiKey?.trim() ? inp.apiKey.trim() : existing?.apiKey,
      }
    })
  }
  if (patch.activeProviderId !== undefined) {
    const wanted = patch.activeProviderId || undefined
    cache.activeProviderId =
      wanted && cache.providers.some((p) => p.id === wanted) ? wanted : undefined
  }
  await writeJson(settingsFile(), cache)
  return getSettings()
}

export function maskKey(key?: string): string {
  if (!key) return ''
  if (key.length <= 10) return '****'
  return `${key.slice(0, 6)}…${key.slice(-4)}`
}
