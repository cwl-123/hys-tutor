<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { ArrowRight, FileText, LoaderCircle, Paperclip, X } from 'lucide-vue-next'
import type { OnboardingAttachmentMeta, TopicProfile } from '@shared/types'
import { errMsg } from '@shared/error'
import { PROFILE_LEVELS, PROFILE_STYLES, pickOption } from '@/utils/topic-profile'

interface ChatAttachment {
  id: string
  name: string
  kind: 'image' | 'text'
  url?: string
}

interface ChatMsg {
  role: 'user' | 'assistant'
  content: string
  quickReplies?: string[]
  attachments?: ChatAttachment[]
}

interface DraftAttachment {
  key: string
  id?: string
  name: string
  kind: 'image' | 'text'
  size: number
  url?: string
  chars?: number
  format?: string
  truncated?: boolean
  uploading: boolean
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

// 与后端 onboarding-attachments 保持一致
const MAX_ATTACHMENTS = 3
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024
const ACCEPT =
  'image/png,image/jpeg,image/webp,image/gif,.pdf,.docx,.pptx,.txt,.md,.markdown,.csv,.tsv,.json,.yaml,.yml,.log,.xml,.html,.ts,.js,.py,.java,.go,.sql'

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

// 待发送附件：选完立即上传解析，发送时只带引用
const drafts = ref<DraftAttachment[]>([])
const uploading = computed(() => drafts.value.some((d) => d.uploading))
const canSend = computed(() => {
  if (loading.value || uploading.value || props.creating) return false
  if (input.value.trim()) return true
  return drafts.value.length > 0 && drafts.value.every((d) => !!d.id)
})
const uploadError = ref<string | null>(null)
const dragging = ref(false)
const fileInput = ref<HTMLInputElement | null>(null)
let dragDepth = 0

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
  if (loading.value || uploading.value || props.creating) return
  const ready = drafts.value.filter((d): d is DraftAttachment & { id: string } => !!d.id)
  if (ready.length !== drafts.value.length) return
  if (!message && !ready.length) return
  input.value = ''
  error.value = null
  uploadError.value = null
  const attachments: ChatAttachment[] = ready.map((d) => ({
    id: d.id,
    name: d.name,
    kind: d.kind,
    url: d.url,
  }))
  messages.value = [
    ...messages.value,
    { role: 'user', content: message, ...(attachments.length ? { attachments } : {}) },
  ]
  drafts.value = []
  loading.value = true
  try {
    const res = await fetch('/api/onboarding/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: messages.value.map((m) => ({
          role: m.role,
          content: m.content,
          ...(m.attachments?.length
            ? {
                attachments: m.attachments.map((a) => ({
                  id: a.id,
                  name: a.name,
                  kind: a.kind,
                })),
              }
            : {}),
        })),
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

// ---------- 附件 ----------

function openFilePicker() {
  if (loading.value || uploading.value || props.creating) return
  fileInput.value?.click()
}

async function onFilesPicked(e: Event) {
  const el = e.target as HTMLInputElement
  const files = Array.from(el.files ?? [])
  el.value = ''
  await addFiles(files)
}

async function addFiles(files: File[]) {
  uploadError.value = null
  const room = MAX_ATTACHMENTS - drafts.value.length
  if (room <= 0) {
    uploadError.value = `最多上传 ${MAX_ATTACHMENTS} 个附件`
    return
  }
  if (files.length > room) {
    uploadError.value = `最多上传 ${MAX_ATTACHMENTS} 个附件，多出的已忽略`
  }
  await Promise.all(files.slice(0, room).map((file) => uploadFile(file)))
}

async function uploadFile(file: File) {
  if (file.size > MAX_ATTACHMENT_BYTES) {
    uploadError.value = `「${file.name}」超过 10MB，换个小一点的`
    return
  }
  const key = `local-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
  drafts.value = [
    ...drafts.value,
    {
      key,
      name: file.name || '未命名文件',
      kind: file.type.startsWith('image/') ? 'image' : 'text',
      size: file.size,
      uploading: true,
    },
  ]
  try {
    const res = await fetch('/api/onboarding/attachments', {
      method: 'POST',
      headers: {
        'Content-Type': file.type || 'application/octet-stream',
        'X-File-Name': encodeURIComponent(file.name || '未命名文件'),
      },
      body: file,
    })
    const data = (await res.json()) as OnboardingAttachmentMeta & { error?: string }
    if (!res.ok) throw new Error(data.error ?? `上传失败：${res.status}`)
    drafts.value = drafts.value.map((d) =>
      d.key === key
        ? {
            key,
            id: data.id,
            name: data.name,
            kind: data.kind,
            size: data.size,
            url: data.url,
            chars: data.chars,
            format: data.format,
            truncated: data.truncated,
            uploading: false,
          }
        : d,
    )
  } catch (err) {
    drafts.value = drafts.value.filter((d) => d.key !== key)
    uploadError.value = errMsg(err)
  }
}

function removeDraft(key: string) {
  const target = drafts.value.find((d) => d.key === key)
  drafts.value = drafts.value.filter((d) => d.key !== key)
  uploadError.value = null
  if (target?.id) {
    void fetch(`/api/onboarding/attachments/${target.id}`, { method: 'DELETE' }).catch(() => {})
  }
}

function onDragEnter(e: DragEvent) {
  if (!e.dataTransfer?.types.includes('Files')) return
  dragDepth++
  dragging.value = true
}

function onDragOver(e: DragEvent) {
  if (e.dataTransfer?.types.includes('Files')) e.preventDefault()
}

function onDragLeave() {
  dragDepth = Math.max(0, dragDepth - 1)
  if (!dragDepth) dragging.value = false
}

async function onDrop(e: DragEvent) {
  e.preventDefault()
  dragDepth = 0
  dragging.value = false
  await addFiles(Array.from(e.dataTransfer?.files ?? []))
}

// 从剪贴板粘贴截图（截图工具复制后直接 Ctrl/⌘+V）
async function onPaste(e: ClipboardEvent) {
  const items = Array.from(e.clipboardData?.items ?? [])
  const images = items
    .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
    .map((item) => item.getAsFile())
    .filter((file): file is File => !!file)
  if (!images.length) return
  e.preventDefault()
  const stamp = new Date().toISOString().slice(11, 19).replace(/:/g, '')
  await addFiles(
    images.map(
      (file, i) =>
        new File([file], file.name || `粘贴图片-${stamp}-${i + 1}.png`, { type: file.type }),
    ),
  )
}

function extOf(name: string): string {
  const ext = name.split('.').pop() ?? ''
  return ext && ext !== name && ext.length <= 5 ? ext.toUpperCase() : '文档'
}

function fmtSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)}MB`
  if (bytes >= 1024) return `${Math.round(bytes / 1024)}KB`
  return `${bytes}B`
}

function draftSub(d: DraftAttachment): string {
  if (d.uploading) return '解析中…'
  if (d.kind === 'image') return `图片 · ${fmtSize(d.size)}`
  const chars = d.chars ? `${d.chars} 字` : fmtSize(d.size)
  return `${chars}${d.truncated ? '（已截取）' : ''}`
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
  <div
    class="ob"
    :class="{ 'ob--drag': dragging }"
    @dragenter.prevent="onDragEnter"
    @dragover="onDragOver"
    @dragleave="onDragLeave"
    @drop="onDrop"
  >
    <div
      v-if="dragging"
      class="ob__drop"
    >
      松开即可上传图片或文件
    </div>
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
        <div
          v-if="m.attachments?.length"
          class="ob-msg__atts"
        >
          <template
            v-for="att in m.attachments"
            :key="att.id"
          >
            <a
              v-if="att.kind === 'image' && att.url"
              :href="att.url"
              target="_blank"
              rel="noopener"
              class="ob-msg__thumb"
            >
              <img
                :src="att.url"
                :alt="att.name"
              >
            </a>
            <span
              v-else
              class="ob-msg__file"
            >
              <FileText :size="13" />
              <span>{{ att.name }}</span>
            </span>
          </template>
        </div>
        <span
          v-if="m.content"
          class="ob-msg__text"
        >{{ m.content }}</span>
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
          :disabled="creating || uploading"
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

    <input
      ref="fileInput"
      class="ob__file-input"
      type="file"
      multiple
      :accept="ACCEPT"
      @change="onFilesPicked"
    >

    <div
      v-if="drafts.length"
      class="ob__files"
    >
      <div
        v-for="d in drafts"
        :key="d.key"
        class="ob-file"
      >
        <button
          type="button"
          class="ob-file__x"
          title="移除附件"
          :disabled="loading || creating"
          @click="removeDraft(d.key)"
        >
          <X :size="12" />
        </button>
        <img
          v-if="d.kind === 'image' && d.url"
          :src="d.url"
          class="ob-file__thumb"
          :alt="d.name"
        >
        <span
          v-else
          class="ob-file__ext"
        >{{ extOf(d.name) }}</span>
        <span class="ob-file__meta">
          <span class="ob-file__name">{{ d.name }}</span>
          <span class="ob-file__sub">{{ draftSub(d) }}</span>
        </span>
        <LoaderCircle
          v-if="d.uploading"
          :size="14"
          class="ob-file__spin"
        />
      </div>
    </div>

    <p
      v-if="uploadError"
      class="ob__error"
    >
      {{ uploadError }}
    </p>

    <form
      class="ob__inputbox"
      @submit.prevent="send"
    >
      <div class="ob__field">
        <button
          type="button"
          class="ob__attach"
          title="上传图片或文件（也可以拖进来、直接粘贴截图）"
          aria-label="上传图片或文件"
          :disabled="loading || creating"
          @click="openFilePicker"
        >
          <Paperclip :size="17" />
        </button>
        <input
          v-model="input"
          type="text"
          maxlength="2000"
          :placeholder="
            drafts.length ? '补充说明（可选），直接发送也可以…' : '说说你想学什么… 可上传图片或文件'
          "
          :disabled="loading || creating"
          @paste="onPaste"
        >
      </div>
      <button
        class="ob__send"
        type="submit"
        :disabled="!canSend"
      >
        发送
      </button>
    </form>
  </div>
</template>

<style scoped>
.ob {
  position: relative;
  margin-top: 16px;
  display: flex;
  flex: 1;
  min-height: 0;
  flex-direction: column;
  gap: 10px;
}
.ob--drag .ob__list {
  border-color: var(--primary);
  background: var(--primary-bg);
}
.ob__drop {
  position: absolute;
  inset: 0;
  z-index: 5;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px dashed var(--primary);
  border-radius: var(--r-md);
  background: rgb(var(--primary-rgb) / 10%);
  color: var(--primary-hover);
  font-size: 13px;
  font-weight: 600;
  pointer-events: none;
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
.ob-msg__atts {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 7px;
}
.ob-msg__thumb {
  display: block;
  line-height: 0;
}
.ob-msg__thumb img {
  display: block;
  max-width: 180px;
  max-height: 140px;
  border-radius: 8px;
  object-fit: cover;
  border: 1px solid rgb(255 255 255 / 28%);
}
.ob-msg--assistant .ob-msg__thumb img {
  border-color: var(--border);
}
.ob-msg__file {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  max-width: 220px;
  padding: 4px 10px;
  border-radius: var(--r-pill);
  background: rgb(255 255 255 / 16%);
  font-size: 12px;
}
.ob-msg__file span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ob-msg--assistant .ob-msg__file {
  background: var(--bg-subtle);
  border: 1px solid var(--border);
}
.ob-msg__text {
  display: block;
  white-space: pre-wrap;
}
/* 待发送附件 */
.ob__files {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.ob-file {
  position: relative;
  display: flex;
  align-items: center;
  gap: 8px;
  max-width: 100%;
  padding: 6px 26px 6px 7px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--bg-subtle);
}
.ob-file__thumb {
  flex: none;
  width: 34px;
  height: 34px;
  border-radius: 6px;
  object-fit: cover;
}
.ob-file__ext {
  flex: none;
  width: 34px;
  height: 34px;
  display: grid;
  place-items: center;
  border-radius: 6px;
  background: var(--primary-bg);
  color: var(--primary-hover);
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.02em;
}
.ob-file__meta {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}
.ob-file__name {
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  color: var(--text);
}
.ob-file__sub {
  font-size: 11px;
  color: var(--text-dim);
}
.ob-file__x {
  position: absolute;
  top: -6px;
  right: -6px;
  width: 18px;
  height: 18px;
  display: grid;
  place-items: center;
  padding: 0;
  border: 1px solid var(--border);
  border-radius: 50%;
  background: var(--bg);
  color: var(--text-dim);
  cursor: pointer;
  box-shadow: var(--shadow-xs);
}
.ob-file__x:hover:not(:disabled) {
  color: var(--mastery-red);
  border-color: var(--mastery-red);
}
.ob-file__spin {
  flex: none;
  color: var(--primary);
  animation: ob-spin 1s linear infinite;
}
@keyframes ob-spin {
  to {
    transform: rotate(360deg);
  }
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
.ob__field {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 2px;
  padding-left: 5px;
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  background: var(--bg);
  transition:
    border-color var(--dur-fast) var(--ease),
    box-shadow var(--dur-fast) var(--ease);
}
.ob__field:hover {
  border-color: var(--border-strong);
}
.ob__field:focus-within {
  border-color: var(--primary);
  box-shadow: var(--ring-primary);
}
.ob__attach {
  flex: none;
  width: 30px;
  height: 30px;
  display: grid;
  place-items: center;
  padding: 0;
  border: none;
  border-radius: 7px;
  background: transparent;
  color: var(--text-dim);
  cursor: pointer;
  transition:
    background var(--dur-fast) var(--ease),
    color var(--dur-fast) var(--ease);
}
.ob__attach:hover:not(:disabled) {
  background: var(--primary-bg);
  color: var(--primary-hover);
}
.ob__attach:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.ob__field input {
  flex: 1;
  min-width: 0;
  font: inherit;
  font-size: 13px;
  padding: 9px 8px 9px 4px;
  color: var(--text);
  border: none;
  background: transparent;
}
.ob__field input:focus {
  outline: none;
}
.ob__field input::placeholder {
  color: var(--text-dim);
}
.ob__field input:disabled {
  cursor: not-allowed;
}
.ob__file-input {
  display: none;
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
  .ob__field input {
    font-size: 16px;
  }
  .ob__attach {
    width: 34px;
    height: 34px;
  }
  .ob__send {
    height: 42px;
  }
  .ob-file__name {
    max-width: 150px;
  }
  .ob-msg__thumb img {
    max-width: 140px;
    max-height: 120px;
  }
  .ob-msg__file {
    max-width: 180px;
  }
}
</style>
