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

export const llmSelfCheckSchema = z.object({
  issues: z.array(z.string()).default([]).describe('发现的与笔记不符/无来源支撑的问题'),
  correctedContent: z.string().optional().describe('若发现问题，返回修正后的完整课程 markdown；否则省略'),
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
1. 对照研究笔记逐段检查：找出与笔记矛盾、或笔记完全无法支撑的关键断言，列入 issues；若有实质问题，返回修正后的完整课程 markdown（correctedContent，保持篇幅和结构，只修有问题的部分），无实质问题则省略 correctedContent
2. 出 5 道题考察本课核心内容，题型配比固定：2 道 single 四选一 + 2 道 judge 判断 + 1 道 short 简答
   - single：options 4 个选项（纯选项文本，不要带 "A." 等字母前缀），answer 为正确选项字母，explanation 讲解为什么
   - judge：answer 为 "对" 或 "错"
   - short：referenceAnswer 给参考答案要点，explanation 给评分要点
3. 题目难度匹配 15 分钟微课，题干自包含（不依赖课程正文才能读懂）；5 道题考察角度错开，不互相重复

输出 JSON：{"issues": [...], "correctedContent": "...(可选)", "questions": [{"type": "single", "prompt": "...", "options": ["A...","B...","C...","D..."], "answer": "B", "explanation": "..."}, ...共 5 题]}`
}
