<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { Check, Pencil, Plus, Trash2, X } from 'lucide-vue-next'
import {
  createPreference,
  deletePreference,
  listPreferences,
  updatePreference,
} from '@/utils/preferences'
import { showToast } from '@/utils/toast'
import type { Preference } from '@shared/types'

const prefs = ref<Preference[]>([])
const loading = ref(true)
const newText = ref('')
const adding = ref(false)
const editingId = ref<string | null>(null)
const editingText = ref('')
const error = ref<string | null>(null)

onMounted(async () => {
  try {
    prefs.value = await listPreferences()
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    loading.value = false
  }
})

async function add() {
  const text = newText.value.trim()
  if (!text || adding.value) return
  adding.value = true
  error.value = null
  try {
    prefs.value = [...prefs.value, await createPreference(text)]
    newText.value = ''
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    adding.value = false
  }
}

function startEdit(p: Preference) {
  editingId.value = p.id
  editingText.value = p.text
}

async function saveEdit() {
  const id = editingId.value
  const text = editingText.value.trim()
  if (!id || !text) return
  try {
    const updated = await updatePreference(id, text)
    prefs.value = prefs.value.map((p) => (p.id === id ? updated : p))
    editingId.value = null
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  }
}

async function remove(p: Preference) {
  try {
    await deletePreference(p.id)
    prefs.value = prefs.value.filter((x) => x.id !== p.id)
    showToast('已删除该偏好')
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  }
}

function sourceLabel(p: Preference): string {
  if (p.source.kind === 'manual') return '手动添加'
  return p.source.label ? `来自：${p.source.label}` : 'AI 提取'
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' })
}
</script>

<template>
  <div class="prefs">
    <header class="prefs__head">
      <h1>我的偏好</h1>
      <p class="prefs__sub">
        这里记的每一句话，都会注入后续所有备课。平时跟 AI 的交互中流露的讲法偏好也会自动记到这里。
      </p>
    </header>

    <form
      class="prefs__add"
      @submit.prevent="add"
    >
      <input
        v-model="newText"
        type="text"
        maxlength="200"
        placeholder="写一条偏好，如：讲新概念先举生活例子、再上公式"
        :disabled="adding"
      >
      <button
        type="submit"
        :disabled="adding || !newText.trim()"
      >
        <Plus :size="15" />
        添加
      </button>
    </form>
    <p
      v-if="error"
      class="prefs__error"
    >
      {{ error }}
    </p>

    <div
      v-if="loading"
      class="prefs__empty"
    >
      加载中…
    </div>
    <div
      v-else-if="!prefs.length"
      class="prefs__empty"
    >
      还没有偏好。直接在上面写一条，或在课件对话里告诉 AI 你的讲法偏好，它会自动记到这里。
    </div>

    <ul class="prefs__list">
      <li
        v-for="p in prefs"
        :key="p.id"
        class="pref"
      >
        <template v-if="editingId === p.id">
          <input
            v-model="editingText"
            class="pref__edit"
            type="text"
            maxlength="200"
            @keydown.enter.prevent="saveEdit"
            @keydown.esc="editingId = null"
          >
          <button
            class="pref__btn"
            title="保存"
            @click="saveEdit"
          >
            <Check :size="14" />
          </button>
          <button
            class="pref__btn"
            title="取消"
            @click="editingId = null"
          >
            <X :size="14" />
          </button>
        </template>
        <template v-else>
          <div class="pref__body">
            <p class="pref__text">
              {{ p.text }}
            </p>
            <p class="pref__meta">
              {{ sourceLabel(p) }} · {{ fmtDate(p.createdAt) }}
            </p>
          </div>
          <button
            class="pref__btn"
            title="编辑"
            @click="startEdit(p)"
          >
            <Pencil :size="14" />
          </button>
          <button
            class="pref__btn pref__btn--danger"
            title="删除"
            @click="remove(p)"
          >
            <Trash2 :size="14" />
          </button>
        </template>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.prefs {
  max-width: 720px;
  margin: 0 auto;
  padding: 48px 24px 80px;
}
.prefs__head h1 {
  margin: 0;
  font-size: 24px;
  font-weight: 700;
}
.prefs__sub {
  margin: 10px 0 0;
  font-size: 13px;
  line-height: 1.8;
  color: var(--text-dim);
}
.prefs__add {
  margin-top: 24px;
  display: flex;
  gap: 10px;
}
.prefs__add input {
  flex: 1;
  font: inherit;
  font-size: 14px;
  padding: 10px 14px;
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  transition:
    border-color var(--dur-fast) var(--ease),
    box-shadow var(--dur-fast) var(--ease);
}
.prefs__add input:focus {
  outline: none;
  border-color: var(--primary);
  box-shadow: var(--ring-primary);
}
.prefs__add button {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font: inherit;
  font-size: 14px;
  font-weight: 600;
  padding: 0 18px;
  border: none;
  border-radius: var(--r-md);
  background: var(--text);
  color: #fff;
  cursor: pointer;
}
.prefs__add button:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.prefs__error {
  margin: 10px 0 0;
  font-size: 13px;
  color: var(--mastery-red);
}
.prefs__empty {
  margin-top: 32px;
  padding: 36px;
  text-align: center;
  font-size: 13px;
  line-height: 1.8;
  color: var(--text-dim);
  border: 1px dashed var(--border);
  border-radius: var(--r-lg);
}
.prefs__list {
  margin: 20px 0 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.pref {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 14px 16px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  box-shadow: var(--shadow-sm);
}
.pref__body {
  flex: 1;
  min-width: 0;
}
.pref__text {
  margin: 0;
  font-size: 14px;
  line-height: 1.6;
}
.pref__meta {
  margin: 4px 0 0;
  font-size: 12px;
  color: var(--text-dim);
}
.pref__edit {
  flex: 1;
  font: inherit;
  font-size: 14px;
  padding: 7px 12px;
  border: 1px solid var(--primary);
  border-radius: var(--r-sm);
}
.pref__edit:focus {
  outline: none;
  box-shadow: var(--ring-primary);
}
.pref__btn {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border: 1px solid transparent;
  border-radius: var(--r-sm);
  background: none;
  color: var(--text-dim);
  cursor: pointer;
  transition: all var(--dur-fast) var(--ease);
}
.pref__btn:hover {
  color: var(--text);
  border-color: var(--border);
  background: var(--bg-muted);
}
.pref__btn--danger:hover {
  color: var(--mastery-red);
}
</style>
