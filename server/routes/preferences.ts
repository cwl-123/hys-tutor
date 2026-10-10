import type { IncomingMessage, ServerResponse } from 'node:http'
import { z } from 'zod'
import { sendJson } from '../index'
import {
  addPreference,
  listPreferences,
  removePreference,
  updatePreference,
} from '../services/preference-service'
import { readBody } from './topics'

const textBodySchema = z.object({ text: z.string().min(1).max(200) })

// GET /api/preferences — 偏好清单
export async function handleListPreferences(
  _req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  sendJson(res, 200, { preferences: await listPreferences() })
}

// POST /api/preferences — 手写新增
export async function handleCreatePreference(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const body = textBodySchema.safeParse(await readBody(req))
  if (!body.success) {
    sendJson(res, 400, { error: '偏好内容必填且不超过 200 字' })
    return
  }
  const preference = await addPreference(body.data.text, { kind: 'manual' })
  sendJson(res, 200, { preference })
}

// PATCH /api/preferences/:id — 编辑
export async function handleUpdatePreference(
  req: IncomingMessage,
  res: ServerResponse,
  id: string,
): Promise<void> {
  const body = textBodySchema.safeParse(await readBody(req))
  if (!body.success) {
    sendJson(res, 400, { error: '偏好内容必填且不超过 200 字' })
    return
  }
  const preference = await updatePreference(id, body.data.text)
  if (!preference) {
    sendJson(res, 404, { error: '偏好不存在' })
    return
  }
  sendJson(res, 200, { preference })
}

// DELETE /api/preferences/:id — 删除
export async function handleDeletePreference(
  _req: IncomingMessage,
  res: ServerResponse,
  id: string,
): Promise<void> {
  const ok = await removePreference(id)
  sendJson(res, ok ? 200 : 404, ok ? { ok: true } : { error: '偏好不存在' })
}
