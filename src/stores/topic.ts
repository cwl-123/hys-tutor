import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { Graph, KnowledgeNode, Topic } from '@shared/types'
import { postSse } from '@/utils/sse'

export const useTopicStore = defineStore('topic', () => {
  const topics = ref<Topic[]>([])
  const topic = ref<Topic | null>(null)
  const graph = ref<Graph | null>(null)
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

  async function loadFirstTopic() {
    loading.value = true
    error.value = null
    try {
      await fetchTopics()
      if (topics.value.length > 0) await loadTopic(topics.value[0].id)
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err)
    } finally {
      loading.value = false
    }
  }

  async function loadTopic(id: string) {
    const res = await fetch(`/api/topics/${id}/graph`)
    if (!res.ok) throw new Error(`加载课题失败：${res.status}`)
    const data = (await res.json()) as { topic: Topic; graph: Graph | null }
    topic.value = data.topic
    graph.value = data.graph
  }

  async function createTopic(name: string) {
    loading.value = true
    error.value = null
    stageText.value = '正在生成知识图谱…'
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
                  d.stage === 'retrying' ? '生成结果不合格，正在重试…' : '正在生成知识图谱…'
              } else if (event === 'result') {
                const r = data as { topic: Topic; graph: Graph }
                topic.value = r.topic
                graph.value = r.graph
                topics.value = [...topics.value, r.topic]
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
      throw err
    } finally {
      stageText.value = null
      loading.value = false
    }
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
    loading,
    error,
    stageText,
    loadFirstTopic,
    loadTopic,
    createTopic,
    saveGraph,
  }
})
