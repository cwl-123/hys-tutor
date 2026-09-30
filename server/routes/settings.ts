import type { IncomingMessage, ServerResponse } from 'node:http'
import { z } from 'zod'
import { sendJson } from '../index'
import { getSettings, maskKey, updateSettings } from '../services/settings-service'
import { readBody } from './topics'

function view(s: { baseUrl?: string; model?: string; apiKey?: string }) {
  return {
    baseUrl: s.baseUrl ?? '',
    model: s.model ?? '',
    apiKeyMasked: maskKey(s.apiKey || process.env.LLM_API_KEY),
    apiKeySource: s.apiKey ? '页面设置' : process.env.LLM_API_KEY ? '.env' : '未配置',
  }
}

// GET /api/settings — 当前 LLM 配置（key 脱敏）
export async function handleGetSettings(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  sendJson(res, 200, view(getSettings()))
}

const updateSettingsSchema = z.object({
  baseUrl: z.string().max(500).optional(),
  model: z.string().max(200).optional(),
  apiKey: z.string().max(500).optional(),
})

// PATCH /api/settings — 更新 LLM 配置（apiKey 留空 = 保持不变）
export async function handleUpdateSettings(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = updateSettingsSchema.safeParse(await readBody(req))
  if (!body.success) {
    sendJson(res, 400, { error: body.error.issues.map((i) => i.message).join('；') })
    return
  }
  const updated = await updateSettings(body.data)
  sendJson(res, 200, view(updated))
}
