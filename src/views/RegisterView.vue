<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { errMsg } from '@shared/error'

const auth = useAuthStore()
const router = useRouter()

const inviteCode = ref('')
const nickname = ref('')
const password = ref('')
const confirm = ref('')
const accepted = ref(false)
const busy = ref(false)
const error = ref<string | null>(null)

const passwordMismatch = computed(
  () => confirm.value.length > 0 && password.value !== confirm.value,
)

async function submit(): Promise<void> {
  if (busy.value) return
  error.value = null
  if (password.value !== confirm.value) {
    error.value = '两次输入的密码不一致'
    return
  }
  if (!accepted.value) {
    error.value = '请先同意用户协议与隐私政策'
    return
  }
  busy.value = true
  try {
    await auth.register({
      inviteCode: inviteCode.value.trim().toUpperCase(),
      nickname: nickname.value.trim(),
      password: password.value,
      acceptedTerms: accepted.value,
    })
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
        用邀请码注册
      </h1>
      <p class="auth-sub">
        内测阶段凭邀请码开通，注册后即可开始学习
      </p>
      <form
        class="auth-form"
        @submit.prevent="submit"
      >
        <label class="auth-field">
          <span>邀请码</span>
          <input
            v-model="inviteCode"
            type="text"
            autocomplete="one-time-code"
            maxlength="32"
            placeholder="8 位字母数字"
            required
            autofocus
          >
        </label>
        <label class="auth-field">
          <span>昵称</span>
          <input
            v-model="nickname"
            type="text"
            autocomplete="username"
            maxlength="20"
            placeholder="2~20 位，登录时使用"
            required
          >
        </label>
        <label class="auth-field">
          <span>密码</span>
          <input
            v-model="password"
            type="password"
            autocomplete="new-password"
            maxlength="128"
            placeholder="至少 8 位"
            required
          >
        </label>
        <label class="auth-field">
          <span>确认密码</span>
          <input
            v-model="confirm"
            type="password"
            autocomplete="new-password"
            maxlength="128"
            required
          >
          <small
            v-if="passwordMismatch"
            class="auth-hint"
          > 两次输入的密码不一致 </small>
        </label>
        <label class="auth-check">
          <input
            v-model="accepted"
            type="checkbox"
          >
          <span>
            我已阅读并同意
            <RouterLink to="/terms">用户协议</RouterLink>
            与
            <RouterLink to="/privacy">隐私政策</RouterLink>
          </span>
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
          {{ busy ? '注册中…' : '注册并登录' }}
        </button>
      </form>
      <p class="auth-switch">
        已有账号？<RouterLink to="/login">
          直接登录
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
  max-width: 400px;
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
.auth-hint {
  color: var(--danger, #b42318);
}
.auth-check {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  font-size: 12px;
  line-height: 1.6;
  color: var(--text-dim);
}
.auth-check input {
  margin-top: 2px;
}
.auth-check a {
  color: var(--primary-btn);
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
  margin-top: 2px;
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

@media (max-width: 720px) {
  .auth-page {
    padding: 20px var(--page-pad) calc(32px + env(safe-area-inset-bottom));
  }
  .auth-card {
    padding: 24px 20px 20px;
  }
  .auth-field input {
    height: 44px;
    font-size: 16px;
  }
  .auth-submit {
    height: 44px;
  }
}
</style>
