<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { errMsg } from '@shared/error'

const auth = useAuthStore()
const router = useRouter()

const oldPassword = ref('')
const newPassword = ref('')
const confirm = ref('')
const busy = ref(false)
const error = ref<string | null>(null)

async function submit(): Promise<void> {
  if (busy.value) return
  error.value = null
  if (newPassword.value !== confirm.value) {
    error.value = '两次输入的新密码不一致'
    return
  }
  busy.value = true
  try {
    await auth.changePassword(oldPassword.value, newPassword.value)
    await router.replace('/')
  } catch (err) {
    error.value = errMsg(err)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="auth-page">
    <div class="auth-card">
      <h1 class="auth-title">
        修改密码
      </h1>
      <p class="auth-sub">
        你正在使用临时密码，修改后才能继续使用全部功能
      </p>
      <form
        class="auth-form"
        @submit.prevent="submit"
      >
        <label class="auth-field">
          <span>当前密码</span>
          <input
            v-model="oldPassword"
            type="password"
            autocomplete="current-password"
            required
            autofocus
          >
        </label>
        <label class="auth-field">
          <span>新密码</span>
          <input
            v-model="newPassword"
            type="password"
            autocomplete="new-password"
            minlength="8"
            maxlength="128"
            placeholder="至少 8 位"
            required
          >
        </label>
        <label class="auth-field">
          <span>确认新密码</span>
          <input
            v-model="confirm"
            type="password"
            autocomplete="new-password"
            minlength="8"
            maxlength="128"
            required
          >
        </label>
        <p
          v-if="error"
          class="auth-error"
        >
          {{ error }}
        </p>
        <button
          class="auth-submit"
          type="submit"
          :disabled="busy"
        >
          {{ busy ? '保存中…' : '保存新密码' }}
        </button>
      </form>
    </div>
  </div>
</template>

<style scoped>
.auth-page {
  min-height: calc(100vh - var(--header-h));
  display: grid;
  place-items: center;
  padding: 32px var(--page-pad);
}
.auth-card {
  width: 100%;
  max-width: 380px;
  padding: 30px 28px 24px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--bg);
}
.auth-title {
  margin: 0;
  font-size: 20px;
  font-weight: 650;
  color: var(--text);
}
.auth-sub {
  margin: 6px 0 22px;
  font-size: 13px;
  line-height: 1.6;
  color: var(--text-dim);
}
.auth-form {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.auth-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 12px;
  color: var(--text-dim);
}
.auth-field input {
  height: 38px;
  padding: 0 11px;
  font: inherit;
  font-size: 14px;
  color: var(--text);
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 7px;
  outline: none;
}
.auth-field input:focus {
  border-color: var(--primary-btn);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--primary-btn) 14%, transparent);
}
.auth-error {
  margin: 0;
  padding: 8px 10px;
  font-size: 12px;
  color: var(--danger, #b42318);
  background: color-mix(in srgb, var(--danger, #b42318) 8%, transparent);
  border-radius: 6px;
}
.auth-submit {
  height: 40px;
  margin-top: 4px;
  font: inherit;
  font-size: 14px;
  font-weight: 550;
  color: #fff;
  background: var(--primary-btn);
  border: none;
  border-radius: 7px;
  cursor: pointer;
}
.auth-submit:disabled {
  opacity: 0.6;
  cursor: default;
}
</style>
