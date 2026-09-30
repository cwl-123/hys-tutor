<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
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

// 切换节点时重置表单，且不触发 emit
const syncing = ref(false)
watch(
  () => props.node.id,
  async () => {
    syncing.value = true
    name.value = props.node.name
    description.value = props.node.description
    deps.value = [...props.node.deps]
    confirmRemove.value = false
    await nextTick()
    syncing.value = false
  },
)

// 面板改动实时写回画布工作副本（落盘仍由工具栏「保存修改」负责）
function emitPatch() {
  if (syncing.value) return
  emit('save', {
    name: name.value,
    description: description.value,
    deps: [...deps.value],
    manualEdited: true,
  })
}
watch([name, description], emitPatch)

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
  return props.allNodes.filter(
    (n) =>
      n.id !== props.node.id &&
      !deps.value.includes(n.id) &&
      !descendants.value.has(n.id) &&
      (!kw || n.name.toLowerCase().includes(kw) || n.description.toLowerCase().includes(kw)),
  )
})

function removeDep(id: string) {
  deps.value = deps.value.filter((d) => d !== id)
  emitPatch()
}

function addDep(id: string) {
  if (!deps.value.includes(id)) deps.value = [...deps.value, id]
  depSearch.value = ''
  depDropdown.value = false
  emitPatch()
}

// 删除：次要操作 + 二次确认
const confirmRemove = ref(false)
const dependents = computed(() => props.allNodes.filter((n) => n.deps.includes(props.node.id)))

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}
</script>

<template>
  <aside class="panel">
    <header class="panel__header">
      <div>
        <div class="panel__title">
          知识点
        </div>
        <div class="panel__subtitle">
          {{ node.name }}
        </div>
      </div>
      <button
        class="panel__close"
        title="关闭"
        @click="emit('close')"
      >
        ×
      </button>
    </header>

    <section class="panel__section">
      <label class="field">
        <span class="field__label">名称</span>
        <input
          v-model="name"
          type="text"
        >
      </label>
      <label class="field">
        <span class="field__label">描述</span>
        <textarea
          v-model="description"
          rows="3"
        />
      </label>
    </section>

    <section class="panel__section">
      <span class="field__label">前置依赖</span>
      <div class="deps">
        <span
          v-for="d in selectedDeps"
          :key="d.id"
          class="dep-chip"
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
          class="panel__muted"
        >
          无前置依赖（入门节点）
        </span>
      </div>
      <div class="dep-add">
        <input
          v-model="depSearch"
          type="text"
          placeholder="+ 搜索并添加依赖"
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
            class="panel__muted dep-add__none"
          >
            无匹配（下游节点不可作前置，避免成环）
          </p>
        </div>
      </div>
    </section>

    <section class="panel__section">
      <div class="mastery-row">
        <span class="field__label">掌握分</span>
        <span class="mastery-row__value">{{ node.mastery }}</span>
      </div>
      <p class="panel__muted">
        由练习批改自动更新，不可手动修改
      </p>
    </section>

    <section class="panel__section">
      <span class="field__label">历史课程（{{ lessons.length }}）</span>
      <div class="lessons">
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
          class="panel__muted"
        >
          还没有该知识点的课程
        </p>
      </div>
    </section>

    <footer class="panel__footer">
      <button
        v-if="!confirmRemove"
        class="panel__danger-link"
        @click="confirmRemove = true"
      >
        删除该知识点…
      </button>
      <div
        v-else
        class="remove-confirm"
      >
        <p>
          确认删除「{{ node.name }}」？
          <template v-if="dependents.length">
            {{ dependents.length }} 个下游节点对它的依赖将一并移除。
          </template>
          <template v-if="lessons.length">
            该节点已有 {{ lessons.length }} 节历史课程。
          </template>
        </p>
        <div class="remove-confirm__actions">
          <button
            class="btn"
            @click="confirmRemove = false"
          >
            取消
          </button>
          <button
            class="btn btn--danger"
            @click="emit('remove', node.id)"
          >
            确认删除
          </button>
        </div>
      </div>
      <p class="panel__muted panel__save-hint">
        修改已实时反映到画布，点工具栏「保存修改」落盘
      </p>
    </footer>
  </aside>
</template>

<style scoped>
.panel {
  width: 320px;
  border-left: 1px solid var(--border);
  background: #fff;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
}
.panel__header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  padding: 18px 20px 14px;
  border-bottom: 1px solid var(--border);
}
.panel__title {
  font-size: 12px;
  color: var(--text-dim);
  letter-spacing: 0.5px;
}
.panel__subtitle {
  margin-top: 2px;
  font-size: 16px;
  font-weight: 600;
}
.panel__close {
  border: none;
  background: none;
  font-size: 20px;
  line-height: 1;
  cursor: pointer;
  color: var(--text-dim);
}
.panel__close:hover {
  color: var(--text);
}
.panel__section {
  padding: 16px 20px;
  border-bottom: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.field__label {
  font-size: 12px;
  color: var(--text-dim);
}
.field input,
.field textarea {
  font: inherit;
  font-size: 13px;
  color: var(--text);
  padding: 7px 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  resize: vertical;
}
.field input:focus,
.field textarea:focus {
  outline: none;
  border-color: #3b82f6;
}
.deps {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.dep-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  padding: 3px 10px;
  border-radius: 999px;
  border: 1px solid #bfdbfe;
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
  padding: 7px 10px;
  border: 1px dashed var(--border);
  border-radius: 8px;
  color: var(--text);
}
.dep-add input:focus {
  outline: none;
  border-color: #3b82f6;
  border-style: solid;
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
.mastery-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
}
.mastery-row__value {
  font-size: 20px;
  font-weight: 700;
}
.lessons {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.lesson-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 7px 10px;
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
.panel__muted {
  margin: 0;
  font-size: 12px;
  color: var(--text-dim);
}
.panel__footer {
  margin-top: auto;
  padding: 14px 20px 18px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.panel__danger-link {
  align-self: flex-start;
  border: none;
  background: none;
  font: inherit;
  font-size: 12px;
  color: var(--text-dim);
  text-decoration: underline dotted;
  cursor: pointer;
  padding: 0;
}
.panel__danger-link:hover {
  color: var(--mastery-red);
}
.remove-confirm {
  background: #fef2f2;
  border: 1px solid #fecaca;
  border-radius: 8px;
  padding: 10px 12px;
  font-size: 12px;
  color: #991b1b;
}
.remove-confirm p {
  margin: 0 0 8px;
  line-height: 1.6;
}
.remove-confirm__actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
.panel__save-hint {
  line-height: 1.6;
}
.btn {
  font: inherit;
  font-size: 12px;
  padding: 5px 12px;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: #fff;
  cursor: pointer;
}
.btn--danger {
  border-color: var(--mastery-red);
  color: #fff;
  background: var(--mastery-red);
}
</style>
