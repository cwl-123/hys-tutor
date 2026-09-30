<script setup lang="ts">
import { ref, watch } from 'vue'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()

const PRESET_MODELS = [
  'deepseek-v4.1-flash',
  'deepseek-v4-pro',
  'qwen3.8-max',
  'qwen3.8-flash',
  'glm-5.3',
  'grok-4.6',
]

const model = ref('')
const baseUrl = ref('')
const apiKey = ref('')
const apiKeyMasked = ref('')
const apiKeySource = ref('')
const saving = ref(false)
const message = ref<string | null>(null)
const messageError = ref(false)

watch(
  () => props.open,
  async (open) => {
    if (!open) return
    message.value = null
    apiKey.value = ''
    const res = await fetch('/api/settings')
    if (res.ok) {
      const data = (await res.json()) as {
        model: string
        baseUrl: string
        apiKeyMasked: string
        apiKeySource: string
      }
      model.value = data.model
      baseUrl.value = data.baseUrl
      apiKeyMasked.value = data.apiKeyMasked
      apiKeySource.value = data.apiKeySource
    }
  },
)

async function save() {
  saving.value = true
  message.value = null
  try {
    const res = await fetch('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: model.value,
        baseUrl: baseUrl.value,
        apiKey: apiKey.value || undefined,
      }),
    })
    const data = (await res.json()) as { error?: string; model: string; baseUrl: string; apiKeyMasked: string }
    if (!res.ok) throw new Error(data.error ?? `保存失败：${res.status}`)
    model.value = data.model
    baseUrl.value = data.baseUrl
    apiKeyMasked.value = data.apiKeyMasked
    apiKeySource.value = '页面设置'
    apiKey.value = ''
    messageError.value = false
    message.value = '已保存，后续调研/备课/批改立即使用新配置'
  } catch (err) {
    messageError.value = true
    message.value = err instanceof Error ? err.message : String(err)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="mask"
      @click.self="emit('close')"
    >
      <div class="modal">
        <header class="modal__header">
          <span>模型设置</span>
          <button
            class="modal__close"
            @click="emit('close')"
          >
            ×
          </button>
        </header>

        <label class="field">
          <span class="field__label">模型名称</span>
          <input
            v-model="model"
            type="text"
            list="preset-models"
            placeholder="如 deepseek-v4.1-flash"
          >
          <datalist id="preset-models">
            <option
              v-for="m in PRESET_MODELS"
              :key="m"
              :value="m"
            />
          </datalist>
        </label>

        <label class="field">
          <span class="field__label">API Base URL</span>
          <input
            v-model="baseUrl"
            type="text"
            placeholder="OpenAI 兼容地址，如 https://api.deepseek.com/v1"
          >
        </label>

        <label class="field">
          <span class="field__label">API Key</span>
          <input
            v-model="apiKey"
            type="password"
            :placeholder="apiKeyMasked ? `当前 ${apiKeyMasked}（留空保持不变）` : '未配置'"
          >
          <span class="field__hint">当前来源：{{ apiKeySource }}；key 仅存本地 data/settings.json</span>
        </label>

        <p
          v-if="message"
          class="modal__msg"
          :class="{ 'modal__msg--err': messageError }"
        >
          {{ message }}
        </p>

        <footer class="modal__footer">
          <button
            class="btn"
            @click="emit('close')"
          >
            关闭
          </button>
          <button
            class="btn btn--primary"
            :disabled="saving"
            @click="save"
          >
            {{ saving ? '保存中…' : '保存' }}
          </button>
        </footer>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.mask {
  position: fixed;
  inset: 0;
  z-index: 200;
  background: rgb(15 23 42 / 35%);
  display: flex;
  align-items: center;
  justify-content: center;
}
.modal {
  width: 460px;
  background: #fff;
  border-radius: 14px;
  padding: 22px 24px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  box-shadow: 0 20px 60px rgb(15 23 42 / 25%);
}
.modal__header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 16px;
  font-weight: 600;
}
.modal__close {
  border: none;
  background: none;
  font-size: 20px;
  line-height: 1;
  cursor: pointer;
  color: var(--text-dim);
}
.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.field__label {
  font-size: 12px;
  color: var(--text-dim);
}
.field input {
  font: inherit;
  font-size: 14px;
  padding: 9px 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
}
.field input:focus {
  outline: none;
  border-color: #3b82f6;
}
.field__hint {
  font-size: 11px;
  color: var(--text-dim);
}
.modal__msg {
  margin: 0;
  font-size: 13px;
  color: #15803d;
}
.modal__msg--err {
  color: var(--mastery-red);
}
.modal__footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
.btn {
  font: inherit;
  font-size: 13px;
  padding: 7px 16px;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: #fff;
  cursor: pointer;
}
.btn--primary {
  background: #3b82f6;
  border-color: #3b82f6;
  color: #fff;
}
.btn--primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
