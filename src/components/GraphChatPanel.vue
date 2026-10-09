<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import { X } from 'lucide-vue-next'
import type { KnowledgeNode } from '@shared/types'

interface GraphDiff {
  added: string[]
  removed: string[]
  modified: string[]
}

interface ChatMsg {
  role: 'user' | 'assistant'
  content: string
  proposal?: { nodes: KnowledgeNode[] }
  diff?: GraphDiff
  applied?: boolean
}

const props = defineProps<{
  topicId: string
  disabled?: boolean
  disabledHint?: string
}>()

const emit = defineEmits<{
  apply: [nodes: KnowledgeNode[]]
  close: []
}>()

const messages = ref<ChatMsg[]>([])
const input = ref('')
const loading = ref(false)
const error = ref<string | null>(null)
const listEl = ref<HTMLElement | null>(null)

watch(
  () => [messages.value.length, loading.value],
  async () => {
    await nextTick()
    listEl.value?.scrollTo({ top: listEl.value.scrollHeight })
  },
)

function diffText(diff: GraphDiff): string {
  const parts: string[] = []
  if (diff.added.length) parts.push(`新增 ${diff.added.length}：${diff.added.join('、')}`)
  if (diff.removed.length) parts.push(`删除 ${diff.removed.length}：${diff.removed.join('、')}`)
  if (diff.modified.length) parts.push(`修改 ${diff.modified.length}：${diff.modified.join('、')}`)
  return parts.join('；')
}

async function send() {
  const message = input.value.trim()
  if (!message || loading.value || props.disabled) return
  input.value = ''
  error.value = null
  messages.value = [...messages.value, { role: 'user', content: message }]
  loading.value = true
  try {
    const history = messages.value.slice(0, -1).map((m) => ({ role: m.role, content: m.content }))
    const res = await fetch(`/api/topics/${props.topicId}/graph/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, history }),
    })
    const data = (await res.json()) as {
      reply?: string
      proposal?: { nodes: KnowledgeNode[] }
      diff?: GraphDiff
      error?: string
    }
    if (!res.ok) throw new Error(data.error ?? `请求失败：${res.status}`)
    messages.value = [
      ...messages.value,
      { role: 'assistant', content: data.reply ?? '', proposal: data.proposal, diff: data.diff },
    ]
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    loading.value = false
  }
}

function applyProposal(msg: ChatMsg) {
  if (!msg.proposal || msg.applied) return
  msg.applied = true
  emit('apply', msg.proposal.nodes)
}
</script>

<template>
  <aside class="chat">
    <header class="chat__header">
      <span>AI 调整图谱</span>
      <button
        class="chat__close"
        title="关闭"
        @click="emit('close')"
      >
        <X :size="15" />
      </button>
    </header>

    <p
      v-if="disabled"
      class="chat__disabled"
    >
      {{ disabledHint ?? '有未保存的修改，请先保存再使用 AI 调整' }}
    </p>

    <div
      ref="listEl"
      class="chat__list"
    >
      <p
        v-if="messages.length === 0"
        class="chat__empty"
      >
        直接说诉求，如：「把 FM 拆成 FM 原理和 FFM 对比两个点」「删掉在线 A/B 实验」「接下来该学什么？」
      </p>
      <div
        v-for="(m, i) in messages"
        :key="i"
        class="msg"
        :class="`msg--${m.role}`"
      >
        <div class="msg__content">
          {{ m.content }}
        </div>
        <div
          v-if="m.diff"
          class="msg__diff"
        >
          {{ diffText(m.diff) }}
        </div>
        <button
          v-if="m.proposal"
          class="btn btn--primary btn--sm msg__apply"
          :disabled="m.applied || disabled"
          @click="applyProposal(m)"
        >
          {{ m.applied ? '已应用' : '应用修改' }}
        </button>
      </div>
      <div
        v-if="loading"
        class="msg msg--assistant msg--typing"
      >
        <span class="msg__dot" /><span class="msg__dot" /><span class="msg__dot" />
      </div>
    </div>

    <p
      v-if="error"
      class="chat__error"
    >
      {{ error }}
    </p>

    <form
      class="chat__inputbox"
      @submit.prevent="send"
    >
      <input
        v-model="input"
        type="text"
        placeholder="描述你想怎么调整图谱…"
        :disabled="loading || disabled"
      >
      <button
        class="btn btn--primary btn--sm"
        type="submit"
        :disabled="loading || disabled || !input.trim()"
      >
        发送
      </button>
    </form>
  </aside>
</template>

<style scoped>
.chat {
  width: 340px;
  border-left: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: var(--bg);
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
.chat__close {
  display: inline-flex;
  align-items: center;
  border: none;
  background: none;
  cursor: pointer;
  color: var(--text-dim);
  padding: 4px;
  border-radius: 6px;
  transition:
    color var(--dur-fast) var(--ease),
    background var(--dur-fast) var(--ease);
}
.chat__close:hover {
  color: var(--text);
  background: var(--bg-muted);
}
.chat__disabled {
  margin: 0;
  padding: 8px 14px;
  font-size: 12px;
  color: var(--amber-text);
  background: var(--amber-bg);
}
.chat__list {
  flex: 1;
  overflow-y: auto;
  padding: 14px 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  background: var(--bg-subtle);
}
.chat__empty {
  font-size: 12px;
  color: var(--text-dim);
  line-height: 1.7;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  padding: 12px 14px;
}
.msg {
  max-width: 92%;
  font-size: 13px;
  line-height: 1.6;
  padding: 9px 13px;
}
.msg--user {
  align-self: flex-end;
  background: var(--primary);
  color: #fff;
  border-radius: 14px 14px 4px 14px;
}
.msg--assistant {
  align-self: flex-start;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 14px 14px 14px 4px;
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
  background: var(--text-faint);
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
.msg__diff {
  margin-top: 6px;
  font-size: 12px;
  color: var(--primary-hover);
  background: var(--primary-bg);
  border-radius: 6px;
  padding: 4px 8px;
}
.msg__apply {
  margin-top: 8px;
}
.chat__error {
  margin: 0;
  padding: 6px 14px;
  font-size: 12px;
  color: var(--mastery-red);
  background: var(--red-bg);
}
.chat__inputbox {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-top: 1px solid var(--border);
  background: var(--bg);
}
.chat__inputbox input {
  flex: 1;
  min-width: 0;
  font: inherit;
  font-size: 13px;
  padding: 7px 12px;
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  transition:
    border-color var(--dur-fast) var(--ease),
    box-shadow var(--dur-fast) var(--ease);
}
.chat__inputbox input:focus {
  outline: none;
  border-color: var(--primary-soft);
  box-shadow: 0 0 0 3px rgb(var(--primary-rgb) / 12%);
}
</style>
