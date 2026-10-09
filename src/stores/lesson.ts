import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { Attempt, Lesson, LessonImage, Question, Topic } from '@shared/types'
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
      if (d.tool === 'image_search') return `配图搜索：${String(d.args.query ?? '')}`
      return null
    }
    case 'research-note-saved': {
      const d = detail as { sources: number; images?: number }
      const imgs = d.images ? `，配图 ${d.images} 张` : ''
      return `研究笔记已保存（${d.sources} 个来源${imgs}）`
    }
    case 'outline':
      return '正在设计课程大纲…'
    case 'outline-done': {
      const d = detail as { focus: string; sections: number }
      return `大纲完成：${d.sections} 个章节，重点「${d.focus}」`
    }
    case 'write':
      return '正在写课程正文…'
    case 'revise':
      return 'AI 正在按你的意见重写课程…'
    case 'self-check':
      return '对照研究笔记自查 + 出课末题…'
    case 'self-check-skipped':
      return '自查输出异常，已跳过（保留重写正文与原题目）'
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

// 备课大阶段（进度条与步骤条用）：把后端的细粒度 stage 归并成 6 个阶段
export const LESSON_PHASES = ['选题', '联网研究', '设计大纲', '撰写正文', '自查出题', '完成'] as const

// 后端 stage → 大阶段下标
function stagePhase(stage: string): number | null {
  switch (stage) {
    case 'schedule':
    case 'scheduled':
      return 0
    case 'research':
    case 'research-tool':
    case 'research-tool-failed':
    case 'research-note-saved':
      return 1
    case 'outline':
    case 'outline-done':
      return 2
    case 'write':
    case 'write-delta':
      return 3
    case 'self-check':
    case 'self-check-done':
    case 'self-check-skipped':
      return 4
    case 'done':
      return 5
    case 'revise':
      return 3
    default:
      return null
  }
}

// 当前挂接中的进度流；重新挂接/离开页面时中断旧连接，避免重复阶段
let attachAbort: AbortController | null = null

export const useLessonStore = defineStore('lesson', () => {
  const stages = ref<StageEntry[]>([])
  const streamingContent = ref('')
  const generating = ref(false)
  const error = ref<string | null>(null)
  const phase = ref(0)
  const startedAt = ref<number | null>(null)
  // 本次挂接的进度流以「完成」收尾（用于生成完成后的显式提示）
  const justCompleted = ref(false)

  const topic = ref<Topic | null>(null)
  const lesson = ref<Lesson | null>(null)
  const questions = ref<Question[]>([])
  const questionsGeneratedAt = ref<string | undefined>(undefined)
  const attempts = ref<Attempt[]>([])

  function reset() {
    stages.value = []
    streamingContent.value = ''
    error.value = null
    lesson.value = null
    questions.value = []
    questionsGeneratedAt.value = undefined
    attempts.value = []
    phase.value = 0
    startedAt.value = null
    justCompleted.value = false
  }

  // 发起后台备课任务并挂接进度；离开页面再回来可重新 attach 回放
  async function generate(topicId: string, nodeId?: string): Promise<string | null> {
    reset()
    // 立即进入进度视图，避免任何窗口期只显示"加载中"
    generating.value = true
    startedAt.value = Date.now()
    stages.value = [{ key: 'init', label: '正在发起备课任务…', ts: Date.now() }]
    try {
      const res = await fetch(`/api/topics/${topicId}/lessons`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(nodeId ? { nodeId } : {}),
      })
      const data = (await res.json()) as { lessonId?: string; reused?: boolean; error?: string }
      if (!res.ok || !data.lessonId) {
        throw new Error(data.error ?? `发起备课失败：${res.status}`)
      }
      const preface = data.reused ? '检测到该方向已有在途备课任务，直接挂接其进度' : ''
      await attach(data.lessonId, preface)
      return data.lessonId
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err)
      generating.value = false
      return null
    }
  }

  // 挂接在途/已完成任务的进度流（服务端回放已缓存阶段）
  // 重新挂接时会中断上一条流并清空进度，避免重复阶段
  async function attach(lessonId: string, preface?: string) {
    attachAbort?.abort()
    const controller = new AbortController()
    attachAbort = controller
    stages.value = preface ? [{ key: 'init', label: preface, ts: Date.now() }] : []
    streamingContent.value = ''
    error.value = null
    generating.value = true
    phase.value = 0
    startedAt.value = Date.now()
    justCompleted.value = false
    let pendingLoad: Promise<void> | null = null
    try {
      await getSse(
        `/api/lessons/${lessonId}/progress`,
        {
          onEvent(event, data) {
            if (event === 'stage') {
              const e = data as { stage: string; detail?: unknown }
              const p = stagePhase(e.stage)
              if (p !== null) phase.value = Math.max(phase.value, p)
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
              justCompleted.value = true
              phase.value = LESSON_PHASES.length - 1
              pendingLoad = load(lessonId)
            } else if (event === 'error') {
              error.value = (data as { message: string }).message
            }
          },
        },
        controller.signal,
      )
      if (pendingLoad) await pendingLoad
    } catch (err) {
      // 主动中断（重新挂接/离开页面）不算错误
      if (!controller.signal.aborted) {
        error.value = err instanceof Error ? err.message : String(err)
      }
    } finally {
      if (attachAbort === controller) {
        attachAbort = null
        generating.value = false
      }
    }
  }

  // 离开备课页时中断进度流；再次进入 attach 会重新回放，进度不丢
  function detach() {
    attachAbort?.abort()
    attachAbort = null
    generating.value = false
  }

  async function load(lessonId: string) {
    const res = await fetch(`/api/lessons/${lessonId}`)
    const data = (await res.json()) as {
      topic?: Topic
      lesson?: Lesson
      questions?: { generatedAt?: string; questions: Question[] } | null
      error?: string
    }
    if (!res.ok || !data.lesson) {
      error.value = data.error ?? `加载课程失败：${res.status}`
      return
    }
    topic.value = data.topic ?? null
    lesson.value = data.lesson
    questions.value = data.questions?.questions ?? []
    questionsGeneratedAt.value = data.questions?.generatedAt
  }

  // 该课全部测验记录（含题目快照与批改结果）
  async function loadAttempts(lessonId: string) {
    const res = await fetch(`/api/lessons/${lessonId}/attempts`)
    const data = (await res.json()) as { attempts?: Attempt[]; error?: string }
    if (!res.ok) {
      error.value = data.error ?? `加载答题记录失败：${res.status}`
      return
    }
    attempts.value = data.attempts ?? []
  }

  // 再次测验：LLM 重新出一套新题
  async function regenerate(lessonId: string): Promise<boolean> {
    const res = await fetch(`/api/lessons/${lessonId}/questions/regenerate`, { method: 'POST' })
    const data = (await res.json()) as {
      questions?: { generatedAt?: string; questions: Question[] }
      error?: string
    }
    if (!res.ok || !data.questions) {
      error.value = data.error ?? `出题失败：${res.status}`
      return false
    }
    questions.value = data.questions.questions
    questionsGeneratedAt.value = data.questions.generatedAt
    return true
  }

  // 发起课件 AI 优化并挂接进度
  async function revise(lessonId: string, instruction: string) {
    const res = await fetch(`/api/lessons/${lessonId}/revise`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instruction }),
    })
    const data = (await res.json()) as { lessonId?: string; error?: string }
    if (!res.ok || !data.lessonId) {
      error.value = data.error ?? `发起优化失败：${res.status}`
      return
    }
    await attach(data.lessonId)
  }

  // 手动写入课件正文（改图表/编辑）：走版本快照可撤销；失败抛错由调用方提示
  async function saveContent(contentMd: string, summary?: string): Promise<void> {
    const id = lesson.value?.id
    if (!id) throw new Error('课程未加载')
    const res = await fetch(`/api/lessons/${id}/content`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contentMd, summary }),
    })
    const data = (await res.json()) as { contentMd?: string; images?: LessonImage[]; error?: string }
    if (!res.ok || data.contentMd == null) {
      throw new Error(data.error ?? `保存失败：${res.status}`)
    }
    if (lesson.value) {
      lesson.value.contentMd = data.contentMd
      lesson.value.images = data.images ?? []
    }
  }

  return {
    stages,
    streamingContent,
    generating,
    error,
    phase,
    startedAt,
    justCompleted,
    topic,
    lesson,
    questions,
    questionsGeneratedAt,
    attempts,
    generate,
    attach,
    detach,
    revise,
    load,
    loadAttempts,
    regenerate,
    reset,
    saveContent,
  }
})
