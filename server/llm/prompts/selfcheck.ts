import { z } from 'zod'
import type { KnowledgeNode, ResearchNote } from '../../../shared/types'

export const llmQuestionDraftSchema = z.object({
  type: z.enum(['single', 'judge', 'short']),
  prompt: z.string(),
  options: z.array(z.string()).optional(),
  answer: z.string().optional().describe('客观题正确选项，如 "B" 或 "对"/"错"'),
  referenceAnswer: z.string().optional().describe('简答题参考答案'),
  explanation: z.string().describe('判分后展示的讲解'),
})

// 模型常把每条 issue 输出成 {location, problem, ...} 对象而非纯字符串：
// 统一压成一句话，避免整轮 JSON 因 schema 不匹配而报废（issues 仅用于进度展示）。
function issueToString(it: unknown): string {
  if (typeof it === 'string') return it.trim()
  if (it && typeof it === 'object') {
    const o = it as Record<string, unknown>
    const loc = o.location ?? o.section ?? o.position
    const body =
      o.problem ??
      o.detail ??
      o.note ??
      o.issue ??
      o.description ??
      o.message ??
      o.suggestion ??
      o.fix
    const parts = [loc, body].filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
    if (parts.length) return parts.join('：').trim()
    try {
      return JSON.stringify(it)
    } catch {
      return String(it)
    }
  }
  return String(it ?? '').trim()
}

export const llmSelfCheckSchema = z.object({
  issues: z
    .array(z.unknown())
    .default([])
    .transform((arr) => arr.map(issueToString).filter((s) => s.length > 0)),
  needsCorrection: z
    .boolean()
    .default(false)
    .describe('是否存在需修正正文的实质问题（与笔记矛盾/无来源支撑的关键断言）'),
  questions: z.array(llmQuestionDraftSchema).length(5),
})
export type LlmSelfCheck = z.infer<typeof llmSelfCheckSchema>

export const SELFCHECK_SYSTEM_PROMPT = `你是一位严格的内容质检员和出题老师。你只输出合法 JSON，不输出任何解释。字符串值内部如需引用词句，一律用中文引号「」，严禁出现未转义的英文双引号。`

export function selfCheckPrompt(
  node: KnowledgeNode,
  note: ResearchNote,
  contentMd: string,
): string {
  return `质检以下课程并出 5 道课末题。

目标知识点：${node.name}

研究笔记（事实依据）：
${JSON.stringify(note, null, 2)}

课程正文：
<<<CONTENT
${contentMd}
CONTENT>>>

任务：
1. 对照研究笔记逐段检查：找出与笔记矛盾、或笔记完全无法支撑的关键断言，每条写成一句话写入 issues（格式「位置：问题」），无问题则为空数组。issues 只放字符串，不要放对象
2. 判断是否存在需要改写正文的实质问题，用 needsCorrection 布尔值表示（仅「提示类、不影响事实正确性」的问题不算实质问题）
3. 出 5 道题考察本课核心内容，题型配比固定：2 道 single 四选一 + 2 道 judge 判断 + 1 道 short 简答
   - single：options 4 个选项（纯选项文本，不要带 "A." 等字母前缀），answer 为正确选项字母，explanation 讲解为什么
   - judge：answer 为 "对" 或 "错"
   - short：referenceAnswer 给参考答案要点，explanation 给评分要点
4. 题目难度匹配 15 分钟微课，题干自包含（不依赖课程正文才能读懂）；5 道题考察角度错开，不互相重复

输出 JSON（不要输出 correctedContent，修正正文由后续步骤单独处理）：{"issues": ["位置：问题"], "needsCorrection": false, "questions": [{"type": "single", "prompt": "...", "options": ["A...","B...","C...","D..."], "answer": "B", "explanation": "..."}, ...共 5 题]}`
}

// 修正正文：长 markdown 走纯文本通道，避免塞进 JSON 导致转义损坏（Design 约定）
export const CORRECT_CONTENT_SYSTEM_PROMPT = `你是一位严谨的课程编辑。只输出修正后的完整课程 markdown 正文，不输出任何解释、前言、结语或代码围栏。`

export function correctContentPrompt(
  node: KnowledgeNode,
  contentMd: string,
  issues: string[],
): string {
  return `根据质检意见修正以下课程正文。

目标知识点：${node.name}

质检意见：
${issues.map((s, i) => `${i + 1}. ${s}`).join('\n')}

要求：只修改质检意见指出的部分，保持原有篇幅、结构、章节标题与来源引用 [n] 标注不变，输出修正后的完整 markdown。

课程正文：
<<<CONTENT
${contentMd}
CONTENT>>>`
}