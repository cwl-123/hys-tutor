import { HttpError } from '../auth/errors'

// 公网模式：模型/搜索 key 只来自服务端环境变量，页面设置只读。
// 刻意不再读写 data/settings.json：那条路径既会把 key 落进用户数据目录，
// 又会被 GET /api/settings 回传前端，公网环境是明确的泄漏面。
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
  search?: SearchKeys
}

export interface SearchKeys {
  tavilyKey?: string
  bochaKey?: string
}

export interface ResolvedLlm {
  apiKey: string
  baseUrl?: string
  model: string
  providerName: string
  source: '页面设置' | '.env'
}

export function getSettings(): Settings {
  const model = process.env.LLM_MODEL?.trim()
  if (!model) return { providers: [] }
  return {
    providers: [
      {
        id: 'platform',
        name: '平台默认',
        baseUrl: process.env.LLM_BASE_URL?.trim() || undefined,
        model,
      },
    ],
    activeProviderId: 'platform',
  }
}

// 生效搜索 key：页面设置 > .env（保留纯函数，便于测试/未来扩展）
export function resolveSearchKeys(
  s: Settings,
  env: NodeJS.ProcessEnv = process.env,
): { tavilyKey: string; bochaKey: string } {
  return {
    tavilyKey: s.search?.tavilyKey?.trim() || env.TAVILY_API_KEY || '',
    bochaKey: s.search?.bochaKey?.trim() || env.BOCHA_API_KEY || '',
  }
}

export function resolveLlm(): ResolvedLlm {
  return {
    apiKey: process.env.LLM_API_KEY ?? '',
    baseUrl: process.env.LLM_BASE_URL || undefined,
    model: process.env.LLM_MODEL ?? '',
    providerName: process.env.LLM_PROVIDER_NAME || 'DeepSeek 官方',
    source: '.env',
  }
}

// 公网模式不再支持页面改模型源；保留函数签名让路由给出明确 403
export async function updateSettings(): Promise<Settings> {
  throw new HttpError(403, '公网版模型配置由服务端统一管理，不支持页面修改')
}

export function maskKey(key?: string): string {
  if (!key) return ''
  if (key.length <= 10) return '****'
  return `${key.slice(0, 6)}…${key.slice(-4)}`
}