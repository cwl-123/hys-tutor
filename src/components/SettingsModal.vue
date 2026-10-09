<script setup lang="ts">
import { ref, watch } from 'vue'
import { Download, Eye, EyeOff, Pencil, Plus, Trash2, X } from 'lucide-vue-next'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()

const PRESET_MODELS = [
  'deepseek-v4-pro',
  'deepseek-v4.1-flash',
  'qwen3.8-max',
  'qwen3.8-flash',
  'glm-5.3',
  'grok-4.6',
  'kimi-k3',
  'claude-fable-5-1',
  'gpt-6-astra',
]

interface UiProvider {
  id?: string
  name: string
  baseUrl: string
  model: string
  apiKey: string
  hasKey: boolean
}

interface SettingsView {
  providers: { id: string; name: string; baseUrl: string; model: string; apiKey: string; hasKey: boolean }[]
  activeProviderId: string
  effective: { model: string; baseUrl: string; providerName: string; source: string }
  search: {
    tavily: { apiKey: string; hasKey: boolean }
    bocha: { apiKey: string; hasKey: boolean }
  }
}

interface ImportCandidate {
  id: string
  source: string
  name: string
  baseUrl?: string
  model: string
  models: string[]
  apiKeyMasked: string
}

const providers = ref<UiProvider[]>([])
const activeId = ref('') // '' = 未选激活源，使用默认配置
const effective = ref<SettingsView['effective'] | null>(null)

// 编辑表单：null = 关闭；editingIndex = -1 表示新增
const editing = ref<UiProvider | null>(null)
const editingIndex = ref(-1)

const saving = ref(false)
const message = ref<string | null>(null)
const messageError = ref(false)

// 本机 AI 工具配置导入
const candidates = ref<ImportCandidate[] | null>(null)
const candidatesLoading = ref(false)
const importingId = ref<string | null>(null)

// 搜索 API Key（回填真实值，眼睛图标切换明文/掩码）
const tavilyKeyInput = ref('')
const bochaKeyInput = ref('')

// Key 明文显示开关
const showEditKey = ref(false)
const showTavilyKey = ref(false)
const showBochaKey = ref(false)

watch(
  () => props.open,
  async (open) => {
    if (!open) return
    message.value = null
    editing.value = null
    candidates.value = null
    showEditKey.value = false
    showTavilyKey.value = false
    showBochaKey.value = false
    await reload()
  },
)

async function reload() {
  const res = await fetch('/api/settings')
  if (!res.ok) return
  const data = (await res.json()) as SettingsView
  providers.value = data.providers.map((p) => ({
    id: p.id,
    name: p.name,
    baseUrl: p.baseUrl,
    model: p.model,
    apiKey: p.apiKey,
    hasKey: p.hasKey,
  }))
  activeId.value = data.activeProviderId
  effective.value = data.effective
  tavilyKeyInput.value = data.search.tavily.apiKey
  bochaKeyInput.value = data.search.bocha.apiKey
}

function startAdd() {
  editingIndex.value = -1
  editing.value = { name: '', baseUrl: '', model: '', apiKey: '', hasKey: false }
}

function startEdit(index: number) {
  editingIndex.value = index
  editing.value = { ...providers.value[index] }
}

function commitEdit() {
  if (!editing.value) return
  if (editingIndex.value === -1) providers.value = [...providers.value, editing.value]
  else {
    providers.value = providers.value.map((p, i) => (i === editingIndex.value ? editing.value! : p))
  }
  editing.value = null
}

function removeProvider(index: number) {
  const removed = providers.value[index]
  providers.value = providers.value.filter((_, i) => i !== index)
  if (removed.id && activeId.value === removed.id) activeId.value = ''
  if (editingIndex.value === index) editing.value = null
}

async function loadCandidates() {
  if (candidates.value !== null) {
    candidates.value = null
    return
  }
  candidatesLoading.value = true
  try {
    const res = await fetch('/api/settings/import-candidates')
    if (!res.ok) throw new Error(`扫描失败：${res.status}`)
    const data = (await res.json()) as { candidates: ImportCandidate[] }
    candidates.value = data.candidates
  } catch (err) {
    messageError.value = true
    message.value = err instanceof Error ? err.message : String(err)
  } finally {
    candidatesLoading.value = false
  }
}

async function doImport(c: ImportCandidate) {
  importingId.value = c.id
  message.value = null
  messageError.value = false
  try {
    const res = await fetch('/api/settings/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: c.id }),
    })
    const data = (await res.json()) as SettingsView & { error?: string }
    if (!res.ok) throw new Error(data.error ?? `导入失败：${res.status}`)
    candidates.value = null
    await reload()
    message.value = `已导入并保存「${c.name}」，选中单选框即可设为激活源`
  } catch (err) {
    messageError.value = true
    message.value = err instanceof Error ? err.message : String(err)
  } finally {
    importingId.value = null
  }
}

async function save() {
  saving.value = true
  message.value = null
  messageError.value = false
  try {
    const res = await fetch('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        providers: providers.value.map((p) => ({
          id: p.id,
          name: p.name,
          baseUrl: p.baseUrl || undefined,
          model: p.model,
          apiKey: p.apiKey,
        })),
        activeProviderId: activeId.value || null,
        search: {
          tavilyKey: tavilyKeyInput.value,
          bochaKey: bochaKeyInput.value,
        },
      }),
    })
    const data = (await res.json()) as SettingsView & { error?: string }
    if (!res.ok) throw new Error(data.error ?? `保存失败：${res.status}`)
    await reload()
    message.value = '已保存，后续调研/备课/批改立即使用激活源'
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
            title="关闭"
            @click="emit('close')"
          >
            <X :size="17" />
          </button>
        </header>

        <p
          v-if="effective"
          class="modal__effective"
        >
          当前生效：<strong>{{ effective.model || '（未配置）' }}</strong>
          <span
            v-if="effective.model"
            class="modal__effective-src"
          >{{ effective.providerName }}</span>
        </p>

        <!-- 模型源列表 -->
        <div class="providers">
          <label
            v-for="(p, i) in providers"
            :key="p.id ?? `new-${i}`"
            class="provider"
            :class="{ 'provider--active': activeId === p.id }"
          >
            <input
              v-model="activeId"
              type="radio"
              :value="p.id ?? ''"
              :disabled="!p.id"
              name="active-provider"
            >
            <span class="provider__main">
              <span class="provider__name">
                {{ p.name }}
                <em
                  v-if="!p.hasKey"
                  class="provider__warn"
                >缺 Key</em>
              </span>
              <span class="provider__model">{{ p.model }}</span>
            </span>
            <span class="provider__ops">
              <button
                type="button"
                title="编辑"
                @click.prevent="startEdit(i)"
              >
                <Pencil :size="13" />
              </button>
              <button
                type="button"
                title="删除"
                @click.prevent="removeProvider(i)"
              >
                <Trash2 :size="13" />
              </button>
            </span>
          </label>

          <button
            type="button"
            class="provider provider--add"
            @click="startAdd"
          >
            <Plus :size="14" />
            添加模型源
          </button>

          <button
            type="button"
            class="provider provider--add"
            :disabled="candidatesLoading"
            @click="loadCandidates"
          >
            <Download :size="14" />
            {{ candidatesLoading ? '扫描中…' : candidates !== null ? '收起导入列表' : '从本机 AI 工具导入（OpenCode / Codex / Claude Code）' }}
          </button>

          <div
            v-if="candidates !== null"
            class="candidates"
          >
            <p
              v-if="candidates.length === 0"
              class="candidates__empty"
            >
              未发现可导入的配置（需要本机 OpenCode / Codex / Claude Code 中已配置 API Key）
            </p>
            <div
              v-for="c in candidates"
              :key="c.id"
              class="candidate"
            >
              <span class="candidate__main">
                <span class="candidate__name">
                  <em class="candidate__src">{{ c.source }}</em>
                  {{ c.name }}
                </span>
                <span class="candidate__model">{{ c.model || '（未指定模型）' }} · {{ c.apiKeyMasked }}</span>
              </span>
              <button
                type="button"
                class="btn btn--primary candidate__import"
                :disabled="importingId !== null"
                @click="doImport(c)"
              >
                {{ importingId === c.id ? '导入中…' : '导入' }}
              </button>
            </div>
          </div>
        </div>

        <!-- 搜索 API Key -->
        <div class="search-keys">
          <p class="search-keys__title">
            搜索 API（备课联网研究用，双路互为备份）
          </p>
          <div class="edit__row">
            <label class="field">
              <span class="field__label">
                Tavily Key
                <a
                  class="field__link"
                  href="https://tavily.com"
                  target="_blank"
                  rel="noopener"
                >申请 →</a>
              </span>
              <span class="key-field">
                <input
                  v-model="tavilyKeyInput"
                  :type="showTavilyKey ? 'text' : 'password'"
                >
                <button
                  type="button"
                  class="key-field__eye"
                  :title="showTavilyKey ? '隐藏' : '显示'"
                  @click="showTavilyKey = !showTavilyKey"
                >
                  <Eye
                    v-if="showTavilyKey"
                    :size="15"
                  />
                  <EyeOff
                    v-else
                    :size="15"
                  />
                </button>
              </span>
            </label>
            <label class="field">
              <span class="field__label">
                博查 Key
                <a
                  class="field__link"
                  href="https://open.bochaai.com"
                  target="_blank"
                  rel="noopener"
                >申请 →</a>
              </span>
              <span class="key-field">
                <input
                  v-model="bochaKeyInput"
                  :type="showBochaKey ? 'text' : 'password'"
                >
                <button
                  type="button"
                  class="key-field__eye"
                  :title="showBochaKey ? '隐藏' : '显示'"
                  @click="showBochaKey = !showBochaKey"
                >
                  <Eye
                    v-if="showBochaKey"
                    :size="15"
                  />
                  <EyeOff
                    v-else
                    :size="15"
                  />
                </button>
              </span>
            </label>
          </div>
        </div>

        <!-- 编辑表单 -->
        <div
          v-if="editing"
          class="edit"
        >
          <div class="edit__row">
            <label class="field">
              <span class="field__label">名称</span>
              <input
                v-model="editing.name"
                type="text"
                placeholder="如：阿里百炼 / DeepSeek 官方"
              >
            </label>
            <label class="field">
              <span class="field__label">模型</span>
              <input
                v-model="editing.model"
                type="text"
                list="preset-models"
                placeholder="如 deepseek-v4.1-flash"
              >
            </label>
          </div>
          <label class="field">
            <span class="field__label">API Base URL</span>
            <input
              v-model="editing.baseUrl"
              type="text"
              placeholder="OpenAI 兼容地址，留空用 SDK 默认"
            >
          </label>
          <label class="field">
            <span class="field__label">API Key</span>
            <span class="key-field">
              <input
                v-model="editing.apiKey"
                :type="showEditKey ? 'text' : 'password'"
                placeholder="sk-..."
              >
              <button
                type="button"
                class="key-field__eye"
                :title="showEditKey ? '隐藏' : '显示'"
                @click="showEditKey = !showEditKey"
              >
                <Eye
                  v-if="showEditKey"
                  :size="15"
                />
                <EyeOff
                  v-else
                  :size="15"
                />
              </button>
            </span>
          </label>
          <datalist id="preset-models">
            <option
              v-for="m in PRESET_MODELS"
              :key="m"
              :value="m"
            />
          </datalist>
          <div class="edit__actions">
            <button
              class="btn"
              @click="editing = null"
            >
              取消
            </button>
            <button
              class="btn btn--primary"
              :disabled="!editing.name.trim() || !editing.model.trim()"
              @click="commitEdit"
            >
              确定
            </button>
          </div>
        </div>

        <p
          v-if="message"
          class="modal__msg"
          :class="{ 'modal__msg--err': messageError }"
        >
          {{ message }}
        </p>

        <footer class="modal__footer">
          <span class="modal__hint">配置仅保存在本机</span>
          <div class="modal__buttons">
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
              {{ saving ? '保存中…' : '保存并生效' }}
            </button>
          </div>
        </footer>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.modal {
  width: 560px;
  max-height: 86vh;
  overflow-y: auto;
  background: var(--bg);
  border-radius: var(--r-lg);
  padding: 22px 24px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  box-shadow: var(--shadow-xl);
}
.modal__header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 16px;
  font-weight: 600;
}
.modal__close {
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
.modal__close:hover {
  color: var(--text);
  background: var(--bg-muted);
}
.modal__effective {
  margin: 0;
  font-size: 13px;
  color: var(--text-dim);
  background: var(--bg-subtle);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 8px 12px;
}
.modal__effective strong {
  color: var(--text);
}
.modal__effective-src {
  margin-left: 8px;
  font-size: 12px;
}
.providers {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.provider {
  display: flex;
  align-items: center;
  gap: 10px;
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 10px 12px;
  cursor: pointer;
}
.provider--active {
  border-color: var(--primary);
  background: var(--primary-bg);
}
.provider--add {
  justify-content: center;
  gap: 6px;
  border-style: dashed;
  color: var(--text-dim);
  font-size: 13px;
  background: none;
  font-family: inherit;
}
.provider--add:hover {
  color: var(--primary-hover);
  border-color: var(--primary-soft);
}
.candidates {
  display: flex;
  flex-direction: column;
  gap: 6px;
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 10px;
  background: var(--bg-subtle);
}
.candidates__empty {
  margin: 0;
  font-size: 12px;
  color: var(--text-dim);
}
.candidate {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 8px;
  border-radius: 8px;
  background: #fff;
  border: 1px solid var(--border);
}
.candidate__main {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
  min-width: 0;
}
.candidate__name {
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
}
.candidate__src {
  font-style: normal;
  font-size: 11px;
  font-weight: 500;
  color: var(--primary-hover);
  background: var(--primary-bg);
  border-radius: 4px;
  padding: 1px 6px;
  margin-right: 6px;
}
.candidate__model {
  font-size: 12px;
  color: var(--text-dim);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.candidate__import {
  flex-shrink: 0;
  padding: 5px 12px;
}
.search-keys {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.search-keys__title {
  margin: 0;
  font-size: 12px;
  color: var(--text-dim);
}
.field__link {
  margin-left: 6px;
  color: var(--primary);
  text-decoration: none;
}
.field__link:hover {
  text-decoration: underline;
}
.provider__main {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
  min-width: 0;
}
.provider__name {
  font-size: 14px;
  font-weight: 600;
  color: var(--text);
}
.provider__warn {
  font-style: normal;
  font-size: 11px;
  color: var(--amber-text);
  background: var(--amber-bg);
  border-radius: 4px;
  padding: 1px 6px;
  margin-left: 6px;
}
.provider__model {
  font-size: 12px;
  color: var(--text-dim);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.provider__ops {
  display: flex;
  gap: 4px;
}
.provider__ops button {
  display: inline-flex;
  align-items: center;
  border: none;
  background: none;
  cursor: pointer;
  color: var(--text-dim);
  padding: 5px;
  border-radius: 6px;
  transition:
    color var(--dur-fast) var(--ease),
    background var(--dur-fast) var(--ease);
}
.provider__ops button:hover {
  color: var(--text);
  background: var(--bg-muted);
}
.edit {
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  background: var(--bg-subtle);
}
.edit__row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.field__label {
  font-size: 12px;
  color: var(--text-dim);
}
.field input {
  font: inherit;
  font-size: 13px;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
}
.field input:focus {
  outline: none;
  border-color: var(--primary);
}
.key-field {
  position: relative;
  display: flex;
}
.key-field input {
  flex: 1;
  padding-right: 32px;
}
.key-field__eye {
  position: absolute;
  right: 6px;
  top: 50%;
  transform: translateY(-50%);
  border: none;
  background: none;
  cursor: pointer;
  color: var(--text-dim);
  padding: 2px;
  display: flex;
  align-items: center;
}
.key-field__eye svg {
  width: 15px;
  height: 15px;
}
.key-field__eye:hover {
  color: var(--text);
}
.edit__actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
.modal__msg {
  margin: 0;
  font-size: 13px;
  color: var(--green-hover);
}
.modal__msg--err {
  color: var(--mastery-red);
}
.modal__footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
}
.modal__hint {
  font-size: 11px;
  color: var(--text-dim);
}
.modal__buttons {
  display: flex;
  gap: 8px;
}
</style>
