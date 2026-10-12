import type { IncomingMessage, ServerResponse } from 'node:http'
import { z } from 'zod'
import { errMsg } from '../../shared/error'
import { sendJson } from '../index'
import { readBody } from './topics'
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
    const result = await chatOnboarding(body.data.messages)
    sendJson(res, 200, result)
  } catch (err) {
    sendJson(res, 500, { error: errMsg(err) })
  }
}
