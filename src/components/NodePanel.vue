<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { LessonMeta } from '@shared/api'
import type { KnowledgeNode } from '@shared/types'

const props = defineProps<{
  node: KnowledgeNode
  allNodes: KnowledgeNode[]
  lessons: LessonMeta[]
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

// 当前节点的下游（直接/间接依赖它的节点）：选作前置会成环，从候选中排除
const descendants = computed(() => {
  const result = new Set<string>()
  const queue = [props.node.id]
  while (queue.length) {
    const cur = queue.shift()!
    for (const n of props.allNodes) {
      if (n.deps.includes(cur) && !result.has(n.id)) {
        result.add(n.id)
        queue.push(n.id)
      }
    }
  }
  return result
})

const selectedDeps = computed(() =>
  deps.value
    .map((id) => props.allNodes.find((n) => n.id === id))
    .filter((n): n is KnowledgeNode => n !== undefined),
)

const depSearch = ref('')
const depDropdown = ref(false)

const addCandidates = computed(() => {
  const kw = depSearch.value.trim().toLowerCase()
  return depCandidates.value.filter(
    (n) =>
      !deps.value.includes(n.id) &&
      !descendants.value.has(n.id) &&
      (!kw || n.name.toLowerCase().includes(kw) || n.description.toLowerCase().includes(kw)),
  )
})

function removeDep(id: string) {
  deps.value = deps.value.filter((d) => d !== id)
}

function addDep(id: string) {
  if (!deps.value.includes(id)) deps.value = [...deps.value, id]
  depSearch.value = ''
  depDropdown.value = false
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
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
      <span>前置依赖</span>
      <div class="panel__deps">
        <span
          v-for="d in selectedDeps"
          :key="d.id"
          class="dep-chip dep-chip--on"
        >
          {{ d.name }}
          <button
            class="dep-chip__x"
            title="移除该依赖"
            @click="removeDep(d.id)"
          >
            ×
          </button>
        </span>
        <span
          v-if="selectedDeps.length === 0"
          class="panel__empty"
        >
          无前置依赖（入门节点）
        </span>
      </div>
      <div class="dep-add">
        <input
          v-model="depSearch"
          type="text"
          placeholder="搜索并添加依赖…"
          @focus="depDropdown = true"
          @blur="depDropdown = false"
        >
        <div
          v-if="depDropdown && depSearch.trim()"
          class="dep-add__dropdown"
        >
          <button
            v-for="cand in addCandidates.slice(0, 8)"
            :key="cand.id"
            class="dep-add__item"
            @mousedown.prevent="addDep(cand.id)"
          >
            {{ cand.name }}
            <span class="dep-add__desc">{{ cand.description }}</span>
          </button>
          <p
            v-if="addCandidates.length === 0"
            class="panel__empty dep-add__none"
          >
            无匹配节点（下游节点不可作为前置，避免成环）
          </p>
        </div>
      </div>
    </div>

    <div class="panel__meta">
      掌握分：{{ node.mastery }}（由练习批改更新，不可手改）
    </div>

    <div class="panel__field">
      <span>历史课程（{{ lessons.length }}）</span>
      <div class="panel__lessons">
        <RouterLink
          v-for="l in lessons"
          :key="l.id"
          :to="`/lesson/${l.id}`"
          class="lesson-item"
        >
          <span class="lesson-item__title">{{ l.title }}</span>
          <span class="lesson-item__meta">{{ fmtDate(l.createdAt) }} · {{ l.wordCount }} 字</span>
        </RouterLink>
        <p
          v-if="lessons.length === 0"
          class="panel__empty"
        >
          还没有该知识点的课程
        </p>
      </div>
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
}
.dep-chip--on {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border-color: #3b82f6;
  background: #eff6ff;
  color: #1d4ed8;
}
.dep-chip__x {
  border: none;
  background: none;
  color: #1d4ed8;
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
  padding: 0;
}
.dep-add {
  position: relative;
}
.dep-add input {
  width: 100%;
  font: inherit;
  font-size: 13px;
  padding: 6px 10px;
  border: 1px dashed var(--border);
  border-radius: 6px;
}
.dep-add input:focus {
  border-color: #3b82f6;
  outline: none;
}
.dep-add__dropdown {
  position: absolute;
  z-index: 20;
  top: calc(100% + 4px);
  left: 0;
  right: 0;
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 8px;
  box-shadow: 0 4px 16px rgb(0 0 0 / 12%);
  max-height: 240px;
  overflow-y: auto;
}
.dep-add__item {
  display: block;
  width: 100%;
  text-align: left;
  font: inherit;
  font-size: 13px;
  padding: 7px 10px;
  border: none;
  background: none;
  cursor: pointer;
}
.dep-add__item:hover {
  background: #eff6ff;
}
.dep-add__desc {
  display: block;
  font-size: 11px;
  color: var(--text-dim);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dep-add__none {
  padding: 8px 10px;
  margin: 0;
}
.panel__empty {
  font-size: 12px;
  color: var(--text-dim);
}
.panel__meta {
  font-size: 12px;
  color: var(--text-dim);
}
.panel__lessons {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.lesson-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 6px 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  text-decoration: none;
}
.lesson-item:hover {
  border-color: #3b82f6;
  background: #eff6ff;
}
.lesson-item__title {
  font-size: 13px;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.lesson-item__meta {
  font-size: 11px;
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
