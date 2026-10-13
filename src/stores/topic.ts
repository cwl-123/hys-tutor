import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { Graph, KnowledgeNode, Topic, TopicProfile } from '@shared/types'
import type { LessonMeta, TopicWithStats } from '@shared/api'
import { errMsg } from '@shared/error'
import { postSse } from '@/utils/sse'

export const useTopicStore = defineStore('topic', () => {
  const topics = ref<TopicWithStats[]>([])
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
    const data = (await res.json()) as { topics: TopicWithStats[] }
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
      error.value = errMsg(err)
    } finally {
      loading.value = false
    }
  }

  async function fetchLessons(topicId: string) {
    const res = await fetch(`/api/topics/${topicId}/lessons`)
    lessons.value = res.ok ? ((await res.json()) as { lessons: LessonMeta[] }).lessons : []
  }

  // 返回新课题供路由跳转；失败返回 null（错误在 error 中）
  async function createTopic(name: string, profile?: TopicProfile): Promise<Topic | null> {
    loading.value = true
    error.value = null
    stageText.value = 'AI 正在联网调研并生成知识图谱…'
    let created: Topic | null = null
    try {
      await new Promise<void>((resolve, reject) => {
        let settled = false
        const ok = () => {
          settled = true
          resolve()
        }
        const fail = (err: Error) => {
          settled = true
          reject(err)
        }
        postSse(
          '/api/topics',
          { name, profile },
          {
            onEvent(event, data) {
              if (event === 'stage') {
                const d = data as { stage: string; detail?: unknown }
                if (d.stage === 'researching') {
                  stageText.value = 'AI 正在联网调研该方向的知识体系…'
                } else if (d.stage === 'research-tool') {
                  const dd = d.detail as { tool: string; args?: Record<string, unknown> }
                  if (dd.tool === 'web_search') stageText.value = `调研搜索：${String(dd.args?.query ?? '')}`
                  else if (dd.tool === 'web_fetch') stageText.value = `调研精读：${String(dd.args?.url ?? '').slice(0, 60)}…`
                } else if (d.stage === 'research-failed') {
                  stageText.value = '调研失败，降级为直接生成图谱…'
                } else if (d.stage === 'retrying') {
                  stageText.value = '生成结果不合格，正在重试…'
                } else {
                  stageText.value = '调研完成，正在生成知识点图谱…'
                }
              } else if (event === 'result') {
                const r = data as { topic: Topic; graph: Graph }
                created = r.topic
                topic.value = r.topic
                graph.value = r.graph
                lessons.value = []
                ok()
              } else if (event === 'error') {
                fail(new Error((data as { message: string }).message))
              }
            },
          },
        )
          // 流正常结束却没等到 result/error（服务进程被杀等路径）：兜底失败，不能永远卡在调研中
          .then(() => {
            if (!settled) fail(new Error('调研中断：服务连接已关闭，请重试'))
          })
          .catch(fail)
      })
    } catch (err) {
      error.value = errMsg(err)
    } finally {
      stageText.value = null
      loading.value = false
    }
    if (created) await fetchTopics()
    return created
  }

  // 更新学习偏好（讲解风格/当前程度/其他要求），改动对之后生成的课程生效
  async function updateProfile(profile: TopicProfile): Promise<void> {
    if (!topic.value) throw new Error('课题未加载')
    const res = await fetch(`/api/topics/${topic.value.id}/profile`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profile }),
    })
    const data = (await res.json()) as { topic?: Topic; error?: string }
    if (!res.ok || !data.topic) throw new Error(data.error ?? `保存失败：${res.status}`)
    topic.value = data.topic
    const idx = topics.value.findIndex((t) => t.id === data.topic!.id)
    if (idx >= 0) topics.value[idx] = { ...topics.value[idx], profile: data.topic.profile }
  }

  // 删除学习方向（连同其图谱/课程/掌握分等全部本地数据），成功后从首页列表移除
  async function deleteTopic(id: string): Promise<void> {
    const res = await fetch(`/api/topics/${id}`, { method: 'DELETE' })
    const data = (await res.json()) as { ok?: boolean; error?: string }
    if (!res.ok) throw new Error(data.error ?? `删除失败：${res.status}`)
    topics.value = topics.value.filter((t) => t.id !== id)
    if (topic.value?.id === id) {
      topic.value = null
      graph.value = null
      lessons.value = []
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
    lessons,
    loading,
    error,
    stageText,
    fetchTopics,
    loadTopic,
    fetchLessons,
    createTopic,
    updateProfile,
    saveGraph,
    deleteTopic,
  }
})
