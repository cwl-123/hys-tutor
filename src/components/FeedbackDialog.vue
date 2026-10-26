<script setup lang="ts">
import { ref, watch } from 'vue'
import { X } from 'lucide-vue-next'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()

const KINDS = [
  { k: 'bug', label: '功能异常' },
  { k: 'content', label: '内容有误' },
  { k: 'suggestion', label: '改进建议' },
  { k: 'other', label: '其他' },
] as const

const kind = ref<(typeof KINDS)[number]['k']>('suggestion')
const body = ref('')
const contact = ref('')
const sending = ref(false)
const error = ref<string | null>(null)
const done = ref(false)

watch(
  () => props.open,
  (open) => {
    if (!open) return
    kind.value = 'suggestion'
    body.value = ''
    contact.value = ''
    error.value = null
    done.value = false
    sending.value = false
  },
)

async function submit(): Promise<void> {
  error.value = null
  if (body.value.trim().length < 2) {
    error.value = '请至少写 2 个字'
    return
  }
  sending.value = true
  try {
    const res = await fetch('/api/feedback', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        kind: kind.value,
        body: body.value.trim(),
        contact: contact.value.trim() || undefined,
        page: window.location.pathname + window.location.search,
      }),
    })
    if (res.status === 401) {
      window.location.assign(`/login?next=${encodeURIComponent(window.location.pathname)}`)
      return
    }
    const data = (await res.json().catch(() => null)) as { error?: string } | null
    if (!res.ok) throw new Error(data?.error || `提交失败（${res.status}）`)
    done.value = true
  } catch (err) {
    error.value = err instanceof Error ? err.message : '提交失败'
  } finally {
    sending.value = false
  }
}
</script>

<template>
  <div
    v-if="open"
    class="fb-mask"
    @click.self="emit('close')"
  >
    <div
      class="fb"
      role="dialog"
      aria-modal="true"
      aria-labelledby="fb-title"
    >
      <header class="fb__head">
        <h2 id="fb-title">
          反馈
        </h2>
        <button
          class="fb__close"
          aria-label="关闭"
          @click="emit('close')"
        >
          <X :size="16" />
        </button>
      </header>

      <div
        v-if="done"
        class="fb__done"
      >
        <p>收到了，谢谢。我们会尽快处理。</p>
        <button
          class="fb__submit"
          @click="emit('close')"
        >
          关闭
        </button>
      </div>

      <form
        v-else
        class="fb__form"
        @submit.prevent="submit"
      >
        <div class="fb__kinds">
          <button
            v-for="item in KINDS"
            :key="item.k"
            type="button"
            class="fb__kind"
            :class="{ 'fb__kind--on': kind === item.k }"
            @click="kind = item.k"
          >
            {{ item.label }}
          </button>
        </div>

        <textarea
          v-model="body"
          class="fb__body"
          rows="5"
          maxlength="2000"
          placeholder="遇到了什么问题，或希望怎么改进？尽量写清页面和操作步骤。"
          autofocus
        />

        <input
          v-model="contact"
          class="fb__contact"
          maxlength="120"
          placeholder="联系方式（可选，方便我们回复你）"
        >

        <p
          v-if="error"
          class="fb__error"
        >
          {{ error }}
        </p>

        <div class="fb__foot">
          <span>{{ body.length }}/2000</span>
          <button
            class="fb__submit"
            type="submit"
            :disabled="sending || body.trim().length < 2"
          >
            {{ sending ? '提交中…' : '提交' }}
          </button>
        </div>
      </form>
    </div>
  </div>
</template>

<style scoped>
.fb-mask {
  position: fixed;
  inset: 0;
  z-index: 80;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  background: rgb(0 0 0 / 42%);
}
.fb {
  width: min(520px, 100%);
  padding: 18px 20px 16px;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: var(--bg);
  box-shadow: 0 18px 50px rgb(0 0 0 / 22%);
}
.fb__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}
.fb__head h2 {
  margin: 0;
  font-size: 15px;
}
.fb__close {
  display: inline-flex;
  padding: 4px;
  border: 0;
  border-radius: 6px;
  color: var(--text-dim);
  background: transparent;
  cursor: pointer;
}
.fb__close:hover {
  color: var(--text);
  background: var(--bg-muted);
}
.fb__kinds {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 10px;
}
.fb__kind {
  padding: 5px 10px;
  border: 1px solid var(--line);
  border-radius: 999px;
  color: var(--text-dim);
  font-size: 12px;
  background: transparent;
  cursor: pointer;
}
.fb__kind--on {
  border-color: var(--accent);
  color: var(--accent);
  background: var(--accent-soft);
}
.fb__body,
.fb__contact {
  box-sizing: border-box;
  width: 100%;
  padding: 9px 10px;
  border: 1px solid var(--line);
  border-radius: 7px;
  color: var(--text);
  font: inherit;
  font-size: 13px;
  background: var(--bg-muted);
  resize: vertical;
}
.fb__contact {
  margin-top: 8px;
  resize: none;
}
.fb__body:focus,
.fb__contact:focus {
  outline: 2px solid var(--accent-soft);
  border-color: var(--accent);
}
.fb__error {
  margin: 8px 0 0;
  color: #d64545;
  font-size: 12px;
}
.fb__foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 10px;
  color: var(--text-dim);
  font-size: 11px;
}
.fb__submit {
  padding: 7px 16px;
  border: 0;
  border-radius: 7px;
  color: #fff;
  font-size: 13px;
  background: var(--accent);
  cursor: pointer;
}
.fb__submit:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
.fb__done {
  padding: 18px 0 8px;
  text-align: center;
}
.fb__done p {
  margin: 0 0 16px;
  color: var(--text-dim);
  font-size: 13px;
}
</style>
