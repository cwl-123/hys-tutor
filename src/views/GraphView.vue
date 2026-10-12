<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { VueFlow, useVueFlow, type Node, type Edge, type NodeMouseEvent } from '@vue-flow/core'
import { Controls } from '@vue-flow/controls'
import { Background } from '@vue-flow/background'
import {
  ArrowLeft,
  ArrowRight,
  Bot,
  Filter,
  LoaderCircle,
  PartyPopper,
  Settings2,
  X,
} from 'lucide-vue-next'
import '@vue-flow/core/dist/style.css'
import '@vue-flow/core/dist/theme-default.css'
import '@vue-flow/controls/dist/style.css'
import { useTopicStore } from '@/stores/topic'
import { layoutGraph, NODE_WIDTH, NODE_HEIGHT } from '@/utils/layout'
import { scheduleNext } from '@shared/scheduler'
import { isDark } from '@/utils/theme'
import GraphNode from '@/components/GraphNode.vue'
import NodePanel from '@/components/NodePanel.vue'
import GraphChatPanel from '@/components/GraphChatPanel.vue'
import TopicProfilePanel from '@/components/TopicProfilePanel.vue'
import type { LessonMeta } from '@shared/api'
import type { KnowledgeNode } from '@shared/types'
import { MASTERY_LOW_THRESHOLD, MASTERY_UNLOCK_THRESHOLD } from '@shared/types'
import { errMsg } from '@shared/error'

const route = useRoute()
const router = useRouter()
const store = useTopicStore()
const { fitView, setCenter, viewport } = useVueFlow()

const topicId = computed(() => String(route.params.id))
const selectedId = ref<string | null>(null)
const chatVisible = ref(false)
const profileVisible = ref(false)
const applyError = ref<string | null>(null)

// 视图过滤：全部 / 待学（<80）/ 推荐路径（下一课 + 其全部前置链）
const viewMode = ref<'all' | 'todo' | 'path'>('all')
const VIEW_MODES = [
  { k: 'all', label: '全部', tip: '显示全部知识点' },
  { k: 'todo', label: '待学', tip: '只显示未掌握（<80 分）的知识点' },
  { k: 'path', label: '推荐路径', tip: '只显示下一课及其全部前置依赖链' },
] as const

// 排课引擎的推荐：图上唯一带「下一课」角标的节点
const recommendation = computed(() => scheduleNext(store.nodes))
const recommendedId = computed(() => recommendation.value.nodeId)

const pathIds = computed<Set<string> | null>(() => {
  if (!recommendedId.value) return null
  const byId = new Map(store.nodes.map((n) => [n.id, n]))
  const out = new Set<string>()
  const walk = (id: string): void => {
    if (out.has(id)) return
    out.add(id)
    for (const d of byId.get(id)?.deps ?? []) walk(d)
  }
  walk(recommendedId.value)
  return out
})

const visibleNodes = computed<KnowledgeNode[]>(() => {
  if (viewMode.value === 'todo') {
    return store.nodes.filter((n) => n.mastery < 80 || n.id === recommendedId.value)
  }
  if (viewMode.value === 'path') {
    const ids = pathIds.value
    if (!ids) return store.nodes
    return store.nodes.filter((n) => ids.has(n.id))
  }
  return store.nodes
})

// 过滤后选中节点可能已隐藏，同步清掉
watch(visibleNodes, (list) => {
  if (selectedId.value && !list.some((n) => n.id === selectedId.value)) selectedId.value = null
})

// 学习设置保存提示
const profileSaved = ref(false)
let profileToastTimer: number | undefined
function onProfileSaved() {
  profileSaved.value = true
  window.clearTimeout(profileToastTimer)
  profileToastTimer = window.setTimeout(() => (profileSaved.value = false), 6000)
}

// AI 调整与学习设置互斥，避免两个侧栏同时展开
function toggleChat() {
  chatVisible.value = !chatVisible.value
  if (chatVisible.value) profileVisible.value = false
}
function toggleProfile() {
  profileVisible.value = !profileVisible.value
  if (profileVisible.value) chatVisible.value = false
}

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
  window.clearTimeout(profileToastTimer)
})

const positions = computed(() => layoutGraph(visibleNodes.value))

// 节点集合变化（首次加载/切换过滤）后重新取景，限制最小缩放保证节点可读
watch(
  () => visibleNodes.value.length,
  async (len) => {
    if (!len) return
    await nextTick()
    fitView({ padding: 0.2, minZoom: 0.4, maxZoom: 1, duration: 300 })
  },
)

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
  visibleNodes.value.map((n) => ({
    id: n.id,
    type: 'knode',
    position: positions.value.get(n.id) ?? { x: 0, y: 0 },
    data: {
      node: n,
      selected: n.id === selectedId.value,
      lessonCount: lessonCountByNode.value.get(n.id) ?? 0,
      lessonStatus: nodeStatusByNode.value.get(n.id),
      recommended: n.id === recommendedId.value,
    },
    draggable: false,
  })),
)

const flowEdges = computed<Edge[]>(() => {
  const ids = new Set(visibleNodes.value.map((n) => n.id))
  return visibleNodes.value.flatMap((n) =>
    n.deps
      .filter((d) => ids.has(d) && d !== n.id)
      .map<Edge>((d) => ({
        id: `${d}->${n.id}`,
        source: d,
        target: n.id,
        markerEnd: 'arrowclosed',
        // 指向推荐节点的边高亮，画出「下一步走这条」的路径感
        ...(n.id === recommendedId.value
          ? { style: { stroke: 'var(--primary)', strokeWidth: 2 } }
          : {}),
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

// 面板点前置依赖 chip：节点被过滤隐藏则先切回全部，再选中并平移画布定位
function focusNode(id: string) {
  if (!visibleNodes.value.some((n) => n.id === id)) viewMode.value = 'all'
  selectedId.value = id
  const pos = positions.value.get(id)
  if (!pos) return
  void nextTick().then(() =>
    setCenter(pos.x + NODE_WIDTH / 2, pos.y + NODE_HEIGHT / 2, {
      zoom: Math.max(viewport.value.zoom, 0.8),
      duration: 300,
    }),
  )
}

// AI 建议的图谱确认后直接落盘
async function applyAiProposal(nodes: KnowledgeNode[]) {
  applyError.value = null
  try {
    await store.saveGraph(nodes.map((n) => ({ ...n, deps: [...n.deps] })))
  } catch (err) {
    applyError.value = errMsg(err)
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
    applyError.value = errMsg(err)
  }
}
</script>

<template>
  <div class="graph-view">
    <div
      v-if="store.loading"
      class="state"
    >
      <span class="spinner" />
      <p>加载图谱中…</p>
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
        <ArrowLeft :size="14" />
        返回学习方向
      </RouterLink>
    </div>

    <template v-else>
      <div class="toolbar">
        <RouterLink
          to="/"
          class="toolbar__home"
        >
          <ArrowLeft :size="16" />
        </RouterLink>
        <strong>{{ store.topic.name }}</strong>
        <span class="toolbar__count">{{ store.nodes.length }} 个知识点</span>
        <div
          class="view-toggle"
          role="group"
          aria-label="图谱视图过滤"
        >
          <button
            v-for="m in VIEW_MODES"
            :key="m.k"
            class="view-toggle__btn"
            :class="{ 'view-toggle__btn--on': viewMode === m.k }"
            :title="m.tip"
            @click="viewMode = m.k"
          >
            <Filter
              v-if="m.k === 'todo'"
              :size="12"
            />
            {{ m.label }}
          </button>
        </div>
        <div class="toolbar__legend">
          <span class="legend"><i class="legend__dot legend__dot--red" />未掌握 &lt;{{ MASTERY_LOW_THRESHOLD }}</span>
          <span class="legend"><i class="legend__dot legend__dot--yellow" />学习中 {{ MASTERY_LOW_THRESHOLD }}-{{ MASTERY_UNLOCK_THRESHOLD - 1 }}</span>
          <span class="legend"><i class="legend__dot legend__dot--green" />已掌握 ≥{{ MASTERY_UNLOCK_THRESHOLD }}</span>
        </div>
        <div class="toolbar__actions">
          <RouterLink
            v-if="activeLesson"
            :to="`/lesson/${activeLesson.id}`"
            class="btn btn--progress"
            title="后台备课尚未完成，点击查看实时进度"
          >
            <LoaderCircle
              :size="13"
              class="spin"
            />
            {{ activeLessonLabel }} · 查看进度
          </RouterLink>
          <RouterLink
            :to="`/lesson/new?topic=${topicId}`"
            class="btn btn--primary"
            title="由排课引擎自动选择：已解锁且掌握分最低的知识点"
          >
            开始下一课
            <ArrowRight :size="14" />
          </RouterLink>
          <button
            class="btn"
            :class="{ 'btn--on': profileVisible }"
            title="编辑讲解风格、当前程度与其他要求，应用于之后的课程"
            @click="toggleProfile"
          >
            <Settings2 :size="14" />
            学习设置
          </button>
          <button
            class="btn"
            :class="{ 'btn--on': chatVisible }"
            @click="toggleChat"
          >
            <Bot :size="14" />
            AI 调整
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
        <PartyPopper
          :size="16"
          class="done-toast__icon"
        />
        <span class="done-toast__text">课件已生成：{{ doneToast.title }}</span>
        <RouterLink
          :to="`/lesson/${doneToast.id}`"
          class="done-toast__go"
        >
          去查看
          <ArrowRight :size="13" />
        </RouterLink>
        <button
          class="done-toast__close"
          title="关闭"
          @click="doneToast = null"
        >
          <X :size="15" />
        </button>
      </div>

      <div
        v-if="profileSaved"
        class="done-toast"
      >
        <Settings2
          :size="16"
          class="done-toast__icon"
        />
        <span class="done-toast__text">学习设置已保存，将应用于之后的课程</span>
        <button
          class="done-toast__close"
          title="关闭"
          @click="profileSaved = false"
        >
          <X :size="15" />
        </button>
      </div>

      <div class="canvas-wrap">
        <VueFlow
          :nodes="flowNodes"
          :edges="flowEdges"
          :default-viewport="{ zoom: 0.85 }"
          :default-edge-options="{ style: { stroke: 'var(--border-strong)' } }"
          :min-zoom="0.3"
          :max-zoom="1.6"
          @node-click="onNodeClick"
        >
          <Background :color="isDark ? '#2e3846' : undefined" />
          <Controls :show-interactive="false" />
          <template #node-knode="nodeProps">
            <GraphNode :data="nodeProps.data" />
          </template>
        </VueFlow>

        <div
          v-if="visibleNodes.length === 0"
          class="canvas-empty"
        >
          <template v-if="store.nodes.length === 0">
            <p>还没有知识点图谱</p>
          </template>
          <template v-else-if="viewMode === 'todo'">
            <p>全部知识点均已掌握 🎉</p>
            <button
              class="btn"
              @click="viewMode = 'all'"
            >
              查看全部
            </button>
          </template>
          <template v-else>
            <p>当前视图没有可显示的知识点</p>
            <button
              class="btn"
              @click="viewMode = 'all'"
            >
              查看全部
            </button>
          </template>
        </div>

        <NodePanel
          v-if="selectedNode"
          :node="selectedNode"
          :all-nodes="store.nodes"
          :lessons="selectedNodeLessons"
          @close="selectedId = null"
          @learn="learnNode"
          @focus-node="focusNode"
          @delete-lesson="deleteLesson"
        />

        <GraphChatPanel
          v-if="chatVisible"
          :topic-id="topicId"
          @apply="applyAiProposal"
          @close="chatVisible = false"
        />

        <TopicProfilePanel
          v-if="profileVisible"
          @saved="onProfileSaved"
          @close="profileVisible = false"
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
  color: var(--text-dim);
}
.state .spinner {
  display: block;
  margin: 0 auto 12px;
}
.state__error {
  color: var(--mastery-red);
}
.toolbar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px 12px;
  padding: 10px 16px;
  border-bottom: 1px solid var(--border);
}
.toolbar__home {
  display: inline-flex;
  align-items: center;
  color: var(--text-dim);
  text-decoration: none;
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
.view-toggle {
  display: inline-flex;
  padding: 2px;
  border: 1px solid var(--border);
  border-radius: var(--r-pill);
  background: var(--bg-muted);
}
.view-toggle__btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font: inherit;
  font-size: 12px;
  padding: 4px 12px;
  border: none;
  border-radius: var(--r-pill);
  background: none;
  color: var(--text-dim);
  cursor: pointer;
  transition:
    background var(--dur-fast) var(--ease),
    color var(--dur-fast) var(--ease);
}
.view-toggle__btn:hover {
  color: var(--text);
}
.view-toggle__btn--on {
  background: var(--bg);
  color: var(--primary-hover);
  font-weight: 600;
  box-shadow: var(--shadow-sm);
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
/* 窄窗口优先保操作按钮：先收图例，再允许换行 */
@media (max-width: 1240px) {
  .toolbar__legend {
    display: none;
  }
}
@media (max-width: 1080px) {
  .toolbar__actions {
    margin-left: 0;
    flex-wrap: wrap;
  }
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
  z-index: var(--z-toast);
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 14px 12px 16px;
  background: var(--bg);
  border: 1px solid var(--green-border);
  border-left: 4px solid var(--mastery-green);
  border-radius: var(--r-md);
  box-shadow: var(--shadow-lg);
  animation: toast-in var(--dur) var(--ease);
}
.done-toast__icon {
  flex: none;
  color: var(--green-strong);
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
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 13px;
  color: #fff;
  background: var(--green-strong);
  border-radius: var(--r-sm);
  padding: 6px 12px;
  text-decoration: none;
  transition: filter var(--dur-fast) var(--ease);
}
.done-toast__go:hover {
  filter: brightness(1.12);
}
.done-toast__close {
  display: inline-flex;
  align-items: center;
  border: none;
  background: none;
  color: var(--text-dim);
  cursor: pointer;
  padding: 2px;
  border-radius: var(--r-sm);
}
.done-toast__close:hover {
  color: var(--text);
  background: var(--bg-muted);
}
.canvas-wrap {
  position: relative;
  flex: 1;
  display: flex;
  min-height: 0;
}
.canvas-wrap :deep(.vue-flow) {
  flex: 1;
}
.canvas-empty {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  color: var(--text-dim);
  font-size: 14px;
  pointer-events: none;
}
.canvas-empty .btn {
  pointer-events: auto;
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
}
</style>
