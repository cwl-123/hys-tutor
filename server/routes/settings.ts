import type { IncomingMessage, ServerResponse } from 'node:http'
import { z } from 'zod'
import { sendJson } from '../index'
import {
  getSettings,
  maskKey,
  resolveLlm,
  updateSettings,
} from '../services/settings-service'
import { readBody } from './topics'

// 当前生效配置 + 模型源列表（key 脱敏）
function view() {
  const s = getSettings()
  const eff = resolveLlm()
  return {
    providers: s.providers.map((p) => ({
      id: p.id,
      name: p.name,
      baseUrl: p.baseUrl ?? '',
      model: p.model,
      apiKeyMasked: maskKey(p.apiKey),
      hasKey: !!p.apiKey,
    })),
    activeProviderId: s.activeProviderId ?? '',
    effective: {
      model: eff.model,
      baseUrl: eff.baseUrl ?? '',
      providerName: eff.providerName,
      source: eff.source,
    },
    envFallback: {
      model: process.env.LLM_MODEL ?? '',
      hasKey: !!process.env.LLM_API_KEY,
    },
  }
}

// GET /api/settings
export async function handleGetSettings(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  sendJson(res, 200, view())
}

const updateSettingsSchema = z.object({
  providers: z
    .array(
      z.object({
        id: z.string().optional(),
        name: z.string().min(1).max(50),
        baseUrl: z.string().max(500).optional(),
        model: z.string().min(1).max(200),
        apiKey: z.string().max(500).optional(),
      }),
    )
    .optional(),
  activeProviderId: z.string().nullable().optional(),
})

// PATCH /api/settings — 整体保存模型源列表 + 激活源（apiKey 留空 = 保持原 key）
export async function handleUpdateSettings(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = updateSettingsSchema.safeParse(await readBody(req))
  if (!body.success) {
    sendJson(res, 400, { error: body.error.issues.map((i) => i.message).join('；') })
    return
  }
  await updateSettings(body.data)
  sendJson(res, 200, view())
}
