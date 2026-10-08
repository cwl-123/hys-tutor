<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { findSectionByHeading } from '@shared/lesson-md'
import type { LessonChatMessage, LessonQuote, LessonVersion } from '@shared/lesson-chat'
import MarkdownRenderer from '@/components/MarkdownRenderer.vue'

const props = defineProps<{
  lessonId: string
  quoteRequest: (LessonQuote & { nonce: number }) | null
}>()

const emit = defineEmits<{ updated: []; close: [] }>()

const messages = ref<LessonChatMessage[]>([])
const versions = ref<LessonVersion[]>([])
const input = ref('')
const pendingQuote = ref<LessonQuote | null>(null)
const loading = ref(false)
const applyingId = ref<string | null>(null)
const error = ref<string | null>(null)
const previewMsgId = ref<string | null>(null)
const listEl = ref<HTMLElement | null>(null)
const inputEl = ref<HTMLTextAreaElement | null>(null)

const suggestions = [
  '第二段太抽象，讲通俗点',
  '这个公式推导跳步太多，补全',
  '我基础差，整篇用大白话重写',
  '例子换成广告出价场景',
]

function useSuggestion(s: string) {
  input.value = s
  inputEl.value?.focus()
}

async function scrollToBottom() {
  await nextTick()
  listEl.value?.scrollTo({ top: listEl.value.scrollHeight })
}

watch(
  () => [messages.value.length, loading.value],
  scrollToBottom,
)

async function load() {
  error.value = null
  const res = await fetch(`/api/lessons/${props.lessonId}/chat`)
  const data = (await res.json()) as {
    messages?: LessonChatMessage[]
    versions?: LessonVersion[]
    error?: string
  }
  if (!res.ok) {
    error.value = data.error ?? `加载对话失败：${res.status}`
    return
  }
  messages.value = data.messages ?? []
  versions.value = data.versions ?? []
  await scrollToBottom()
}

watch(
  () => props.lessonId,
  () => void load(),
  { immediate: true },
)

watch(
  () => props.quoteRequest?.nonce,
  () => {
    if (props.quoteRequest) {
      pendingQuote.value = { heading: props.quoteRequest.heading, text: props.quoteRequest.text }
      inputEl.value?.focus()
    }
  },
)

const canUndo = computed(() => versions.value.length > 0)
const previewMsg = computed(() => messages.value.find((m) => m.id === previewMsgId.value) ?? null)

// 预览弹层：Esc 关闭
function onEsc(e: KeyboardEvent) {
  if (e.key === 'Escape') previewMsgId.value = null
}
watch(previewMsgId, (id) => {
  if (id) window.addEventListener('keydown', onEsc)
  else window.removeEventListener('keydown', onEsc)
})
onBeforeUnmount(() => window.removeEventListener('keydown', onEsc))

async function send() {
  const message = input.value.trim()
  if (!message || loading.value) return
  error.value = null
  loading.value = true
  try {
    const res = await fetch(`/api/lessons/${props.lessonId}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, quote: pendingQuote.value ?? undefined }),
    })
    const data = (await res.json()) as {
      messages?: LessonChatMessage[]
      versions?: LessonVersion[]
      error?: string
    }
    if (!res.ok) throw new Error(data.error ?? `请求失败：${res.status}`)
    messages.value = data.messages ?? messages.value
    versions.value = data.versions ?? versions.value
    input.value = ''
    pendingQuote.value = null
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    loading.value = false
  }
}

async function applyProposal(msg: LessonChatMessage) {
  if (!msg.proposal || msg.applied) return
  applyingId.value = msg.id
  error.value = null
  try {
    const res = await fetch(`/api/lessons/${props.lessonId}/chat/apply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messageId: msg.id }),
    })
    const data = (await res.json()) as {
      messages?: LessonChatMessage[]
      versions?: LessonVersion[]
      error?: string
    }
    if (!res.ok) throw new Error(data.error ?? `应用失败：${res.status}`)
    messages.value = data.messages ?? messages.value
    versions.value = data.versions ?? versions.value
    previewMsgId.value = null
    emit('updated')
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    applyingId.value = null
  }
}

async function undo() {
  if (!canUndo.value) return
  error.value = null
  try {
    const res = await fetch(`/api/lessons/${props.lessonId}/chat/undo`, { method: 'POST' })
    const data = (await res.json()) as {
      messages?: LessonChatMessage[]
      versions?: LessonVersion[]
      error?: string
    }
    if (!res.ok) throw new Error(data.error ?? `撤销失败：${res.status}`)
    messages.value = data.messages ?? messages.value
    versions.value = data.versions ?? versions.value
    emit('updated')
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  }
}

// 预览：局部改只看目标章节；整篇重写看全文
function previewContent(msg: LessonChatMessage): string {
  const p = msg.proposal
  if (!p) return ''
  if (p.scope === 'section' && p.targetHeading) {
    const section = findSectionByHeading(p.contentMd, p.targetHeading)
    if (section) return section.raw
  }
  return p.contentMd
}

function quoteLabel(q?: LessonQuote | null): string {
  if (!q) return ''
  if (q.heading && q.text) return `章节「${q.heading}」+ 选中段落`
  if (q.heading) return `章节「${q.heading}」`
  return `选中段落：${(q.text ?? '').slice(0, 40)}…`
}
</script>

<template>
  <aside class="chat">
    <header class="chat__header">
      <div class="chat__title">
        <span class="chat__title-main">AI 对话优化</span>
        <span class="chat__title-sub">说说哪里不满意，AI 给修改建议，确认后才写入</span>
      </div>
      <div class="chat__header-actions">
        <button
          class="chat__ghost"
          type="button"
          :disabled="!canUndo"
          title="撤销最近一次已应用的修改"
          @click="undo"
        >
          ↩ 撤销
        </button>
        <button
          class="chat__close"
          type="button"
          title="收起面板"
          @click="emit('close')"
        >
          ×
        </button>
      </div>
    </header>

    <div
      ref="listEl"
      class="chat__list"
    >
      <div
        v-if="messages.length === 0"
        class="chat__empty"
      >
        <div class="chat__empty-title">
          从哪里改起？
        </div>
        <p class="chat__empty-desc">
          直接描述想怎么改；想只改一处，把鼠标移到某个小节点<b>「改本节」</b>，或选中一段话点<b>「引用这段让 AI 优化」</b>。
        </p>
        <div class="chat__chips">
          <button
            v-for="s in suggestions"
            :key="s"
            class="chat__chip"
            type="button"
            @click="useSuggestion(s)"
          >
            {{ s }}
          </button>
        </div>
      </div>

      <div
        v-for="m in messages"
        :key="m.id"
        class="msg"
        :class="`msg--${m.role}`"
      >
        <div
          v-if="m.quote"
          class="msg__quote"
        >
          {{ quoteLabel(m.quote) }}
        </div>
        <div class="msg__content">
          {{ m.content }}
        </div>

        <div
          v-if="m.proposal"
          class="msg__proposal"
        >
          <div class="msg__proposal-head">
            <span class="msg__scope">{{ m.proposal.scope === 'section' ? `改本节 · ${m.proposal.targetHeading ?? ''}` : '整篇重写' }}</span>
            <span class="msg__summary">{{ m.proposal.summary }}</span>
          </div>
          <div class="msg__actions">
            <button
              class="chat__ghost"
              type="button"
              @click="previewMsgId = m.id"
            >
              🔍 放大预览
            </button>
            <button
              class="chat__apply"
              type="button"
              :disabled="m.applied || applyingId === m.id"
              @click="applyProposal(m)"
            >
              {{ m.applied ? '✓ 已应用' : applyingId === m.id ? '应用中…' : '应用修改' }}
            </button>
          </div>
        </div>
      </div>

      <div
        v-if="loading"
        class="msg msg--assistant msg--typing"
      >
        <span class="msg__dot" /><span class="msg__dot" /><span class="msg__dot" />
      </div>
    </div>

    <div class="chat__composer">
      <p
        v-if="error"
        class="chat__error"
      >
        {{ error }}
      </p>
      <div
        v-if="pendingQuote"
        class="chat__quote"
      >
        <span class="chat__quote-label">{{ quoteLabel(pendingQuote) }}</span>
        <button
          class="chat__quote-remove"
          type="button"
          title="取消引用"
          @click="pendingQuote = null"
        >
          ×
        </button>
      </div>
      <form
        class="chat__inputbox"
        @submit.prevent="send"
      >
        <textarea
          ref="inputEl"
          v-model="input"
          rows="2"
          placeholder="描述你想怎么改这节课…"
          :disabled="loading"
          @keydown.enter.exact.prevent="send"
        />
        <button
          class="chat__send"
          type="submit"
          :disabled="loading || !input.trim()"
        >
          发送
        </button>
      </form>
      <p class="chat__hint">
        Enter 发送 · Shift+Enter 换行
      </p>
    </div>
  </aside>

  <!-- 放大预览：大尺寸阅读改动 -->
  <Teleport to="body">
    <div
      v-if="previewMsg?.proposal"
      class="preview-mask"
      @click.self="previewMsgId = null"
    >
      <div class="preview-modal">
        <header class="preview-modal__head">
          <div class="preview-modal__title">
            <span class="msg__scope">{{ previewMsg.proposal.scope === 'section' ? `改本节 · ${previewMsg.proposal.targetHeading ?? ''}` : '整篇重写' }}</span>
            <span class="preview-modal__summary">{{ previewMsg.proposal.summary }}</span>
          </div>
          <button
            class="preview-modal__close"
            type="button"
            title="关闭（Esc）"
            @click="previewMsgId = null"
          >
            ×
          </button>
        </header>
        <div class="preview-modal__body">
          <MarkdownRenderer :content="previewContent(previewMsg)" />
        </div>
        <footer class="preview-modal__foot">
          <span class="preview-modal__hint">
            {{ previewMsg.proposal.scope === 'section' ? '仅替换该章节，其余章节保持不变' : '将整篇替换为以上内容' }}
          </span>
          <div class="preview-modal__actions">
            <button
              class="chat__ghost"
              type="button"
              @click="previewMsgId = null"
            >
              关闭
            </button>
            <button
              class="chat__apply"
              type="button"
              :disabled="previewMsg.applied || applyingId === previewMsg.id"
              @click="applyProposal(previewMsg)"
            >
              {{ previewMsg.applied ? '✓ 已应用' : applyingId === previewMsg.id ? '应用中…' : '应用修改' }}
            </button>
          </div>
        </footer>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.chat {
  position: fixed;
  top: 0;
  right: 0;
  z-index: 150;
  width: 400px;
  height: 100vh;
  display: flex;
  flex-direction: column;
  background: #fff;
  border-left: 1px solid var(--border);
  box-shadow: -8px 0 24px rgb(15 23 42 / 8%);
}

/* ---- 头部 ---- */
.chat__header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 10px;
  padding: 14px 16px 12px;
  border-bottom: 1px solid var(--border);
}
.chat__title {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.chat__title-main {
  font-weight: 600;
  font-size: 15px;
}
.chat__title-sub {
  font-size: 11px;
  color: var(--text-dim);
}
.chat__header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}
.chat__ghost {
  border: 1px solid var(--border);
  background: #fff;
  color: var(--text-dim);
  font: inherit;
  font-size: 12px;
  padding: 4px 10px;
  border-radius: 7px;
  cursor: pointer;
}
.chat__ghost:hover:not(:disabled) {
  color: #2563eb;
  border-color: #93c5fd;
  background: #eff6ff;
}
.chat__ghost:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.chat__close {
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 7px;
  background: none;
  font-size: 18px;
  line-height: 1;
  cursor: pointer;
  color: var(--text-dim);
}
.chat__close:hover {
  background: #f1f5f9;
  color: var(--text);
}

/* ---- 消息区 ---- */
.chat__list {
  flex: 1;
  overflow-y: auto;
  padding: 16px 14px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  background: #f7f8fa;
}
.chat__empty {
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 16px;
  margin-top: 8px;
}
.chat__empty-title {
  font-size: 14px;
  font-weight: 600;
  margin-bottom: 6px;
}
.chat__empty-desc {
  margin: 0 0 12px;
  font-size: 12px;
  color: var(--text-dim);
  line-height: 1.8;
}
.chat__empty-desc b {
  color: var(--text);
  font-weight: 500;
}
.chat__chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.chat__chip {
  font: inherit;
  font-size: 12px;
  padding: 5px 12px;
  border: 1px solid #bfdbfe;
  border-radius: 999px;
  background: #eff6ff;
  color: #1d4ed8;
  cursor: pointer;
}
.chat__chip:hover {
  background: #dbeafe;
}

.msg {
  max-width: 100%;
  font-size: 13px;
  line-height: 1.7;
}
.msg--user {
  align-self: flex-end;
  max-width: 88%;
  background: #3b82f6;
  color: #fff;
  padding: 9px 13px;
  border-radius: 14px 14px 4px 14px;
}
.msg--assistant {
  align-self: flex-start;
  max-width: 96%;
  background: #fff;
  border: 1px solid var(--border);
  padding: 10px 13px;
  border-radius: 14px 14px 14px 4px;
}
.msg__quote {
  font-size: 11px;
  color: var(--text-dim);
  background: #f1f5f9;
  border-radius: 6px;
  padding: 3px 8px;
  margin-bottom: 6px;
}
.msg--user .msg__quote {
  background: rgb(255 255 255 / 18%);
  color: #fff;
}
.msg--typing {
  display: inline-flex;
  gap: 5px;
  align-items: center;
  padding: 12px 16px;
}
.msg__dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #94a3b8;
  animation: chat-blink 1.2s infinite ease-in-out;
}
.msg__dot:nth-child(2) {
  animation-delay: 0.15s;
}
.msg__dot:nth-child(3) {
  animation-delay: 0.3s;
}
@keyframes chat-blink {
  0%,
  60%,
  100% {
    opacity: 0.25;
  }
  30% {
    opacity: 1;
  }
}

/* ---- 修改建议卡 ---- */
.msg__proposal {
  margin-top: 10px;
  background: #f8fafc;
  border: 1px solid #bfdbfe;
  border-radius: 10px;
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.msg__proposal-head {
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.msg__scope {
  align-self: flex-start;
  font-size: 11px;
  font-weight: 600;
  color: #1d4ed8;
  background: #dbeafe;
  border-radius: 999px;
  padding: 2px 9px;
}
.msg__summary {
  font-size: 12px;
  color: var(--text);
}
.msg__actions {
  display: flex;
  gap: 8px;
}
.chat__apply {
  font: inherit;
  font-size: 12px;
  padding: 5px 16px;
  border-radius: 7px;
  border: 1px solid #3b82f6;
  background: #3b82f6;
  color: #fff;
  cursor: pointer;
}
.chat__apply:hover:not(:disabled) {
  background: #2563eb;
}
.chat__apply:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

/* ---- 输入区 ---- */
.chat__composer {
  padding: 10px 14px 12px;
  border-top: 1px solid var(--border);
  background: #fff;
}
.chat__error {
  margin: 0 0 8px;
  padding: 6px 10px;
  font-size: 12px;
  color: var(--mastery-red);
  background: #fef2f2;
  border-radius: 8px;
}
.chat__quote {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
  padding: 5px 6px 5px 12px;
  font-size: 12px;
  color: #1d4ed8;
  background: #eff6ff;
  border: 1px solid #bfdbfe;
  border-radius: 999px;
}
.chat__quote-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.chat__quote-remove {
  flex-shrink: 0;
  width: 20px;
  height: 20px;
  border: none;
  border-radius: 50%;
  background: none;
  font-size: 15px;
  line-height: 1;
  cursor: pointer;
  color: #1d4ed8;
}
.chat__quote-remove:hover {
  background: #dbeafe;
}
.chat__inputbox {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  padding: 8px 8px 8px 12px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: #fff;
  transition: border-color 0.15s;
}
.chat__inputbox:focus-within {
  border-color: #93c5fd;
  box-shadow: 0 0 0 3px rgb(59 130 246 / 12%);
}
.chat__inputbox textarea {
  flex: 1;
  border: none;
  outline: none;
  resize: none;
  font: inherit;
  font-size: 13px;
  line-height: 1.6;
  max-height: 120px;
  background: transparent;
}
.chat__send {
  flex-shrink: 0;
  font: inherit;
  font-size: 13px;
  padding: 6px 16px;
  border: none;
  border-radius: 8px;
  background: #3b82f6;
  color: #fff;
  cursor: pointer;
}
.chat__send:hover:not(:disabled) {
  background: #2563eb;
}
.chat__send:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.chat__hint {
  margin: 6px 2px 0;
  font-size: 11px;
  color: var(--text-dim);
}

/* ---- 放大预览弹层 ---- */
.preview-mask {
  position: fixed;
  inset: 0;
  z-index: 400;
  background: rgb(15 23 42 / 45%);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 32px;
}
.preview-modal {
  width: min(960px, 92vw);
  max-height: 88vh;
  display: flex;
  flex-direction: column;
  background: #fff;
  border-radius: 14px;
  overflow: hidden;
  box-shadow: 0 18px 50px rgb(15 23 42 / 28%);
}
.preview-modal__head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
  padding: 14px 18px;
  border-bottom: 1px solid var(--border);
  background: #f8fafc;
}
.preview-modal__title {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.preview-modal__summary {
  font-size: 13px;
  color: var(--text);
}
.preview-modal__close {
  flex-shrink: 0;
  width: 30px;
  height: 30px;
  border: none;
  border-radius: 8px;
  background: none;
  font-size: 20px;
  line-height: 1;
  cursor: pointer;
  color: var(--text-dim);
}
.preview-modal__close:hover {
  background: #e2e8f0;
  color: var(--text);
}
.preview-modal__body {
  flex: 1;
  overflow-y: auto;
  padding: 20px 28px 28px;
}
.preview-modal__body :deep(.md-body) {
  max-width: 820px;
  margin: 0 auto;
}
.preview-modal__foot {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  padding: 12px 18px;
  border-top: 1px solid var(--border);
  background: #fff;
}
.preview-modal__hint {
  font-size: 12px;
  color: var(--text-dim);
}
.preview-modal__actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}
</style>
