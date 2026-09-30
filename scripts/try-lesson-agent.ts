// 备课 Agent CLI 冒烟脚本：pnpm exec vite-node scripts/try-lesson-agent.ts
import { loadEnv } from 'vite'
import { listTopics } from '../server/services/graph-service'
import { prepareLesson } from '../server/services/lesson-agent'

Object.assign(process.env, loadEnv('development', process.cwd(), ''))

const topics = await listTopics()
if (topics.length === 0) {
  console.error('没有课题，请先通过页面或 API 创建')
  process.exit(1)
}
const topic = topics[0]
console.log(`课题：${topic.name} (${topic.id})`)

let deltaChars = 0
const startedAt = Date.now()
const { lesson, questions } = await prepareLesson(topic.id, ({ stage, detail }) => {
  if (stage === 'write-delta') {
    deltaChars += (detail as { text: string }).text.length
    return
  }
  const d = detail === undefined ? '' : ` ${JSON.stringify(detail)}`
  console.log(`[${((Date.now() - startedAt) / 1000).toFixed(1)}s] ${stage}${d?.slice(0, 300)}`)
})

console.log('\n===== 结果 =====')
console.log('lesson:', lesson.id, `字数=${lesson.contentMd.length}（流式 ${deltaChars} 字符）`)
console.log('选题理由:', lesson.scheduleReason)
console.log('来源:', lesson.sources.map((s) => `[${s.idx}] ${s.title} ${s.url}`).join('\n      '))
console.log('题目:', questions.questions.map((q) => `${q.id}(${q.type}) ${q.prompt.slice(0, 40)}…`).join('\n      '))
console.log(`总耗时 ${((Date.now() - startedAt) / 1000).toFixed(1)}s`)
