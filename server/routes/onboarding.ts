import type { IncomingMessage, ServerResponse } from 'node:http'
import { z } from 'zod'
import { errMsg } from '../../shared/error'
import { sendJson } from '../http'
import { readBody } from '../http'
import { currentUserId } from '../repo/context'
import { consumeQuota } from '../services/quota-service'
import { statusOf } from '../auth/errors'
import { chatOnboarding } from '../services/onboarding-service'

const onboardingChatBodySchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string().min(1).max(2000),
      }),
    )
    .min(1)
    .max(30),
})

// POST /api/onboarding/chat — 开课对话（AI 引导理清学习方向，产出方向提案）
export async function handleOnboardingChat(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const body = onboardingChatBodySchema.safeParse(await readBody(req))
  if (!body.success) {
    sendJson(res, 400, { error: body.error.issues.map((i) => i.message).join('；') })
    return
  }
  try {
    const userId = currentUserId()
    consumeQuota(userId, 'chat')
    const result = await chatOnboarding(body.data.messages)
    sendJson(res, 200, result)
  } catch (err) {
    const status = statusOf(err)
    sendJson(res, status, { error: status >= 500 ? '服务器内部错误' : errMsg(err) })
  }
}
