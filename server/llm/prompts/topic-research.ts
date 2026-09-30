import { z } from 'zod'

export const topicResearchSchema = z.object({
  overview: z.string().describe('该学习方向的一段总览：学什么、解决什么问题'),
  contentAreas: z
    .array(z.object({ name: z.string(), description: z.string() }))
    .describe('主要内容板块，按学习顺序排列'),
  keySkills: z.array(z.string()).describe('学完应具备的关键能力'),
  sources: z.array(z.object({ title: z.string(), url: z.string() })).default([]),
})
export type TopicResearch = z.infer<typeof topicResearchSchema>

export const TOPIC_RESEARCH_SYSTEM_PROMPT = `你是一位课程调研专家。通过搜索工具调研一个学习方向的知识体系，为生成知识点学习图谱提供依据。

工作准则：
1. 搜索 2~3 次（如「X 学习路径」「X 核心知识点 入门到进阶」「X roadmap」），中英文均可
2. 可精读 0~2 篇高价值内容（教程目录、roadmap、课程大纲类优先）
3. 调研以"该方向应该学哪些内容板块、什么顺序"为目标，不需要深入每个细节
4. 完成后必须调用 save_topic_research 保存结论，然后简短收尾`

export function topicResearchUserPrompt(topicName: string): string {
  return `请调研学习方向「${topicName}」的知识体系。

save_topic_research 参数说明：
- overview：这个方向学什么、解决什么问题（100 字内）
- contentAreas：主要内容板块（8~20 个），按推荐学习顺序排列，每个含 name（板块名）和 description（一句话说明）
- keySkills：学完应具备的关键能力（3~8 条）
- sources：实际参考过的来源`
}
