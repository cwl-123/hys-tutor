<script setup lang="ts">
import { toasts } from '@/utils/toast'
</script>

<template>
  <div class="toast-host">
    <div
      v-for="t in toasts"
      :key="t.id"
      class="toast-host__item"
    >
      {{ t.text }}
    </div>
  </div>
</template>

<style scoped>
.toast-host {
  position: fixed;
  top: calc(var(--header-h) + 12px);
  left: 50%;
  transform: translateX(-50%);
  z-index: var(--z-toast);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  pointer-events: none;
}
.toast-host__item {
  max-width: 480px;
  padding: 9px 18px;
  border-radius: var(--r-pill);
  background: var(--text);
  color: #fff;
  font-size: 13px;
  line-height: 1.5;
  box-shadow: var(--shadow-lg);
  animation: toast-in var(--dur) var(--ease);
}
</style>
