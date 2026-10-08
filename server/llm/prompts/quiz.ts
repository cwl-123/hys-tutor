import { z } from 'zod'
import type { KnowledgeNode, ResearchNote } from '../../../shared/types'
import { llmQuestionDraftSchema } from './selfcheck'

export const llmQuizSchema = z.object({
  questions: z.array(llmQuestionDraftSchema).length(3),
})

export const QUIZ_SYSTEM_PROMPT = `你是一位出题老师。你只输出合法 JSON，不输出任何解释。字符串值内部如需引用词句，一律用中文引号「」，严禁出现未转义的英文双引号。`

// 再次测验：围绕同一知识点出一套新题，避开历史出过的题
export function quizPrompt(
  node: KnowledgeNode,
  note: ResearchNote | null,
  contentMd: string,
  avoidPrompts: string[],
): string {
  const avoid =
    avoidPrompts.length > 0
      ? `\n以下题目已经出过，新题不得与其重复或仅做数值替换：\n${avoidPrompts.map((p, i) => `${i + 1}. ${p.replace(/\s+/g, ' ').slice(0, 120)}`).join('\n')}\n`
      : ''
  return `围绕知识点「${node.name}」出 3 道全新的随堂练习题。

知识点描述：${node.description}

${note ? `研究笔记（事实依据）：\n${JSON.stringify({ concepts: note.concepts, derivations: note.derivations, examples: note.examples, pitfalls: note.pitfalls }, null, 2)}\n` : ''}
课程正文（节选）：
<<<CONTENT
${contentMd.slice(0, 6000)}
CONTENT>>>
${avoid}
要求：
1. 至少 1 道客观题（single 四选一 / judge 判断），其余可 short 简答
   - single：options 4 个选项，answer 为正确选项字母，explanation 讲解为什么
   - judge：answer 为 "对" 或 "错"
   - short：referenceAnswer 给参考答案要点，explanation 给评分要点
2. 题目难度匹配 15 分钟微课，题干自包含（不依赖课程正文才能读懂）
3. 换个角度考察：可以换场景、换正反方向、换易混点，但不得超出该知识点范围

输出 JSON：{"questions": [{"type": "single", "prompt": "...", "options": ["A...","B...","C...","D..."], "answer": "B", "explanation": "..."}]}`
}
