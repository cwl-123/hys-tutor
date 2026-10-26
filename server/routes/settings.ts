import type { IncomingMessage, ServerResponse } from 'node:http'
import { z } from 'zod'
import { sendJson, readBody } from '../http'
import { resolveLlm } from '../services/settings-service'
import { findCandidate, listImportCandidates } from '../services/import-service'

// 公网模式：只告诉前端「平台用什么模型」，绝不回传 key / baseUrl
function view() {
  const eff = resolveLlm()
  return {
    mode: 'platform',
    effective: {
      model: eff.model,
      providerName: eff.providerName,
    },
    search: {
      tavily: { hasKey: !!process.env.TAVILY_API_KEY },
      bocha: { hasKey: !!process.env.BOCHA_API_KEY },
    },
  }
}

export async function handleGetSettings(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  sendJson(res, 200, view())
}

// 公网模式下页面改模型配置一律 403；本地开发也默认关闭
export async function handleUpdateSettings(req: IncomingMessage, res: ServerResponse): Promise<void> {
  await readBody(req)
  sendJson(res, 403, { error: '公网版模型配置由服务端统一管理，不支持页面修改' })
}

function localSettingsAllowed(): boolean {
  return process.env.HYS_LOCAL_SETTINGS === '1'
}

// 扫描服务器本机 AI 工具配置：公网环境是明确的 key 泄漏面，默认 404
export async function handleListImportCandidates(
  _req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (!localSettingsAllowed()) {
    sendJson(res, 404, { error: 'Not found' })
    return
  }
  sendJson(res, 200, { candidates: listImportCandidates() })
}

const importSchema = z.object({ id: z.string().min(1).max(200) })

export async function handleImportCandidate(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (!localSettingsAllowed()) {
    sendJson(res, 404, { error: 'Not found' })
    return
  }
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
  sendJson(res, 403, { error: '公网版不支持从本机配置导入模型' })
}