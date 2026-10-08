<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
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
const previewId = ref<string | null>(null)
const listEl = ref<HTMLElement | null>(null)

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
    }
  },
)

const canUndo = computed(() => versions.value.length > 0)

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
    previewId.value = null
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
      <span>AI 对话优化课件</span>
      <div class="chat__header-actions">
        <button
          class="chat__link"
          type="button"
          :disabled="!canUndo"
          title="撤销最近一次已应用的修改"
          @click="undo"
        >
          撤销修改
        </button>
        <button
          class="chat__close"
          type="button"
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
      <p
        v-if="messages.length === 0"
        class="chat__empty"
      >
        看完课件哪里不满意，直接说。例如：「第二段太抽象，讲通俗点」「这个公式推导跳步太多，补全」「我基础差，整篇用大白话重写」。
        <br><br>
        想只改一处：把鼠标移到某个小节，点「改本节」；或选中一段话，点「引用这段让 AI 优化」。
      </p>

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
          引用：{{ quoteLabel(m.quote) }}
        </div>
        <div class="msg__content">
          {{ m.content }}
        </div>

        <div
          v-if="m.proposal"
          class="msg__proposal"
        >
          <div class="msg__proposal-head">
            <span class="msg__scope">
              {{ m.proposal.scope === 'section' ? `改本节：${m.proposal.targetHeading ?? ''}` : '整篇重写' }}
            </span>
            <span>{{ m.proposal.summary }}</span>
          </div>
          <button
            class="chat__link"
            type="button"
            @click="previewId = previewId === m.id ? null : m.id"
          >
            {{ previewId === m.id ? '收起预览' : '预览改动' }}
          </button>
          <div
            v-if="previewId === m.id"
            class="msg__preview"
          >
            <MarkdownRenderer :content="previewContent(m)" />
          </div>
          <button
            class="btn btn--primary msg__apply"
            type="button"
            :disabled="m.applied || applyingId === m.id"
            @click="applyProposal(m)"
          >
            {{ m.applied ? '已应用到课件' : applyingId === m.id ? '应用中…' : '应用修改' }}
          </button>
        </div>
      </div>

      <div
        v-if="loading"
        class="msg msg--assistant"
      >
        <div class="msg__content">
          正在思考怎么改…
        </div>
      </div>
    </div>

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
      <span>将引用：{{ quoteLabel(pendingQuote) }}</span>
      <button
        class="chat__quote-remove"
        type="button"
        @click="pendingQuote = null"
      >
        ×
      </button>
    </div>

    <form
      class="chat__input"
      @submit.prevent="send"
    >
      <textarea
        v-model="input"
        rows="2"
        placeholder="描述你想怎么改这节课…（Enter 发送，Shift+Enter 换行）"
        :disabled="loading"
        @keydown.enter.exact.prevent="send"
      />
      <button
        class="btn btn--primary"
        type="submit"
        :disabled="loading || !input.trim()"
      >
        发送
      </button>
    </form>
  </aside>
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
  box-shadow: -4px 0 16px rgb(15 23 42 / 8%);
}
.chat__header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 14px;
  font-weight: 600;
  font-size: 14px;
  border-bottom: 1px solid var(--border);
}
.chat__header-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}
.chat__link {
  border: none;
  background: none;
  color: #2563eb;
  font: inherit;
  font-size: 12px;
  cursor: pointer;
  padding: 0;
}
.chat__link:disabled {
  color: var(--text-dim);
  cursor: not-allowed;
}
.chat__close {
  border: none;
  background: none;
  font-size: 18px;
  cursor: pointer;
  color: var(--text-dim);
}
.chat__list {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.chat__empty {
  font-size: 12px;
  color: var(--text-dim);
  line-height: 1.8;
}
.msg {
  max-width: 100%;
  font-size: 13px;
  line-height: 1.6;
  padding: 8px 12px;
  border-radius: 10px;
}
.msg--user {
  align-self: flex-end;
  max-width: 92%;
  background: #3b82f6;
  color: #fff;
}
.msg--assistant {
  align-self: flex-start;
  max-width: 96%;
  background: #f3f4f6;
}
.msg__quote {
  font-size: 11px;
  opacity: 0.85;
  border-left: 2px solid currentcolor;
  padding-left: 6px;
  margin-bottom: 4px;
}
.msg__proposal {
  margin-top: 8px;
  background: #fff;
  border: 1px solid #bfdbfe;
  border-radius: 8px;
  padding: 8px 10px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.msg__proposal-head {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 12px;
}
.msg__scope {
  color: #1d4ed8;
  font-weight: 600;
}
.msg__preview {
  max-height: 320px;
  overflow-y: auto;
  border: 1px dashed var(--border);
  border-radius: 6px;
  padding: 6px 10px;
  background: #fafafa;
}
.msg__apply {
  align-self: flex-start;
  font-size: 12px;
  padding: 5px 14px;
}
.chat__error {
  margin: 0;
  padding: 6px 14px;
  font-size: 12px;
  color: var(--mastery-red);
}
.chat__quote {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  padding: 6px 14px;
  font-size: 12px;
  color: #1d4ed8;
  background: #eff6ff;
  border-top: 1px solid #bfdbfe;
}
.chat__quote-remove {
  border: none;
  background: none;
  font-size: 16px;
  cursor: pointer;
  color: #1d4ed8;
}
.chat__input {
  display: flex;
  gap: 6px;
  padding: 10px 12px;
  border-top: 1px solid var(--border);
  align-items: flex-end;
}
.chat__input textarea {
  flex: 1;
  font: inherit;
  font-size: 13px;
  padding: 7px 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  resize: vertical;
  max-height: 120px;
}
.btn {
  font: inherit;
  font-size: 13px;
  padding: 6px 14px;
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
.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>