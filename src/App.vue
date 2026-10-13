<script setup lang="ts">
import { ref } from 'vue'
import { Heart, Settings } from 'lucide-vue-next'
import SettingsModal from '@/components/SettingsModal.vue'
import ToastHost from '@/components/ToastHost.vue'

const showSettings = ref(false)
</script>

<template>
  <div class="app">
    <header class="app-header">
      <div class="app-header__inner">
        <RouterLink
          to="/"
          class="app-brand"
        >
          <!-- 品牌标：三个节点 + 依赖边，呼应「知识图谱」 -->
          <svg
            class="app-brand__mark"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <rect
              width="24"
              height="24"
              rx="6"
              fill="currentColor"
            />
            <path
              d="M7.5 16.5 12 7.5l4.5 9"
              fill="none"
              stroke="#fff"
              stroke-width="1.6"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
            <circle
              cx="12"
              cy="7.5"
              r="2.1"
              fill="#fff"
            />
            <circle
              cx="7.5"
              cy="16.5"
              r="2.1"
              fill="#fff"
            />
            <circle
              cx="16.5"
              cy="16.5"
              r="2.1"
              fill="#fff"
            />
          </svg>
          <span class="app-title">hys-tutor</span>
          <span class="app-subtitle">AI 自适应私教</span>
        </RouterLink>
        <div class="app-actions">
          <RouterLink
            to="/preferences"
            class="app-settings"
            title="我的偏好"
          >
            <Heart :size="14" />
            偏好
          </RouterLink>
          <button
            class="app-settings"
            title="模型设置"
            @click="showSettings = true"
          >
            <Settings :size="14" />
            设置
          </button>
        </div>
      </div>
    </header>
    <main class="app-main">
      <RouterView />
    </main>
    <SettingsModal
      :open="showSettings"
      @close="showSettings = false"
    />
    <ToastHost />
  </div>
</template>

<style scoped>
.app {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}
.app-header {
  position: sticky;
  top: 0;
  z-index: var(--z-sticky);
  background: var(--bg);
  border-bottom: 1px solid var(--border);
}
.app-header__inner {
  max-width: var(--page-max);
  margin: 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: var(--header-h);
  padding: 0 var(--page-pad);
}
.app-brand {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  text-decoration: none;
}
.app-brand__mark {
  flex: none;
  width: 22px;
  height: 22px;
  color: var(--primary-btn);
}
.app-title {
  font-size: 14px;
  font-weight: 600;
  letter-spacing: -0.1px;
  color: var(--text);
}
.app-subtitle {
  font-size: 12px;
  color: var(--text-dim);
  padding-left: 10px;
  border-left: 1px solid var(--border);
}
.app-actions {
  display: flex;
  align-items: center;
  gap: 2px;
  /* 抵消按钮内边距，让文字右缘与内容区右缘对齐 */
  margin-right: -10px;
}
.app-settings {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font: inherit;
  font-size: 13px;
  color: var(--text-dim);
  background: none;
  border: 1px solid transparent;
  border-radius: 6px;
  padding: 5px 10px;
  cursor: pointer;
  text-decoration: none;
  transition:
    color var(--dur-fast) var(--ease),
    background var(--dur-fast) var(--ease),
    border-color var(--dur-fast) var(--ease);
}
.app-settings:hover {
  color: var(--text);
  background: var(--bg-muted);
}
.app-main {
  flex: 1;
}
</style>
