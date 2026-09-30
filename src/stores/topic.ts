import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { Graph, KnowledgeNode, Topic } from '@shared/types'
import type { LessonMeta } from '@shared/api'
import { postSse } from '@/utils/sse'

export const useTopicStore = defineStore('topic', () => {
  const topics = ref<Topic[]>([])
  const topic = ref<Topic | null>(null)
  const graph = ref<Graph | null>(null)
  const lessons = ref<LessonMeta[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)

  // 备课进行中的阶段提示（生成图谱复用）
  const stageText = ref<string | null>(null)

  const nodes = computed<KnowledgeNode[]>(() => graph.value?.nodes ?? [])

  async function fetchTopics() {
    const res = await fetch('/api/topics')
    const data = (await res.json()) as { topics: Topic[] }
    topics.value = data.topics
  }

  async function loadTopic(id: string) {
    loading.value = true
    error.value = null
    try {
      const res = await fetch(`/api/topics/${id}/graph`)
      if (!res.ok) throw new Error(`加载课题失败：${res.status}`)
      const data = (await res.json()) as { topic: Topic; graph: Graph | null }
      topic.value = data.topic
      graph.value = data.graph
      await fetchLessons(id)
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err)
    } finally {
      loading.value = false
    }
  }

  async function fetchLessons(topicId: string) {
    const res = await fetch(`/api/topics/${topicId}/lessons`)
    lessons.value = res.ok ? ((await res.json()) as { lessons: LessonMeta[] }).lessons : []
  }

  // 返回新课题供路由跳转；失败返回 null（错误在 error 中）
  async function createTopic(name: string): Promise<Topic | null> {
    loading.value = true
    error.value = null
    stageText.value = 'AI 正在调研并生成知识图谱…'
    let created: Topic | null = null
    try {
      await new Promise<void>((resolve, reject) => {
        postSse(
          '/api/topics',
          { name },
          {
            onEvent(event, data) {
              if (event === 'stage') {
                const d = data as { stage: string }
                stageText.value =
                  d.stage === 'retrying' ? '生成结果不合格，正在重试…' : 'AI 正在调研并生成知识图谱…'
              } else if (event === 'result') {
                const r = data as { topic: Topic; graph: Graph }
                created = r.topic
                topic.value = r.topic
                graph.value = r.graph
                topics.value = [...topics.value, r.topic]
                lessons.value = []
                resolve()
              } else if (event === 'error') {
                reject(new Error((data as { message: string }).message))
              }
            },
          },
        ).catch(reject)
      })
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err)
    } finally {
      stageText.value = null
      loading.value = false
    }
    return created
  }

  async function saveGraph(nextNodes: KnowledgeNode[]) {
    if (!topic.value) throw new Error('课题未加载')
    const res = await fetch(`/api/topics/${topic.value.id}/graph`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nodes: nextNodes }),
    })
    const data = (await res.json()) as { graph?: Graph; error?: string }
    if (!res.ok || !data.graph) throw new Error(data.error ?? `保存失败：${res.status}`)
    graph.value = data.graph
  }

  return {
    topics,
    topic,
    graph,
    nodes,
    lessons,
    loading,
    error,
    stageText,
    fetchTopics,
    loadTopic,
    fetchLessons,
    createTopic,
    saveGraph,
  }
})
