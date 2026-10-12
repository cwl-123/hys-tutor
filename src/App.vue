<script setup lang="ts">
import { ref } from 'vue'
import { GraduationCap, Heart, Settings } from 'lucide-vue-next'
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
          <span class="app-brand__mark"><GraduationCap :size="15" /></span>
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
  background: color-mix(in srgb, var(--bg) 82%, transparent);
  backdrop-filter: saturate(180%) blur(12px);
  -webkit-backdrop-filter: saturate(180%) blur(12px);
  border-bottom: 1px solid var(--border);
}
.app-header__inner {
  max-width: 1240px;
  margin: 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: var(--header-h);
  padding: 0 24px;
}
.app-brand {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  text-decoration: none;
}
.app-brand__mark {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 7px;
  color: var(--bg);
  background: var(--text);
}
.app-title {
  font-size: 15px;
  font-weight: 700;
  letter-spacing: 0.1px;
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
  gap: 4px;
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
  border-radius: var(--r-sm);
  padding: 6px 12px;
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
