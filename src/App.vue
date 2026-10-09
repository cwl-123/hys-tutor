<script setup lang="ts">
import { ref } from 'vue'
import SettingsModal from '@/components/SettingsModal.vue'

const showSettings = ref(false)
</script>

<template>
  <div class="app">
    <header class="app-header">
      <RouterLink
        to="/"
        class="app-title"
      >
        hys-tutor
      </RouterLink>
      <span class="app-subtitle">AI 自适应私教</span>
      <button
        class="app-settings"
        title="模型设置"
        @click="showSettings = true"
      >
        ⚙ 设置
      </button>
    </header>
    <main class="app-main">
      <RouterView />
    </main>
    <SettingsModal
      :open="showSettings"
      @close="showSettings = false"
    />
  </div>
</template>

<style scoped>
.app {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}
.app-header {
  display: flex;
  align-items: center;
  gap: 12px;
  height: var(--header-h);
  padding: 0 24px;
  border-bottom: 1px solid var(--border);
}
.app-title {
  font-size: 18px;
  font-weight: 700;
  color: var(--text);
  text-decoration: none;
}
.app-subtitle {
  font-size: 13px;
  color: var(--text-dim);
}
.app-settings {
  margin-left: auto;
  align-self: center;
  font: inherit;
  font-size: 13px;
  color: var(--text-dim);
  background: none;
  border: 1px solid transparent;
  border-radius: 8px;
  padding: 4px 10px;
  cursor: pointer;
}
.app-settings:hover {
  color: var(--text);
  border-color: var(--border);
  background: #fff;
}
.app-main {
  flex: 1;
}
</style>
