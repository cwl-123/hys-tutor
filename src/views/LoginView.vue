<script setup lang="ts">
import { ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { errMsg } from '@shared/error'

const auth = useAuthStore()
const router = useRouter()
const route = useRoute()

const nickname = ref('')
const password = ref('')
const busy = ref(false)
const error = ref<string | null>(null)

function nextPath(): string {
  const raw = route.query.next
  if (typeof raw === 'string' && raw.startsWith('/') && !raw.startsWith('//')) return raw
  return '/'
}

async function submit(): Promise<void> {
  if (busy.value) return
  error.value = null
  busy.value = true
  try {
    await auth.login(nickname.value, password.value)
    await router.replace(nextPath())
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
        登录 hys-tutor
      </h1>
      <p class="auth-sub">
        用昵称和密码继续你的学习
      </p>
      <form
        class="auth-form"
        @submit.prevent="submit"
      >
        <label class="auth-field">
          <span>昵称</span>
          <input
            v-model="nickname"
            type="text"
            autocomplete="username"
            maxlength="20"
            required
            autofocus
          >
        </label>
        <label class="auth-field">
          <span>密码</span>
          <input
            v-model="password"
            type="password"
            autocomplete="current-password"
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
          {{ busy ? '登录中…' : '登录' }}
        </button>
      </form>
      <p class="auth-switch">
        还没有账号？<RouterLink to="/register">
          用邀请码注册
        </RouterLink>
      </p>
      <p class="auth-legal">
        登录即表示你已阅读并同意
        <RouterLink to="/terms">
          用户协议
        </RouterLink>
        与
        <RouterLink to="/privacy">
          隐私政策
        </RouterLink>
      </p>
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
.auth-switch {
  margin: 18px 0 0;
  font-size: 13px;
  color: var(--text-dim);
  text-align: center;
}
.auth-switch a {
  color: var(--primary-btn);
  text-decoration: none;
}
.auth-legal {
  margin: 16px 0 0;
  font-size: 11px;
  line-height: 1.6;
  color: var(--text-faint, var(--text-dim));
  text-align: center;
}
.auth-legal a {
  color: inherit;
}
</style>
