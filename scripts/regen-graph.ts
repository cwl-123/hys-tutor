// 图谱恢复 CLI：重新生成指定课题的知识图谱（修复 deps 漏生成的散装图）
// 用法：pnpm exec vite-node scripts/regen-graph.ts <topicId>
import { loadEnv } from 'vite'
import { regenerateGraph } from '../server/services/graph-service'

Object.assign(process.env, loadEnv('development', process.cwd(), ''))

const topicId = process.argv[2]
if (!topicId) {
  console.error('用法：pnpm exec vite-node scripts/regen-graph.ts <topicId>')
  process.exit(1)
}

const graph = await regenerateGraph(topicId, (stage, detail) => {
  console.log(`[${stage}]`, detail ? JSON.stringify(detail).slice(0, 300) : '')
})
const edges = graph.nodes.reduce((acc, n) => acc + n.deps.length, 0)
console.log(`完成：${graph.nodes.length} 个节点，${edges} 条依赖边`)
