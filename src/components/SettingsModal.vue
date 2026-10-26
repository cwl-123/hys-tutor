<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { X } from 'lucide-vue-next'
import { applyTheme, themePref } from '@/utils/theme'
import type { ThemePref } from '@/utils/theme'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()

const THEME_OPTIONS: { k: ThemePref; label: string }[] = [
  { k: 'auto', label: '跟随系统' },
  { k: 'light', label: '浅色' },
  { k: 'dark', label: '深色' },
]

interface PlatformSettings {
  mode: string
  effective: { model: string; providerName: string }
  search: { tavily: { hasKey: boolean }; bocha: { hasKey: boolean } }
}

const info = ref<PlatformSettings | null>(null)
const error = ref<string | null>(null)

// 检索状态以服务端实际 env 为准：两家都配 / 只配一家 / 都没配，页面文案不能一律说「已配置」
const searchHint = computed(() => {
  const s = info.value?.search
  if (!s) return '平台搜索服务配置状态加载中…'
  if (s.tavily.hasKey && s.bocha.hasKey) return '平台已配置 Tavily + 博查双路搜索。'
  if (s.tavily.hasKey || s.bocha.hasKey) {
    return `平台当前只配置了${s.tavily.hasKey ? ' Tavily' : '博查'}，检索覆盖有限。`
  }
  return '平台尚未配置搜索服务，课程将主要依赖模型自有知识，来源标注可能不完整；如需联网检索请联系管理员。'
})

watch(
  () => props.open,
  async (open) => {
    if (!open) return
    error.value = null
    try {
      const res = await fetch('/api/settings', { credentials: 'same-origin' })
      if (!res.ok) throw new Error(`加载失败（${res.status}）`)
      info.value = (await res.json()) as PlatformSettings
    } catch (err) {
      error.value = err instanceof Error ? err.message : '加载失败'
    }
  },
)
</script>

<template>
  <div
    v-if="open"
    class="modal-mask"
    @click.self="emit('close')"
  >
    <div
      class="modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-title"
    >
      <header class="modal-head">
        <h2 id="settings-title">
          设置
        </h2>
        <button
          class="icon-btn"
          aria-label="关闭"
          @click="emit('close')"
        >
          <X :size="16" />
        </button>
      </header>

      <section class="block">
        <h3>外观</h3>
        <div class="theme-row">
          <button
            v-for="opt in THEME_OPTIONS"
            :key="opt.k"
            class="theme-btn"
            :class="{ active: themePref === opt.k }"
            @click="applyTheme(opt.k)"
          >
            {{ opt.label }}
          </button>
        </div>
      </section>

      <section class="block">
        <h3>AI 模型</h3>
        <p
          v-if="error"
          class="muted"
        >
          {{ error }}
        </p>
        <template v-else-if="info">
          <p class="model-line">
            <span>{{ info.effective.providerName }}</span>
            <code>{{ info.effective.model }}</code>
          </p>
          <p class="muted">
            模型与密钥由平台统一配置，你无需填写 API Key。生成课程会消耗平台额度，
            每日次数见首页或顶栏。
          </p>
        </template>
        <p
          v-else
          class="muted"
        >
          加载中…
        </p>
      </section>

      <section class="block">
        <h3>联网检索</h3>
        <p class="muted">
          备课需要联网检索公开资料。
          {{ searchHint }}
        </p>
        <p
          v-if="info"
          class="muted"
        >
          Tavily：{{ info.search.tavily.hasKey ? '已配置' : '未配置' }} ·
          博查：{{ info.search.bocha.hasKey ? '已配置' : '未配置' }}
        </p>
      </section>

      <section class="block">
        <h3>数据与账号</h3>
        <p class="muted">
          学习数据仅用于为你生成课程与计算掌握度；退出登录不会删除数据。
          账号删除或数据导出请联系管理员。
        </p>
        <p class="muted">
          <RouterLink to="/terms">
            用户协议
          </RouterLink>
          ·
          <RouterLink to="/privacy">
            隐私政策
          </RouterLink>
        </p>
      </section>
    </div>
  </div>
</template>

<style scoped>
.modal-mask {
  position: fixed;
  inset: 0;
  z-index: var(--z-modal, 100);
  display: grid;
  place-items: center;
  padding: 24px;
  background: rgb(0 0 0 / 38%);
}
.modal {
  width: 100%;
  max-width: 460px;
  max-height: 86vh;
  overflow: auto;
  padding: 18px 20px 22px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 12px;
}
.modal-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
}
.modal-head h2 {
  margin: 0;
  font-size: 16px;
}
.icon-btn {
  display: inline-flex;
  padding: 5px;
  color: var(--text-dim);
  background: none;
  border: none;
  border-radius: 5px;
  cursor: pointer;
}
.icon-btn:hover {
  color: var(--text);
  background: var(--bg-muted);
}
.block {
  padding-top: 14px;
  margin-top: 14px;
  border-top: 1px solid var(--border);
}
.block h3 {
  margin: 0 0 8px;
  font-size: 13px;
  font-weight: 600;
}
.theme-row {
  display: flex;
  gap: 8px;
}
.theme-btn {
  flex: 1;
  height: 32px;
  font: inherit;
  font-size: 12px;
  color: var(--text-dim);
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  cursor: pointer;
}
.theme-btn.active {
  color: var(--primary-btn);
  border-color: var(--primary-btn);
  background: color-mix(in srgb, var(--primary-btn) 8%, transparent);
}
.model-line {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 0 6px;
  font-size: 13px;
}
.model-line code {
  padding: 2px 6px;
  font-size: 12px;
  background: var(--bg-muted);
  border-radius: 4px;
}
.muted {
  margin: 0 0 6px;
  font-size: 12px;
  line-height: 1.7;
  color: var(--text-dim);
}
.muted a {
  color: var(--primary-btn);
}
</style>
