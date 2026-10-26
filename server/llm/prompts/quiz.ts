import { z } from 'zod'
import type { KnowledgeNode, ResearchNote } from '../../../shared/types'
import { llmQuestionDraftSchema } from './selfcheck'
import { QUESTION_FIELD_CHECKLIST, QUESTION_OUTPUT_SAMPLE } from './question-format'

export const llmQuizSchema = z.object({
  questions: z.array(llmQuestionDraftSchema).length(5),
})

export const QUIZ_SYSTEM_PROMPT = `你是一位出题老师。你只输出合法 JSON，不输出任何解释。字符串值内部如需引用词句，一律用中文引号「」，严禁出现未转义的英文双引号。`

// 再次测验：围绕同一知识点出一套新题，避开历史出过的题
// previousIssues：上一轮被结构校验剔除的原因，逐条回灌（与自查出题同一条链路，否则模型会原地重犯）
export function quizPrompt(
  node: KnowledgeNode,
  note: ResearchNote | null,
  contentMd: string,
  avoidPrompts: string[],
  previousIssues: string[] = [],
): string {
  const avoid =
    avoidPrompts.length > 0
      ? `\n以下题目已经出过，新题不得与其重复或仅做数值替换：\n${avoidPrompts.map((p, i) => `${i + 1}. ${p.replace(/\s+/g, ' ').slice(0, 120)}`).join('\n')}\n`
      : ''
  const retryBlock = previousIssues.length
    ? `\n⚠️ 上一轮出题有以下结构问题（本次必须修正，否则出题失败）：\n${previousIssues.map((r) => `- ${r}`).join('\n')}\n`
    : ''
  return `围绕知识点「${node.name}」出 5 道全新的随堂练习题。
${retryBlock}
知识点描述：${node.description}

${note ? `研究笔记（事实依据）：\n${JSON.stringify({ concepts: note.concepts, derivations: note.derivations, examples: note.examples, pitfalls: note.pitfalls }, null, 2)}\n` : ''}
课程正文（节选）：
<<<CONTENT
${contentMd.slice(0, 6000)}
CONTENT>>>
${avoid}
要求：
1. 题型配比固定：2 道 single 四选一 + 2 道 judge 判断 + 1 道 short 简答
   - single：options 是 4 个选项的纯文本（不要带 "A." 等字母前缀，字母由前端自动加），answer 为正确选项字母
   - judge：answer 只能是「对」或「错」
   - short：referenceAnswer 给参考答案要点，explanation 给评分要点
2. 题目难度匹配 15 分钟微课，题干自包含（不依赖课程正文才能读懂）
3. 换个角度考察：可以换场景、换正反方向、换易混点，但不得超出该知识点范围；5 道题之间考察角度错开，不互相重复

输出 JSON（顶层就是一个对象，输出完就结束，不要再续写任何字符）：
{"questions": ${QUESTION_OUTPUT_SAMPLE}}

${QUESTION_FIELD_CHECKLIST}`
}