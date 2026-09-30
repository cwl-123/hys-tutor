<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { KnowledgeNode } from '@shared/types'

const props = defineProps<{
  node: KnowledgeNode
  allNodes: KnowledgeNode[]
}>()

const emit = defineEmits<{
  save: [patch: Partial<KnowledgeNode>]
  remove: [id: string]
  close: []
}>()

const name = ref(props.node.name)
const description = ref(props.node.description)
const deps = ref<string[]>([...props.node.deps])

watch(
  () => props.node.id,
  () => {
    name.value = props.node.name
    description.value = props.node.description
    deps.value = [...props.node.deps]
  },
)

const depCandidates = computed(() => props.allNodes.filter((n) => n.id !== props.node.id))

function toggleDep(id: string) {
  deps.value = deps.value.includes(id) ? deps.value.filter((d) => d !== id) : [...deps.value, id]
}

function onSave() {
  emit('save', {
    name: name.value.trim(),
    description: description.value.trim(),
    deps: [...deps.value],
    manualEdited: true,
  })
}
</script>

<template>
  <aside class="panel">
    <header class="panel__header">
      <span>编辑知识点</span>
      <button
        class="panel__close"
        @click="emit('close')"
      >
        ×
      </button>
    </header>

    <label class="panel__field">
      <span>名称</span>
      <input
        v-model="name"
        type="text"
      >
    </label>

    <label class="panel__field">
      <span>描述</span>
      <textarea
        v-model="description"
        rows="3"
      />
    </label>

    <div class="panel__field">
      <span>前置依赖（点击切换）</span>
      <div class="panel__deps">
        <button
          v-for="cand in depCandidates"
          :key="cand.id"
          class="dep-chip"
          :class="{ 'dep-chip--on': deps.includes(cand.id) }"
          @click="toggleDep(cand.id)"
        >
          {{ cand.name }}
        </button>
        <p
          v-if="depCandidates.length === 0"
          class="panel__empty"
        >
          暂无其他节点
        </p>
      </div>
    </div>

    <div class="panel__meta">
      掌握分：{{ node.mastery }}（由练习批改更新，不可手改）
    </div>

    <footer class="panel__actions">
      <button
        class="btn btn--danger"
        @click="emit('remove', node.id)"
      >
        删除节点
      </button>
      <button
        class="btn btn--primary"
        :disabled="!name.trim()"
        @click="onSave"
      >
        应用
      </button>
    </footer>
  </aside>
</template>

<style scoped>
.panel {
  width: 300px;
  border-left: 1px solid var(--border);
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  overflow-y: auto;
}
.panel__header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-weight: 600;
}
.panel__close {
  border: none;
  background: none;
  font-size: 20px;
  cursor: pointer;
  color: var(--text-dim);
}
.panel__field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 13px;
  color: var(--text-dim);
}
.panel__field input,
.panel__field textarea {
  font: inherit;
  color: var(--text);
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
}
.panel__deps {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.dep-chip {
  font-size: 12px;
  padding: 3px 10px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: #fff;
  cursor: pointer;
}
.dep-chip--on {
  border-color: #3b82f6;
  background: #eff6ff;
  color: #1d4ed8;
}
.panel__empty {
  font-size: 12px;
  color: var(--text-dim);
}
.panel__meta {
  font-size: 12px;
  color: var(--text-dim);
}
.panel__actions {
  margin-top: auto;
  display: flex;
  justify-content: space-between;
  gap: 8px;
}
.btn {
  font: inherit;
  padding: 6px 14px;
  border-radius: 6px;
  border: 1px solid var(--border);
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
.btn--danger {
  color: var(--mastery-red);
}
</style>
