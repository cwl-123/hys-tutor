<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { VueFlow, type Node, type Edge, type NodeMouseEvent } from '@vue-flow/core'
import { Background } from '@vue-flow/background'
import '@vue-flow/core/dist/style.css'
import '@vue-flow/core/dist/theme-default.css'
import { useTopicStore } from '@/stores/topic'
import { layoutGraph } from '@/utils/layout'
import GraphNode from '@/components/GraphNode.vue'
import NodePanel from '@/components/NodePanel.vue'
import type { KnowledgeNode } from '@shared/types'

const store = useTopicStore()

// 本地可编辑副本，保存后才写回 store
const editNodes = ref<KnowledgeNode[]>([])
const dirty = ref(false)
const selectedId = ref<string | null>(null)
const saveError = ref<string | null>(null)

// 开课表单
const topicName = ref('')
const creating = ref(false)

onMounted(async () => {
  await store.loadFirstTopic()
  syncFromStore()
})

function syncFromStore() {
  editNodes.value = store.nodes.map((n) => ({ ...n, deps: [...n.deps] }))
  dirty.value = false
  selectedId.value = null
}

const positions = computed(() => layoutGraph(editNodes.value))

const flowNodes = computed<Node[]>(() =>
  editNodes.value.map((n) => ({
    id: n.id,
    type: 'knode',
    position: positions.value.get(n.id) ?? { x: 0, y: 0 },
    data: { node: n, selected: n.id === selectedId.value },
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

async function createTopic() {
  const name = topicName.value.trim()
  if (!name || creating.value) return
  creating.value = true
  saveError.value = null
  try {
    await store.createTopic(name)
    syncFromStore()
  } catch {
    // 错误已记录在 store.error
  } finally {
    creating.value = false
  }
}
</script>

<template>
  <div class="graph-view">
    <!-- 未开课：创建课题 -->
    <div
      v-if="!store.loading && !store.topic"
      class="create"
    >
      <h1>开始一个新课题</h1>
      <p class="create__hint">
        输入课题名，AI 将生成知识点学习图谱（15~40 个知识点，含依赖关系）
      </p>
      <form
        class="create__form"
        @submit.prevent="createTopic"
      >
        <input
          v-model="topicName"
          type="text"
          placeholder="例如：CTR/CVR 预估模型"
          :disabled="creating"
        >
        <button
          class="btn btn--primary"
          type="submit"
          :disabled="creating || !topicName.trim()"
        >
          {{ creating ? '生成中…' : '生成图谱' }}
        </button>
      </form>
      <p
        v-if="store.stageText"
        class="create__stage"
      >
        {{ store.stageText }}
      </p>
      <p
        v-if="store.error"
        class="create__error"
      >
        {{ store.error }}
      </p>
    </div>

    <div
      v-else-if="store.loading"
      class="create"
    >
      <p>加载中…</p>
    </div>

    <!-- 已有课题：图谱画布 -->
    <template v-else>
      <div class="toolbar">
        <strong>{{ store.topic?.name }}</strong>
        <span class="toolbar__count">{{ editNodes.length }} 个知识点</span>
        <div class="toolbar__legend">
          <span class="legend legend--red">&lt;40</span>
          <span class="legend legend--yellow">40-79</span>
          <span class="legend legend--green">≥80</span>
        </div>
        <div class="toolbar__actions">
          <RouterLink
            to="/lesson/new"
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
.create {
  margin: auto;
  text-align: center;
  max-width: 480px;
  padding: 24px;
}
.create__hint {
  color: var(--text-dim);
  font-size: 14px;
}
.create__form {
  display: flex;
  gap: 8px;
  margin-top: 16px;
}
.create__form input {
  flex: 1;
  font: inherit;
  padding: 8px 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
}
.create__stage {
  margin-top: 12px;
  color: #3b82f6;
  font-size: 14px;
}
.create__error {
  margin-top: 12px;
  color: var(--mastery-red);
  font-size: 14px;
}
.toolbar {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 10px 16px;
  border-bottom: 1px solid var(--border);
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
