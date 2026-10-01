import type { IncomingMessage, ServerResponse } from 'node:http'
import { z } from 'zod'
import { sendJson } from '../index'
import {
  getSettings,
  maskKey,
  resolveLlm,
  updateSettings,
} from '../services/settings-service'
import { findCandidate, listImportCandidates } from '../services/import-service'
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
    search: {
      tavily: {
        apiKeyMasked: maskKey(s.search?.tavilyKey),
        hasKey: !!s.search?.tavilyKey,
        envHasKey: !!process.env.TAVILY_API_KEY,
      },
      bocha: {
        apiKeyMasked: maskKey(s.search?.bochaKey),
        hasKey: !!s.search?.bochaKey,
        envHasKey: !!process.env.BOCHA_API_KEY,
      },
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
  search: z
    .object({
      tavilyKey: z.string().max(500).optional(),
      bochaKey: z.string().max(500).optional(),
    })
    .optional(),
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

// GET /api/settings/import-candidates — 扫描本机 AI 工具配置（key 脱敏，仅预览）
export async function handleListImportCandidates(
  _req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  sendJson(res, 200, { candidates: listImportCandidates() })
}

const importSchema = z.object({ id: z.string().min(1).max(200) })

// POST /api/settings/import — 用户确认后导入：服务端重新读配置文件取真实 key，不经过前端
export async function handleImportCandidate(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = importSchema.safeParse(await readBody(req))
  if (!body.success) {
    sendJson(res, 400, { error: '缺少要导入的配置 id' })
    return
  }
  const c = findCandidate(body.data.id)
  if (!c) {
    sendJson(res, 404, { error: '未找到该配置，可能已被修改或删除' })
    return
  }
  if (!c.model) {
    sendJson(res, 400, { error: '该配置未指定模型，请用「添加模型源」手动填写' })
    return
  }
  const s = getSettings()
  const dup = s.providers.some((p) => (p.baseUrl ?? '') === (c.baseUrl ?? '') && p.model === c.model)
  if (!dup) {
    await updateSettings({
      providers: [
        ...s.providers.map((p) => ({
          id: p.id,
          name: p.name,
          baseUrl: p.baseUrl,
          model: p.model,
        })),
        { name: c.name, baseUrl: c.baseUrl, model: c.model, apiKey: c.apiKey },
      ],
    })
  }
  sendJson(res, 200, view())
}
