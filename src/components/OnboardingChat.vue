<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import { ArrowRight } from 'lucide-vue-next'
import type { TopicProfile } from '@shared/types'
import { errMsg } from '@shared/error'
import { PROFILE_LEVELS, PROFILE_STYLES, pickOption } from '@/utils/topic-profile'

interface ChatMsg {
  role: 'user' | 'assistant'
  content: string
  quickReplies?: string[]
}

interface Proposal {
  name: string
  scope: string
  profile: TopicProfile
}

const props = defineProps<{
  creating?: boolean
}>()

const emit = defineEmits<{
  create: [payload: { name: string; profile: TopicProfile }]
}>()

const GREETING: ChatMsg = {
  role: 'assistant',
  content: '想学什么？随便说说，哪怕只是一个模糊的方向——我会问几个问题帮你理清，然后一键生成你的知识图谱。',
  quickReplies: ['我想学怎么看一家公司', '我想入门一个全新的领域', '我有个方向但不确定从哪开始'],
}

const messages = ref<ChatMsg[]>([{ ...GREETING }])
const input = ref('')
const loading = ref(false)
const error = ref<string | null>(null)
const listEl = ref<HTMLElement | null>(null)

// 提案卡可编辑字段（AI 每次给新提案时原位刷新）
const proposal = ref<Proposal | null>(null)
const pName = ref('')
const pStyle = ref<string | null>(null)
const pLevel = ref<string | null>(null)
const pExtra = ref('')

watch(
  () => [messages.value.length, loading.value, proposal.value],
  async () => {
    await nextTick()
    listEl.value?.scrollTo({ top: listEl.value.scrollHeight })
  },
)

function applyProposal(p: Proposal) {
  proposal.value = p
  pName.value = p.name
  pStyle.value = p.profile.style ?? null
  pLevel.value = p.profile.level ?? null
  pExtra.value = p.profile.extra ?? ''
}

async function sendText(text: string) {
  const message = text.trim()
  if (!message || loading.value || props.creating) return
  input.value = ''
  error.value = null
  messages.value = [...messages.value, { role: 'user', content: message }]
  loading.value = true
  try {
    const res = await fetch('/api/onboarding/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: messages.value.map((m) => ({ role: m.role, content: m.content })),
      }),
    })
    const data = (await res.json()) as {
      reply?: string
      quickReplies?: string[]
      proposal?: Proposal
      error?: string
    }
    if (!res.ok) throw new Error(data.error ?? `请求失败：${res.status}`)
    messages.value = [
      ...messages.value,
      { role: 'assistant', content: data.reply ?? '', quickReplies: data.quickReplies },
    ]
    if (data.proposal) applyProposal(data.proposal)
  } catch (err) {
    error.value = errMsg(err)
  } finally {
    loading.value = false
  }
}

function send() {
  void sendText(input.value)
}

function confirmCreate() {
  const name = pName.value.trim()
  if (!name || props.creating) return
  const profile: TopicProfile = {}
  if (pStyle.value) profile.style = pStyle.value
  if (pLevel.value) profile.level = pLevel.value
  if (pExtra.value.trim()) profile.extra = pExtra.value.trim()
  emit('create', { name, profile })
}

// 最新一条助手消息的快捷回复（历史轮次的不再展示）
const activeQuickReplies = () => {
  const last = messages.value[messages.value.length - 1]
  return last?.role === 'assistant' ? (last.quickReplies ?? []) : []
}
</script>

<template>
  <div class="ob">
    <div
      ref="listEl"
      class="ob__list"
    >
      <div
        v-for="(m, i) in messages"
        :key="i"
        class="ob-msg"
        :class="`ob-msg--${m.role}`"
      >
        {{ m.content }}
      </div>
      <div
        v-if="loading"
        class="ob-msg ob-msg--assistant ob-msg--typing"
      >
        <span class="ob-dot" /><span class="ob-dot" /><span class="ob-dot" />
      </div>
      <div
        v-if="!loading && activeQuickReplies().length"
        class="ob-quick"
      >
        <button
          v-for="q in activeQuickReplies()"
          :key="q"
          type="button"
          class="ob-quick__chip"
          :disabled="creating"
          @click="sendText(q)"
        >
          {{ q }}
        </button>
      </div>
    </div>

    <div
      v-if="proposal"
      class="ob-proposal"
    >
      <p class="ob-proposal__title">
        我帮你整理好了，确认或改一改：
      </p>
      <input
        v-model="pName"
        class="ob-proposal__name"
        type="text"
        maxlength="100"
        :disabled="creating"
      >
      <p class="ob-proposal__scope">
        {{ proposal.scope }}
      </p>
      <div class="ob-proposal__row">
        <span class="ob-proposal__label">讲解风格</span>
        <div class="ob-chips">
          <button
            v-for="s in PROFILE_STYLES"
            :key="s"
            type="button"
            class="ob-chip"
            :class="{ 'ob-chip--on': pStyle === s }"
            :disabled="creating"
            @click="pStyle = pickOption(pStyle, s)"
          >
            {{ s }}
          </button>
        </div>
      </div>
      <div class="ob-proposal__row">
        <span class="ob-proposal__label">当前程度</span>
        <div class="ob-chips">
          <button
            v-for="l in PROFILE_LEVELS"
            :key="l"
            type="button"
            class="ob-chip"
            :class="{ 'ob-chip--on': pLevel === l }"
            :disabled="creating"
            @click="pLevel = pickOption(pLevel, l)"
          >
            {{ l }}
          </button>
        </div>
      </div>
      <textarea
        v-model="pExtra"
        class="ob-proposal__extra"
        rows="1"
        placeholder="额外要求（可选），可写多行"
        :disabled="creating"
      />
      <div class="ob-proposal__foot">
        <span class="ob-proposal__hint">也可以继续聊，提案会随对话更新</span>
        <button
          class="ob-proposal__go"
          type="button"
          :disabled="creating || !pName.trim()"
          @click="confirmCreate"
        >
          {{ creating ? 'AI 调研生成中…' : '生成知识图谱' }}
          <ArrowRight
            v-if="!creating"
            :size="15"
          />
        </button>
      </div>
    </div>

    <p
      v-if="error"
      class="ob__error"
    >
      {{ error }}
    </p>

    <form
      class="ob__inputbox"
      @submit.prevent="send"
    >
      <input
        v-model="input"
        type="text"
        placeholder="说说你想学什么…"
        :disabled="loading || creating"
      >
      <button
        class="ob__send"
        type="submit"
        :disabled="loading || creating || !input.trim()"
      >
        发送
      </button>
    </form>
  </div>
</template>

<style scoped>
.ob {
  margin-top: 16px;
  display: flex;
  flex: 1;
  min-height: 0;
  flex-direction: column;
  gap: 10px;
}
.ob__list {
  flex: 1;
  min-height: 260px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  background: var(--bg-subtle);
  border: 1px solid var(--border);
  border-radius: var(--r-md);
}
.ob-msg {
  max-width: 92%;
  font-size: 13px;
  line-height: 1.7;
  padding: 9px 13px;
  white-space: pre-wrap;
}
.ob-msg--user {
  align-self: flex-end;
  background: var(--primary-btn);
  color: #fff;
  border-radius: 14px 14px 4px 14px;
}
.ob-msg--assistant {
  align-self: flex-start;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 14px 14px 14px 4px;
}
.ob-msg--typing {
  display: inline-flex;
  gap: 5px;
  align-items: center;
  padding: 12px 16px;
}
.ob-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--text-faint);
  animation: ob-blink 1.2s infinite ease-in-out;
}
.ob-dot:nth-child(2) {
  animation-delay: 0.15s;
}
.ob-dot:nth-child(3) {
  animation-delay: 0.3s;
}
@keyframes ob-blink {
  0%,
  60%,
  100% {
    opacity: 0.25;
  }
  30% {
    opacity: 1;
  }
}
.ob-quick {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-self: flex-start;
}
.ob-quick__chip {
  font: inherit;
  font-size: 12px;
  padding: 5px 12px;
  border-radius: var(--r-pill);
  border: 1px dashed var(--primary-soft);
  background: var(--bg);
  color: var(--primary-hover);
  cursor: pointer;
  transition: all var(--dur-fast) var(--ease);
}
.ob-quick__chip:hover:not(:disabled) {
  border-style: solid;
  background: var(--primary-bg);
}
.ob-quick__chip:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.ob-proposal {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px 16px;
  border: 1px solid var(--primary-border);
  background: var(--primary-bg);
  border-radius: var(--r-md);
}
.ob-proposal__title {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  color: var(--primary-hover);
}
.ob-proposal__name {
  width: 100%;
  font: inherit;
  font-size: 14px;
  font-weight: 600;
  padding: 8px 12px;
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  background: var(--bg);
}
.ob-proposal__name:focus {
  outline: none;
  border-color: var(--primary);
  box-shadow: var(--ring-primary);
}
.ob-proposal__scope {
  margin: 0;
  font-size: 12px;
  line-height: 1.7;
  color: var(--text-secondary);
}
.ob-proposal__row {
  display: flex;
  align-items: center;
  gap: 10px;
}
.ob-proposal__label {
  flex: none;
  width: 60px;
  font-size: 12px;
  color: var(--text-dim);
}
.ob-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.ob-chip {
  font: inherit;
  font-size: 12px;
  padding: 4px 12px;
  border-radius: var(--r-pill);
  border: 1px solid var(--border);
  background: var(--bg);
  color: var(--text);
  cursor: pointer;
  transition: all var(--dur-fast) var(--ease);
}
.ob-chip--on,
.ob-chip--on:hover:not(:disabled) {
  border-color: var(--primary);
  background: var(--bg);
  color: var(--primary-hover);
  font-weight: 500;
  box-shadow: 0 0 0 3px rgb(var(--primary-rgb) / 8%);
}
.ob-proposal__extra {
  width: 100%;
  font: inherit;
  font-size: 12px;
  padding: 7px 12px;
  min-height: 72px;
  line-height: 1.65;
  resize: vertical;
  border: 1px dashed var(--border);
  border-radius: var(--r-sm);
  background: var(--bg);
}
.ob-proposal__extra:focus {
  outline: none;
  border-color: var(--primary);
  border-style: solid;
}
.ob-proposal__foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.ob-proposal__hint {
  font-size: 12px;
  color: var(--text-dim);
}
.ob-proposal__go {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font: inherit;
  font-size: 14px;
  font-weight: 600;
  padding: 9px 20px;
  border: none;
  border-radius: var(--r-md);
  background: var(--primary-btn);
  color: #fff;
  cursor: pointer;
  transition:
    background var(--dur-fast) var(--ease),
    opacity var(--dur-fast) var(--ease);
}
.ob-proposal__go:hover:not(:disabled) {
  background: var(--primary-btn-hover);
}
.ob-proposal__go:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.ob__error {
  margin: 0;
  font-size: 12px;
  color: var(--mastery-red);
}
.ob__inputbox {
  display: flex;
  align-items: center;
  gap: 8px;
}
.ob__inputbox input {
  flex: 1;
  min-width: 0;
  font: inherit;
  font-size: 13px;
  padding: 9px 14px;
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  background: var(--bg);
  transition:
    border-color var(--dur-fast) var(--ease),
    box-shadow var(--dur-fast) var(--ease);
}
.ob__inputbox input::placeholder {
  color: var(--text-dim);
}
.ob__inputbox input:hover:not(:disabled) {
  border-color: var(--border-strong);
}
.ob__inputbox:focus-within input {
  outline: none;
  border-color: var(--primary);
  box-shadow: var(--ring-primary);
}
.ob__send {
  flex: none;
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  padding: 9px 18px;
  border: none;
  border-radius: var(--r-md);
  background: var(--primary-btn);
  color: #fff;
  cursor: pointer;
  box-shadow: 0 2px 10px rgb(var(--primary-rgb) / 32%);
  transition:
    background var(--dur-fast) var(--ease),
    box-shadow var(--dur-fast) var(--ease),
    opacity var(--dur-fast) var(--ease);
}
.ob__send:hover:not(:disabled) {
  background: var(--primary-btn-hover);
  box-shadow: 0 4px 16px rgb(var(--primary-rgb) / 44%);
}
.ob__send:disabled {
  background: var(--bg-muted);
  color: var(--text-faint);
  box-shadow: inset 0 0 0 1px var(--border);
  cursor: not-allowed;
}

/* ---------- 手机端 ---------- */
@media (max-width: 720px) {
  .ob__list {
    min-height: 220px;
    padding: 10px;
  }
  .ob-msg {
    max-width: 96%;
    font-size: 13px;
  }
  .ob-proposal {
    padding: 12px;
  }
  .ob-proposal__row {
    flex-direction: column;
    align-items: flex-start;
    gap: 6px;
  }
  .ob-proposal__label {
    width: auto;
  }
  .ob-proposal__foot {
    flex-direction: column;
    align-items: stretch;
    gap: 8px;
  }
  .ob-proposal__hint {
    display: none;
  }
  .ob-proposal__go {
    justify-content: center;
    width: 100%;
    height: 42px;
  }
  .ob__inputbox input {
    font-size: 16px;
  }
}
</style>
