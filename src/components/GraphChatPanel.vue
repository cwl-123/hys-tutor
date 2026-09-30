<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
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
        @click="emit('close')"
      >
        ×
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
          class="btn btn--apply"
          :disabled="m.applied || disabled"
          @click="applyProposal(m)"
        >
          {{ m.applied ? '已应用' : '应用修改' }}
        </button>
      </div>
      <div
        v-if="loading"
        class="msg msg--assistant"
      >
        <div class="msg__content">
          思考中…
        </div>
      </div>
    </div>

    <p
      v-if="error"
      class="chat__error"
    >
      {{ error }}
    </p>

    <form
      class="chat__input"
      @submit.prevent="send"
    >
      <input
        v-model="input"
        type="text"
        placeholder="描述你想怎么调整图谱…"
        :disabled="loading || disabled"
      >
      <button
        class="btn btn--primary"
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
  border: none;
  background: none;
  font-size: 18px;
  cursor: pointer;
  color: var(--text-dim);
}
.chat__disabled {
  margin: 0;
  padding: 8px 14px;
  font-size: 12px;
  color: #b45309;
  background: #fffbeb;
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
  line-height: 1.7;
}
.msg {
  max-width: 92%;
  font-size: 13px;
  line-height: 1.6;
  padding: 8px 12px;
  border-radius: 10px;
}
.msg--user {
  align-self: flex-end;
  background: #3b82f6;
  color: #fff;
}
.msg--assistant {
  align-self: flex-start;
  background: #f3f4f6;
}
.msg__diff {
  margin-top: 6px;
  font-size: 12px;
  color: #1d4ed8;
  background: #eff6ff;
  border-radius: 6px;
  padding: 4px 8px;
}
.btn--apply {
  margin-top: 8px;
  font-size: 12px;
  padding: 4px 12px;
}
.chat__error {
  margin: 0;
  padding: 6px 14px;
  font-size: 12px;
  color: var(--mastery-red);
}
.chat__input {
  display: flex;
  gap: 6px;
  padding: 10px 12px;
  border-top: 1px solid var(--border);
}
.chat__input input {
  flex: 1;
  font: inherit;
  font-size: 13px;
  padding: 7px 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
}
.btn {
  font: inherit;
  font-size: 13px;
  padding: 5px 12px;
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
