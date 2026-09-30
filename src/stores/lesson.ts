import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { Lesson, Question, Topic } from '@shared/types'
import { getSse } from '@/utils/sse'

export interface StageEntry {
  key: string
  label: string
  ts: number
}

// 把后端 stage 事件翻译成人话；返回 null 表示不展示
function stageLabel(stage: string, detail?: unknown): string | null {
  switch (stage) {
    case 'schedule':
      return '正在选题…'
    case 'scheduled': {
      const d = detail as { nodeName: string; reason: string }
      return `已选题：${d.nodeName} —— ${d.reason}`
    }
    case 'research': {
      const d = detail as { cached: boolean }
      return d.cached ? '研究笔记命中缓存，跳过联网搜索' : '研究中：联网搜索优质内容…'
    }
    case 'research-tool': {
      const d = detail as { tool: string; args: Record<string, unknown> }
      if (d.tool === 'web_search') return `搜索：${String(d.args.query ?? '')}`
      if (d.tool === 'web_fetch') return `精读：${String(d.args.url ?? '').slice(0, 90)}`
      return null
    }
    case 'research-note-saved': {
      const d = detail as { sources: number }
      return `研究笔记已保存（${d.sources} 个来源）`
    }
    case 'outline':
      return '正在设计课程大纲…'
    case 'outline-done': {
      const d = detail as { focus: string; sections: number }
      return `大纲完成：${d.sections} 个章节，重点「${d.focus}」`
    }
    case 'write':
      return '正在写课程正文…'
    case 'self-check':
      return '对照研究笔记自查 + 出课末题…'
    case 'self-check-done': {
      const d = detail as { issues: string[]; corrected: boolean }
      return d.issues.length > 0
        ? `自查发现 ${d.issues.length} 处问题${d.corrected ? '，已修正' : ''}`
        : '自查通过，未发现事实性问题'
    }
    case 'done':
      return '备课完成'
    default:
      return null
  }
}

export const useLessonStore = defineStore('lesson', () => {
  const stages = ref<StageEntry[]>([])
  const streamingContent = ref('')
  const generating = ref(false)
  const error = ref<string | null>(null)

  const topic = ref<Topic | null>(null)
  const lesson = ref<Lesson | null>(null)
  const questions = ref<Question[]>([])

  function reset() {
    stages.value = []
    streamingContent.value = ''
    error.value = null
    lesson.value = null
    questions.value = []
  }

  // 发起后台备课任务并挂接进度；离开页面再回来可重新 attach 回放
  async function generate(topicId: string, nodeId?: string): Promise<string | null> {
    reset()
    const res = await fetch(`/api/topics/${topicId}/lessons`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(nodeId ? { nodeId } : {}),
    })
    const data = (await res.json()) as { lessonId?: string; reused?: boolean; error?: string }
    if (!res.ok || !data.lessonId) {
      error.value = data.error ?? `发起备课失败：${res.status}`
      return null
    }
    await attach(data.lessonId)
    return data.lessonId
  }

  // 挂接在途/已完成任务的进度流（服务端回放已缓存阶段）
  async function attach(lessonId: string) {
    generating.value = true
    error.value = null
    let pendingLoad: Promise<void> | null = null
    try {
      await getSse(`/api/lessons/${lessonId}/progress`, {
        onEvent(event, data) {
          if (event === 'stage') {
            const e = data as { stage: string; detail?: unknown }
            if (e.stage === 'write-delta') {
              streamingContent.value += (e.detail as { text: string }).text
              return
            }
            const label = stageLabel(e.stage, e.detail)
            if (label) {
              stages.value = [
                ...stages.value,
                { key: `${Date.now()}-${stages.value.length}`, label, ts: Date.now() },
              ]
            }
          } else if (event === 'result') {
            pendingLoad = load(lessonId)
          } else if (event === 'error') {
            error.value = (data as { message: string }).message
          }
        },
      })
      if (pendingLoad) await pendingLoad
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err)
    } finally {
      generating.value = false
    }
  }

  async function load(lessonId: string) {
    const res = await fetch(`/api/lessons/${lessonId}`)
    const data = (await res.json()) as {
      topic?: Topic
      lesson?: Lesson
      questions?: { questions: Question[] } | null
      error?: string
    }
    if (!res.ok || !data.lesson) {
      error.value = data.error ?? `加载课程失败：${res.status}`
      return
    }
    topic.value = data.topic ?? null
    lesson.value = data.lesson
    questions.value = data.questions?.questions ?? []
  }

  return { stages, streamingContent, generating, error, topic, lesson, questions, generate, attach, load, reset }
})
