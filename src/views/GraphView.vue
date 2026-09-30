<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { VueFlow, type Node, type Edge, type NodeMouseEvent } from '@vue-flow/core'
import { Background } from '@vue-flow/background'
import '@vue-flow/core/dist/style.css'
import '@vue-flow/core/dist/theme-default.css'
import { useTopicStore } from '@/stores/topic'
import { layoutGraph } from '@/utils/layout'
import GraphNode from '@/components/GraphNode.vue'
import NodePanel from '@/components/NodePanel.vue'
import type { KnowledgeNode } from '@shared/types'

const route = useRoute()
const store = useTopicStore()

const topicId = computed(() => String(route.params.id))

// 本地可编辑副本，保存后才写回 store
const editNodes = ref<KnowledgeNode[]>([])
const dirty = ref(false)
const selectedId = ref<string | null>(null)
const saveError = ref<string | null>(null)

onMounted(async () => {
  await store.loadTopic(topicId.value)
  syncFromStore()
})

function syncFromStore() {
  editNodes.value = store.nodes.map((n) => ({ ...n, deps: [...n.deps] }))
  dirty.value = false
  selectedId.value = null
}

const positions = computed(() => layoutGraph(editNodes.value))

const lessonCountByNode = computed(() => {
  const counts = new Map<string, number>()
  for (const l of store.lessons) {
    for (const nid of l.nodeIds) counts.set(nid, (counts.get(nid) ?? 0) + 1)
  }
  return counts
})

const flowNodes = computed<Node[]>(() =>
  editNodes.value.map((n) => ({
    id: n.id,
    type: 'knode',
    position: positions.value.get(n.id) ?? { x: 0, y: 0 },
    data: { node: n, selected: n.id === selectedId.value, lessonCount: lessonCountByNode.value.get(n.id) ?? 0 },
    draggable: false,
  })),
)

const flowEdges = computed<Edge[]>(() => {
  const ids = new Set(editNodes.value.map((n) => n.id))
  return editNodes.value.flatMap((n) =>
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

const selectedNode = computed(() => editNodes.value.find((n) => n.id === selectedId.value) ?? null)

const selectedNodeLessons = computed(() =>
  selectedNode.value ? store.lessons.filter((l) => l.nodeIds.includes(selectedNode.value!.id)) : [],
)

function onNodeClick(event: NodeMouseEvent) {
  selectedId.value = event.node.id
}

function applyPatch(patch: Partial<KnowledgeNode>) {
  if (!selectedId.value) return
  editNodes.value = editNodes.value.map((n) =>
    n.id === selectedId.value ? { ...n, ...patch } : n,
  )
  dirty.value = true
}

function removeNode(id: string) {
  editNodes.value = editNodes.value
    .filter((n) => n.id !== id)
    .map((n) => ({ ...n, deps: n.deps.filter((d) => d !== id), manualEdited: true }))
  selectedId.value = null
  dirty.value = true
}

function addNode() {
  const id = `n_${Date.now().toString(36)}`
  editNodes.value = [
    ...editNodes.value,
    { id, name: '新知识点', description: '', deps: [], mastery: 0, manualEdited: true },
  ]
  selectedId.value = id
  dirty.value = true
}

async function save() {
  saveError.value = null
  try {
    await store.saveGraph(editNodes.value)
    syncFromStore()
  } catch (err) {
    saveError.value = err instanceof Error ? err.message : String(err)
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
        <span class="toolbar__count">{{ editNodes.length }} 个知识点</span>
        <div class="toolbar__legend">
          <span class="legend legend--red">&lt;40</span>
          <span class="legend legend--yellow">40-79</span>
          <span class="legend legend--green">≥80</span>
        </div>
        <div class="toolbar__actions">
          <RouterLink
            :to="`/lesson/new?topic=${topicId}`"
            class="btn btn--go"
          >
            开始下一课 →
          </RouterLink>
          <button
            class="btn"
            @click="addNode"
          >
            + 新增知识点
          </button>
          <button
            class="btn btn--primary"
            :disabled="!dirty"
            @click="save"
          >
            {{ dirty ? '保存修改' : '已保存' }}
          </button>
        </div>
      </div>
      <p
        v-if="saveError"
        class="toolbar__error"
      >
        {{ saveError }}
      </p>

      <div class="canvas-wrap">
        <VueFlow
          :nodes="flowNodes"
          :edges="flowEdges"
          :default-viewport="{ zoom: 0.85 }"
          fit-view-on-init
          @node-click="onNodeClick"
        >
          <Background />
          <template #node-knode="nodeProps">
            <GraphNode :data="nodeProps.data" />
          </template>
        </VueFlow>

        <NodePanel
          v-if="selectedNode"
          :node="selectedNode"
          :all-nodes="editNodes"
          :lessons="selectedNodeLessons"
          @save="applyPatch"
          @remove="removeNode"
          @close="selectedId = null"
        />
      </div>
    </template>
  </div>
</template>

<style scoped>
.graph-view {
  display: flex;
  flex-direction: column;
  height: calc(100vh - 53px);
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
  color: #2563eb;
}
.toolbar__count {
  font-size: 13px;
  color: var(--text-dim);
}
.toolbar__legend {
  display: flex;
  gap: 6px;
}
.legend {
  font-size: 12px;
  padding: 2px 8px;
  border-radius: 999px;
  border: 1px solid;
}
.legend--red {
  color: var(--mastery-red);
  border-color: var(--mastery-red);
}
.legend--yellow {
  color: var(--mastery-yellow);
  border-color: var(--mastery-yellow);
}
.legend--green {
  color: var(--mastery-green);
  border-color: var(--mastery-green);
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
  background: #fef2f2;
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
  background: #3b82f6;
  border-color: #3b82f6;
  color: #fff;
}
.btn--primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.btn--go {
  background: #16a34a;
  border-color: #16a34a;
  color: #fff;
  text-decoration: none;
  display: inline-flex;
  align-items: center;
}
</style>
