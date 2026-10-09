<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { VueFlow, type Node, type Edge, type NodeMouseEvent } from '@vue-flow/core'
import { Controls } from '@vue-flow/controls'
import { Background } from '@vue-flow/background'
import '@vue-flow/core/dist/style.css'
import '@vue-flow/core/dist/theme-default.css'
import '@vue-flow/controls/dist/style.css'
import { useTopicStore } from '@/stores/topic'
import { layoutGraph } from '@/utils/layout'
import GraphNode from '@/components/GraphNode.vue'
import NodePanel from '@/components/NodePanel.vue'
import GraphChatPanel from '@/components/GraphChatPanel.vue'
import type { LessonMeta } from '@shared/api'
import type { KnowledgeNode } from '@shared/types'

const route = useRoute()
const router = useRouter()
const store = useTopicStore()

const topicId = computed(() => String(route.params.id))
const selectedId = ref<string | null>(null)
const chatVisible = ref(false)
const applyError = ref<string | null>(null)

onMounted(async () => {
  await store.loadTopic(topicId.value)
})

// 后台正在进行备课/优化的课程 → 工具栏提供「查看进度」入口（可随时离开再进来）
const activeLesson = computed(
  () => store.lessons.find((l) => l.status !== 'generated' && l.status !== 'failed') ?? null,
)
const activeLessonLabel = computed(() =>
  activeLesson.value?.status === 'revising' ? '课件优化中' : '课件生成中',
)

let pollTimer: number | undefined
function stopPolling() {
  if (pollTimer !== undefined) {
    clearInterval(pollTimer)
    pollTimer = undefined
  }
}

// 生成/优化刚结束时给一个明确提示（否则用户不知道课件已就绪）
const doneToast = ref<LessonMeta | null>(null)
let toastTimer: number | undefined
watch(
  () => activeLesson.value?.id,
  (id, prevId) => {
    stopPolling()
    if (id) pollTimer = window.setInterval(() => void store.fetchLessons(topicId.value), 8000)
    if (!id && prevId) {
      const finished = [...store.lessons]
        .filter((l) => l.status === 'generated' && l.nodeIds.length)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
      if (finished) {
        doneToast.value = finished
        window.clearTimeout(toastTimer)
        toastTimer = window.setTimeout(() => (doneToast.value = null), 10_000)
      }
    }
  },
  { immediate: true },
)
onUnmounted(() => {
  stopPolling()
  window.clearTimeout(toastTimer)
})

const positions = computed(() => layoutGraph(store.nodes))

const lessonCountByNode = computed(() => {
  const counts = new Map<string, number>()
  for (const l of store.lessons) {
    for (const nid of l.nodeIds) counts.set(nid, (counts.get(nid) ?? 0) + 1)
  }
  return counts
})

// 每个知识点节点上挂载的课件状态（生成中 / 已生成 / 失败），用于卡片角标
type NodeLessonStatus = 'generating' | 'generated' | 'failed'
const nodeStatusByNode = computed(() => {
  const m = new Map<string, NodeLessonStatus>()
  for (const l of store.lessons) {
    for (const nid of l.nodeIds) {
      const cur = m.get(nid)
      if (l.status === 'generated') {
        if (cur !== 'generating') m.set(nid, 'generated')
      } else if (l.status === 'failed') {
        if (!cur) m.set(nid, 'failed')
      } else {
        m.set(nid, 'generating')
      }
    }
  }
  return m
})

const flowNodes = computed<Node[]>(() =>
  store.nodes.map((n) => ({
    id: n.id,
    type: 'knode',
    position: positions.value.get(n.id) ?? { x: 0, y: 0 },
    data: {
      node: n,
      selected: n.id === selectedId.value,
      lessonCount: lessonCountByNode.value.get(n.id) ?? 0,
      lessonStatus: nodeStatusByNode.value.get(n.id),
    },
    draggable: false,
  })),
)

const flowEdges = computed<Edge[]>(() => {
  const ids = new Set(store.nodes.map((n) => n.id))
  return store.nodes.flatMap((n) =>
    n.deps
      .filter((d) => ids.has(d) && d !== n.id)
      .map<Edge>((d) => ({
        id: `${d}->${n.id}`,
        source: d,
        target: n.id,
        markerEnd: 'arrowclosed',
      })),
  )
})

const selectedNode = computed(() => store.nodes.find((n) => n.id === selectedId.value) ?? null)

const selectedNodeLessons = computed(() =>
  selectedNode.value ? store.lessons.filter((l) => l.nodeIds.includes(selectedNode.value!.id)) : [],
)

function onNodeClick(event: NodeMouseEvent) {
  selectedId.value = event.node.id
}

// AI 建议的图谱确认后直接落盘
async function applyAiProposal(nodes: KnowledgeNode[]) {
  applyError.value = null
  try {
    await store.saveGraph(nodes.map((n) => ({ ...n, deps: [...n.deps] })))
  } catch (err) {
    applyError.value = err instanceof Error ? err.message : String(err)
  }
}

// 面板「学这个知识点」：指定节点备课
function learnNode(nodeId: string) {
  void router.push(`/lesson/new?topic=${topicId.value}&node=${nodeId}`)
}

// 面板删除课件
async function deleteLesson(lessonId: string) {
  applyError.value = null
  try {
    const res = await fetch(`/api/lessons/${lessonId}`, { method: 'DELETE' })
    if (!res.ok) {
      const data = (await res.json()) as { error?: string }
      throw new Error(data.error ?? `删除失败：${res.status}`)
    }
    await store.fetchLessons(topicId.value)
  } catch (err) {
    applyError.value = err instanceof Error ? err.message : String(err)
  }
}
</script>

<template>
  <div class="graph-view">
    <div
      v-if="store.loading"
      class="state"
    >
      <p>加载中…</p>
    </div>

    <div
      v-else-if="store.error || !store.topic"
      class="state"
    >
      <p class="state__error">
        {{ store.error ?? '课题不存在' }}
      </p>
      <RouterLink
        to="/"
        class="btn"
      >
        ← 返回学习方向
      </RouterLink>
    </div>

    <template v-else>
      <div class="toolbar">
        <RouterLink
          to="/"
          class="toolbar__home"
        >
          ←
        </RouterLink>
        <strong>{{ store.topic.name }}</strong>
        <span class="toolbar__count">{{ store.nodes.length }} 个知识点</span>
        <div class="toolbar__legend">
          <span class="legend"><i class="legend__dot legend__dot--red" />未掌握 &lt;40</span>
          <span class="legend"><i class="legend__dot legend__dot--yellow" />学习中 40-79</span>
          <span class="legend"><i class="legend__dot legend__dot--green" />已掌握 ≥80</span>
        </div>
        <div class="toolbar__actions">
          <RouterLink
            v-if="activeLesson"
            :to="`/lesson/${activeLesson.id}`"
            class="btn btn--progress"
            title="后台备课尚未完成，点击查看实时进度"
          >
            ⏳ {{ activeLessonLabel }} · 查看进度
          </RouterLink>
          <RouterLink
            :to="`/lesson/new?topic=${topicId}`"
            class="btn btn--go"
            title="由排课引擎自动选择：已解锁且掌握分最低的知识点"
          >
            开始下一课 →
          </RouterLink>
          <button
            class="btn"
            :class="{ 'btn--on': chatVisible }"
            @click="chatVisible = !chatVisible"
          >
            🤖 AI 调整
          </button>
        </div>
      </div>
      <p
        v-if="applyError"
        class="toolbar__error"
      >
        {{ applyError }}
      </p>

      <div
        v-if="doneToast"
        class="done-toast"
      >
        <span class="done-toast__text">🎉 课件已生成：{{ doneToast.title }}</span>
        <RouterLink
          :to="`/lesson/${doneToast.id}`"
          class="done-toast__go"
        >
          去查看 →
        </RouterLink>
        <button
          class="done-toast__close"
          title="关闭"
          @click="doneToast = null"
        >
          ×
        </button>
      </div>

      <div class="canvas-wrap">
        <VueFlow
          :nodes="flowNodes"
          :edges="flowEdges"
          :default-viewport="{ zoom: 0.85 }"
          :default-edge-options="{ style: { stroke: 'var(--border-strong)' } }"
          fit-view-on-init
          @node-click="onNodeClick"
        >
          <Background />
          <Controls :show-interactive="false" />
          <template #node-knode="nodeProps">
            <GraphNode :data="nodeProps.data" />
          </template>
        </VueFlow>

        <NodePanel
          v-if="selectedNode"
          :node="selectedNode"
          :all-nodes="store.nodes"
          :lessons="selectedNodeLessons"
          @close="selectedId = null"
          @learn="learnNode"
          @delete-lesson="deleteLesson"
        />

        <GraphChatPanel
          v-if="chatVisible"
          :topic-id="topicId"
          @apply="applyAiProposal"
          @close="chatVisible = false"
        />
      </div>
    </template>
  </div>
</template>

<style scoped>
.graph-view {
  display: flex;
  flex-direction: column;
  height: calc(100vh - var(--header-h));
}
.state {
  margin: auto;
  text-align: center;
  padding: 24px;
}
.state__error {
  color: var(--mastery-red);
}
.toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 16px;
  border-bottom: 1px solid var(--border);
}
.toolbar__home {
  color: var(--text-dim);
  text-decoration: none;
  font-size: 16px;
}
.toolbar__home:hover {
  color: var(--primary-strong);
}
.toolbar__count {
  font-size: 13px;
  color: var(--text-dim);
}
.toolbar__legend {
  display: flex;
  gap: 14px;
}
.legend {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  color: var(--text-dim);
}
.legend__dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}
.legend__dot--red {
  background: var(--mastery-red);
}
.legend__dot--yellow {
  background: var(--mastery-yellow);
}
.legend__dot--green {
  background: var(--mastery-green);
}
.toolbar__actions {
  margin-left: auto;
  display: flex;
  gap: 8px;
}
.toolbar__error {
  padding: 6px 16px;
  margin: 0;
  color: var(--mastery-red);
  font-size: 13px;
  background: var(--red-bg);
}
.done-toast {
  position: fixed;
  right: 24px;
  bottom: 24px;
  z-index: 300;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px 12px 18px;
  background: #fff;
  border: 1px solid var(--green-border);
  border-left: 4px solid var(--mastery-green);
  border-radius: 12px;
  box-shadow: 0 12px 32px rgb(var(--ink-rgb) / 16%);
  animation: toast-in 0.25s ease;
}
@keyframes toast-in {
  from {
    opacity: 0;
    transform: translateY(12px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
.done-toast__text {
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
  max-width: 320px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.done-toast__go {
  flex: none;
  font-size: 13px;
  color: #fff;
  background: var(--green-strong);
  border-radius: 7px;
  padding: 6px 12px;
  text-decoration: none;
}
.done-toast__close {
  border: none;
  background: none;
  color: var(--text-dim);
  font-size: 18px;
  line-height: 1;
  cursor: pointer;
}
.canvas-wrap {
  flex: 1;
  display: flex;
  min-height: 0;
}
.canvas-wrap :deep(.vue-flow) {
  flex: 1;
}
.btn {
  font: inherit;
  font-size: 13px;
  padding: 5px 12px;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: #fff;
  cursor: pointer;
  text-decoration: none;
  color: var(--text);
}
.btn--primary {
  background: var(--primary);
  border-color: var(--primary);
  color: #fff;
}
.btn--primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.btn--go {
  background: var(--green-strong);
  border-color: var(--green-strong);
  color: #fff;
  text-decoration: none;
  display: inline-flex;
  align-items: center;
}
.btn--on {
  border-color: var(--primary);
  background: var(--primary-bg);
  color: var(--primary-hover);
}
.btn--progress {
  background: var(--amber-bg);
  border-color: var(--mastery-yellow);
  color: var(--amber-text);
  text-decoration: none;
  display: inline-flex;
  align-items: center;
}
</style>
