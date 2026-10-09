<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { parseSections } from '@shared/lesson-md'
import type { LessonQuote } from '@shared/lesson-chat'
import MarkdownRenderer from '@/components/MarkdownRenderer.vue'

const props = defineProps<{ content: string }>()
const emit = defineEmits<{
  quote: [payload: LessonQuote]
  'edit-mermaid': [code: string]
}>()

const sections = computed(() => parseSections(props.content))

const rootEl = ref<HTMLElement | null>(null)
const selectionTip = ref<{ x: number; y: number; heading?: string; text: string } | null>(null)

function clearTip() {
  selectionTip.value = null
}

function onMouseUp() {
  const sel = window.getSelection()
  const text = sel?.toString().trim() ?? ''
  const root = rootEl.value
  if (!text || text.length < 2 || !sel || sel.rangeCount === 0 || !root) {
    clearTip()
    return
  }
  const range = sel.getRangeAt(0)
  if (!root.contains(range.commonAncestorContainer)) {
    clearTip()
    return
  }
  const rect = range.getBoundingClientRect()
  const node =
    range.commonAncestorContainer.nodeType === 1
      ? (range.commonAncestorContainer as Element)
      : range.commonAncestorContainer.parentElement
  const sectionEl = node?.closest('[data-heading]') as HTMLElement | null
  selectionTip.value = {
    x: rect.left + rect.width / 2,
    y: rect.top,
    heading: sectionEl?.dataset.heading || undefined,
    text: text.slice(0, 1500),
  }
}

function quoteSelection() {
  if (!selectionTip.value) return
  const { heading, text } = selectionTip.value
  emit('quote', { heading, text })
  clearTip()
  window.getSelection()?.removeAllRanges()
}

function quoteSection(heading: string | null) {
  if (!heading) return
  emit('quote', { heading })
}

onMounted(() => window.addEventListener('scroll', clearTip, true))
onBeforeUnmount(() => window.removeEventListener('scroll', clearTip, true))
</script>

<template>
  <div
    ref="rootEl"
    class="lesson-body"
    @mouseup="onMouseUp"
  >
    <section
      v-for="(s, i) in sections"
      :key="i"
      :data-heading="s.heading ?? ''"
      class="lesson-body__section"
    >
      <button
        v-if="s.heading"
        class="lesson-body__tool"
        type="button"
        title="把这一节加入 AI 对话，让 AI 改这一节"
        @click="quoteSection(s.heading)"
      >
        改本节
      </button>
      <MarkdownRenderer
        :content="s.raw"
        editable
        @edit-mermaid="emit('edit-mermaid', $event)"
      />
    </section>

    <Teleport to="body">
      <button
        v-if="selectionTip"
        class="lesson-body__quote-btn"
        type="button"
        :style="{ left: `${selectionTip.x}px`, top: `${selectionTip.y}px` }"
        @mousedown.prevent="quoteSelection"
      >
        引用这段让 AI 优化
      </button>
    </Teleport>
  </div>
</template>

<style scoped>
.lesson-body {
  position: relative;
}
.lesson-body__section {
  position: relative;
}
.lesson-body__tool {
  position: absolute;
  top: 2px;
  right: 0;
  z-index: 2;
  font: inherit;
  font-size: 12px;
  padding: 2px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: #fff;
  color: var(--text-dim);
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.15s;
}
.lesson-body__section:hover .lesson-body__tool {
  opacity: 1;
}
.lesson-body__tool:hover {
  color: var(--primary-strong);
  border-color: var(--primary-soft);
  background: var(--primary-bg);
}
</style>

<style>
.lesson-body__quote-btn {
  position: fixed;
  transform: translate(-50%, calc(-100% - 8px));
  z-index: 300;
  font: inherit;
  font-size: 12px;
  padding: 5px 10px;
  border: none;
  border-radius: 8px;
  background: var(--text);
  color: #fff;
  cursor: pointer;
  box-shadow: 0 2px 8px rgb(var(--ink-rgb) / 25%);
}
</style>
