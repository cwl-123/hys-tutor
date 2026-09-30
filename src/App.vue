<script setup lang="ts"></script>

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
    </header>
    <main class="app-main">
      <RouterView />
    </main>
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
  align-items: baseline;
  gap: 12px;
  padding: 12px 24px;
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
.app-main {
  flex: 1;
}
</style>
