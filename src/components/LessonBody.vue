<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { Highlighter, Sparkles, Trash2 } from 'lucide-vue-next'
import { parseSections } from '@shared/lesson-md'
import type { LessonQuote } from '@shared/lesson-chat'
import type { Highlight } from '@shared/types'
import { computeOccurrence, type HighlightAnchor } from '@/utils/highlight-dom'
import MarkdownRenderer from '@/components/MarkdownRenderer.vue'

const props = defineProps<{
  content: string
  citeSources?: { idx: number; title: string; url?: string }[]
  highlights?: Highlight[]
}>()
const emit = defineEmits<{
  quote: [payload: LessonQuote]
  'edit-mermaid': [code: string]
  'add-highlight': [payload: { heading: string | null; text: string; occurrence: number }]
  'remove-highlight': [id: string]
}>()

const sections = computed(() => parseSections(props.content))

// 每节只取属于该节的划线锚点，交给对应的 MarkdownRenderer 着色
function anchorsFor(heading: string | null): HighlightAnchor[] {
  return (props.highlights ?? [])
    .filter((h) => (h.heading ?? null) === (heading ?? null))
    .map((h) => ({ id: h.id, text: h.text, occurrence: h.occurrence }))
}

const rootEl = ref<HTMLElement | null>(null)
const selectionTip = ref<{
  x: number
  y: number
  heading: string | null
  text: string
  occurrence: number
} | null>(null)
const hlMenu = ref<{ x: number; y: number; id: string } | null>(null)

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
  // occurrence 以该节正文容器（.md-body）内的纯文本为准，创建与着色两侧一致
  const snippet = text.slice(0, 2000)
  const mdRoot = sectionEl?.querySelector<HTMLElement>('.md-body')
  const occurrence = mdRoot
    ? computeOccurrence(mdRoot, range.startContainer, range.startOffset, snippet)
    : 0
  selectionTip.value = {
    x: rect.left + rect.width / 2,
    y: rect.top,
    heading: sectionEl?.dataset.heading || null,
    text: snippet,
    occurrence,
  }
}

function highlightSelection() {
  if (!selectionTip.value) return
  const { heading, text, occurrence } = selectionTip.value
  emit('add-highlight', { heading, text, occurrence })
  clearTip()
  window.getSelection()?.removeAllRanges()
}

function quoteSelection() {
  if (!selectionTip.value) return
  const { heading, text } = selectionTip.value
  emit('quote', { heading: heading ?? undefined, text })
  clearTip()
  window.getSelection()?.removeAllRanges()
}

function quoteSection(heading: string | null) {
  if (!heading) return
  emit('quote', { heading })
}

// 点击已有划线：弹出删除入口；点空白/滚动关闭
function onRootClick(e: MouseEvent) {
  const el = (e.target as Element).closest('mark.lesson-hl') as HTMLElement | null
  if (el?.dataset.hlId) {
    const rect = el.getBoundingClientRect()
    hlMenu.value = { x: rect.left + rect.width / 2, y: rect.bottom, id: el.dataset.hlId }
  } else {
    hlMenu.value = null
  }
}

function removeHighlight() {
  if (!hlMenu.value) return
  emit('remove-highlight', hlMenu.value.id)
  hlMenu.value = null
}

function onScroll() {
  clearTip()
  hlMenu.value = null
}

onMounted(() => window.addEventListener('scroll', onScroll, true))
onBeforeUnmount(() => window.removeEventListener('scroll', onScroll, true))
</script>

<template>
  <div
    ref="rootEl"
    class="lesson-body"
    @mouseup="onMouseUp"
    @click="onRootClick"
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
        :cite-sources="citeSources"
        :highlights="anchorsFor(s.heading)"
        editable
        @edit-mermaid="emit('edit-mermaid', $event)"
      />
    </section>

    <Teleport to="body">
      <div
        v-if="selectionTip"
        class="lesson-body__sel-tools"
        :style="{ left: `${selectionTip.x}px`, top: `${selectionTip.y}px` }"
      >
        <button
          type="button"
          class="lesson-body__sel-btn"
          title="把选中的内容标为绿色重点"
          @mousedown.prevent="highlightSelection"
        >
          <Highlighter :size="12" />
          划线
        </button>
        <span class="lesson-body__sel-sep" />
        <button
          type="button"
          class="lesson-body__sel-btn"
          title="引用这段让 AI 优化"
          @mousedown.prevent="quoteSelection"
        >
          <Sparkles :size="12" />
          引用优化
        </button>
      </div>
    </Teleport>

    <Teleport to="body">
      <div
        v-if="hlMenu"
        class="lesson-body__hl-menu"
        :style="{ left: `${hlMenu.x}px`, top: `${hlMenu.y}px` }"
      >
        <button
          type="button"
          @mousedown.prevent="removeHighlight"
        >
          <Trash2 :size="12" />
          删除这条划线
        </button>
      </div>
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
  border-radius: var(--r-sm);
  background: var(--bg);
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
.lesson-body__sel-tools {
  position: fixed;
  transform: translate(-50%, calc(-100% - 8px));
  z-index: var(--z-modal);
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 3px;
  border-radius: var(--r-pill);
  background: var(--text);
  box-shadow: var(--shadow-lg);
}
.lesson-body__sel-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font: inherit;
  font-size: 12px;
  padding: 5px 11px;
  border: none;
  border-radius: var(--r-pill);
  background: none;
  color: var(--bg);
  cursor: pointer;
}
.lesson-body__sel-btn:hover {
  background: rgba(255, 255, 255, 0.16);
}
.lesson-body__sel-sep {
  width: 1px;
  align-self: stretch;
  margin: 4px 2px;
  background: rgba(255, 255, 255, 0.22);
}
.lesson-body__hl-menu {
  position: fixed;
  transform: translate(-50%, 10px);
  z-index: var(--z-modal);
  padding: 4px;
  border-radius: var(--r-md);
  background: var(--bg);
  border: 1px solid var(--border);
  box-shadow: var(--shadow-lg);
}
.lesson-body__hl-menu button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font: inherit;
  font-size: 12.5px;
  padding: 6px 10px;
  border: none;
  border-radius: var(--r-sm);
  background: none;
  color: var(--mastery-red);
  cursor: pointer;
}
.lesson-body__hl-menu button:hover {
  background: var(--bg-muted);
}
</style>