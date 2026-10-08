<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { parseSections } from '@shared/lesson-md'
import type { LessonQuote } from '@shared/lesson-chat'
import MarkdownRenderer from '@/components/MarkdownRenderer.vue'

export interface InsertImagePayload {
  file: File
  heading: string | null
}

const props = defineProps<{ content: string }>()
const emit = defineEmits<{
  quote: [payload: LessonQuote]
  'edit-mermaid': [code: string]
  'insert-image': [payload: InsertImagePayload]
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

// ---------- 插图：粘贴 / 拖拽 / 章节「插图」按钮 ----------

function headingOf(node: Node | null): string | null {
  const el = node instanceof Element ? node : node?.parentElement
  const sectionEl = el?.closest('[data-heading]') as HTMLElement | null
  return sectionEl?.dataset.heading || null
}

function imageFilesOf(list: FileList | null | undefined): File[] {
  return [...(list ?? [])].filter((f) => f.type.startsWith('image/'))
}

function emitInsert(files: File[], heading: string | null) {
  for (const file of files) emit('insert-image', { file, heading })
}

function onPaste(e: ClipboardEvent) {
  // 焦点在输入框（对话面板/编辑器等）时不劫持粘贴
  const t = e.target as HTMLElement | null
  if (t && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT' || t.isContentEditable)) return
  const files = imageFilesOf(e.clipboardData?.files)
  if (!files.length) return
  e.preventDefault()
  const sel = window.getSelection()
  const node = sel && sel.rangeCount > 0 ? sel.getRangeAt(0).startContainer : null
  emitInsert(files, headingOf(node))
}

function onDrop(e: DragEvent) {
  const files = imageFilesOf(e.dataTransfer?.files)
  if (!files.length) return
  e.preventDefault()
  emitInsert(files, headingOf(e.target instanceof Node ? e.target : null))
}

function onDragOver(e: DragEvent) {
  if (imageFilesOf(e.dataTransfer?.files).length || [...(e.dataTransfer?.types ?? [])].includes('Files')) {
    e.preventDefault()
  }
}

// 章节「插图」按钮：记录目标章节后弹文件选择
const fileInput = ref<HTMLInputElement | null>(null)
const pendingHeading = ref<string | null>(null)

function pickImage(heading: string | null) {
  pendingHeading.value = heading
  fileInput.value?.click()
}

function onFileChange() {
  const files = imageFilesOf(fileInput.value?.files)
  if (files.length) emitInsert(files, pendingHeading.value)
  if (fileInput.value) fileInput.value.value = ''
}

onMounted(() => {
  // 粘贴挂 window：截图后直接 Ctrl+V 即可插图（焦点不一定在正文上）
  window.addEventListener('paste', onPaste)
  window.addEventListener('scroll', clearTip, true)
})
onBeforeUnmount(() => {
  window.removeEventListener('paste', onPaste)
  window.removeEventListener('scroll', clearTip, true)
})
</script>

<template>
  <div
    ref="rootEl"
    class="lesson-body"
    @mouseup="onMouseUp"
    @drop="onDrop"
    @dragover="onDragOver"
  >
    <input
      ref="fileInput"
      type="file"
      accept="image/png,image/jpeg,image/gif,image/webp"
      multiple
      hidden
      @change="onFileChange"
    >
    <section
      v-for="(s, i) in sections"
      :key="i"
      :data-heading="s.heading ?? ''"
      class="lesson-body__section"
    >
      <div class="lesson-body__tools">
        <button
          class="lesson-body__tool"
          type="button"
          title="插一张图到本节末尾（也可直接粘贴/拖拽图片）"
          @click="pickImage(s.heading)"
        >
          插图
        </button>
        <button
          v-if="s.heading"
          class="lesson-body__tool"
          type="button"
          title="把这一节加入 AI 对话，让 AI 改这一节"
          @click="quoteSection(s.heading)"
        >
          改本节
        </button>
      </div>
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
.lesson-body__tools {
  position: absolute;
  top: 2px;
  right: 0;
  z-index: 2;
  display: flex;
  gap: 6px;
  opacity: 0;
  transition: opacity 0.15s;
}
.lesson-body__section:hover .lesson-body__tools {
  opacity: 1;
}
.lesson-body__tool {
  font: inherit;
  font-size: 12px;
  padding: 2px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: #fff;
  color: var(--text-dim);
  cursor: pointer;
}
.lesson-body__tool:hover {
  color: #2563eb;
  border-color: #93c5fd;
  background: #eff6ff;
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
  background: #1f2937;
  color: #fff;
  cursor: pointer;
  box-shadow: 0 2px 8px rgb(15 23 42 / 25%);
}
</style>