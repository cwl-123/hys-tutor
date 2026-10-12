<script setup lang="ts">
import { ref } from 'vue'
import { X } from 'lucide-vue-next'
import { useTopicStore } from '@/stores/topic'

const STYLES = ['通俗直观', '严谨推导', '实战代码', '案例驱动']
const LEVELS = ['完全新手', '有一定基础', '比较熟悉想精进']

const emit = defineEmits<{
  close: []
  saved: []
}>()

const store = useTopicStore()

const style = ref<string | null>(store.topic?.profile?.style ?? null)
const level = ref<string | null>(store.topic?.profile?.level ?? null)
const extra = ref(store.topic?.profile?.extra ?? '')
const saving = ref(false)
const error = ref<string | null>(null)

function pick(current: string | null, value: string): string | null {
  return current === value ? null : value
}

async function save() {
  if (saving.value) return
  saving.value = true
  error.value = null
  try {
    await store.updateProfile({
      style: style.value ?? undefined,
      level: level.value ?? undefined,
      extra: extra.value.trim() || undefined,
    })
    emit('saved')
    emit('close')
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <aside class="settings">
    <header class="settings__header">
      <span>学习设置</span>
      <button
        class="settings__close"
        title="关闭"
        @click="emit('close')"
      >
        <X :size="15" />
      </button>
    </header>

    <div class="settings__body">
      <div class="field">
        <span class="field__label">讲解风格</span>
        <div class="chips">
          <button
            v-for="s in STYLES"
            :key="s"
            type="button"
            class="chip"
            :class="{ 'chip--on': style === s }"
            :disabled="saving"
            @click="style = pick(style, s)"
          >
            {{ s }}
          </button>
        </div>
      </div>

      <div class="field">
        <span class="field__label">当前程度</span>
        <div class="chips">
          <button
            v-for="l in LEVELS"
            :key="l"
            type="button"
            class="chip"
            :class="{ 'chip--on': level === l }"
            :disabled="saving"
            @click="level = pick(level, l)"
          >
            {{ l }}
          </button>
        </div>
      </div>

      <div class="field">
        <span class="field__label">其他要求</span>
        <textarea
          v-model="extra"
          class="field__extra"
          rows="3"
          placeholder="如「多结合广告业务案例」「少讲数学多讲工程实现」…"
          :disabled="saving"
        />
      </div>

      <p class="settings__hint">
        这些偏好会注入之后每节课的备课与出题；已生成的课件不受影响。全部留空则清除个性化设置。
      </p>

      <p
        v-if="error"
        class="settings__error"
      >
        {{ error }}
      </p>
    </div>

    <div class="settings__footer">
      <button
        class="btn"
        type="button"
        :disabled="saving"
        @click="emit('close')"
      >
        取消
      </button>
      <button
        class="btn btn--primary"
        type="button"
        :disabled="saving"
        @click="save"
      >
        {{ saving ? '保存中…' : '保存' }}
      </button>
    </div>
  </aside>
</template>

<style scoped>
.settings {
  width: 340px;
  border-left: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: var(--bg);
}
.settings__header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 14px;
  font-weight: 600;
  font-size: 14px;
  border-bottom: 1px solid var(--border);
}
.settings__close {
  display: inline-flex;
  align-items: center;
  border: none;
  background: none;
  cursor: pointer;
  color: var(--text-dim);
  padding: 4px;
  border-radius: var(--r-sm);
  transition:
    color var(--dur-fast) var(--ease),
    background var(--dur-fast) var(--ease);
}
.settings__close:hover {
  color: var(--text);
  background: var(--bg-muted);
}
.settings__body {
  flex: 1;
  overflow-y: auto;
  padding: 16px 14px;
  display: flex;
  flex-direction: column;
  gap: 18px;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.field__label {
  font-size: 13px;
  color: var(--text-dim);
}
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.chip {
  font: inherit;
  font-size: 13px;
  padding: 5px 14px;
  border-radius: var(--r-pill);
  border: 1px solid var(--border);
  background: var(--bg);
  color: var(--text);
  cursor: pointer;
  transition: all var(--dur-fast) var(--ease);
}
.chip:hover:not(:disabled) {
  border-color: var(--primary-soft);
  color: var(--primary-hover);
}
.chip--on,
.chip--on:hover:not(:disabled) {
  border-color: var(--primary);
  background: var(--primary-bg);
  color: var(--primary-hover);
  font-weight: 500;
  box-shadow: 0 0 0 3px rgb(var(--primary-rgb) / 8%);
}
.chip:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.field__extra {
  width: 100%;
  font: inherit;
  font-size: 13px;
  line-height: 1.6;
  padding: 9px 12px;
  border: 1px dashed var(--border);
  border-radius: var(--r-md);
  color: var(--text);
  resize: vertical;
}
.field__extra:focus {
  outline: none;
  border-color: var(--primary);
  border-style: solid;
  box-shadow: var(--ring-primary);
}
.settings__hint {
  margin: 0;
  font-size: 12px;
  line-height: 1.7;
  color: var(--text-dim);
}
.settings__error {
  margin: 0;
  font-size: 12px;
  color: var(--mastery-red);
}
.settings__footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 14px;
  border-top: 1px solid var(--border);
  background: var(--bg);
}
</style>