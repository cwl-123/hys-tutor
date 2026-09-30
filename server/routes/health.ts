import type { IncomingMessage, ServerResponse } from 'node:http'
import { sendJson } from '../index'

export function healthRoute(_req: IncomingMessage, res: ServerResponse): void {
  sendJson(res, 200, { ok: true, ts: new Date().toISOString() })
}
