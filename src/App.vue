<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { Heart, LogOut, Settings, Shield } from 'lucide-vue-next'
import SettingsModal from '@/components/SettingsModal.vue'
import FeedbackDialog from '@/components/FeedbackDialog.vue'
import ToastHost from '@/components/ToastHost.vue'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()
const router = useRouter()
const showSettings = ref(false)
const showFeedback = ref(false)

const lessonQuota = computed(() => auth.usage?.actions.lesson ?? null)

async function logout(): Promise<void> {
  await auth.logout()
  await router.replace('/login')
}
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
          <template v-if="auth.user">
            <span
              v-if="lessonQuota"
              class="app-quota"
              :title="`今日生成课程 ${lessonQuota.used}/${lessonQuota.limit} 次`"
            >
              <span class="app-quota__label">AI 生成 </span>{{ lessonQuota.used }}/{{ lessonQuota.limit }}
            </span>
            <RouterLink
              to="/preferences"
              class="app-settings"
              title="我的偏好"
              aria-label="我的偏好"
            >
              <Heart :size="15" />
              <span class="app-action__label">偏好</span>
            </RouterLink>
            <RouterLink
              v-if="auth.isAdmin"
              to="/admin"
              class="app-settings"
              title="内测管理"
              aria-label="内测管理"
            >
              <Shield :size="15" />
              <span class="app-action__label">管理</span>
            </RouterLink>
            <button
              class="app-settings"
              title="平台设置"
              aria-label="平台设置"
              @click="showSettings = true"
            >
              <Settings :size="15" />
              <span class="app-action__label">设置</span>
            </button>
            <span class="app-user">{{ auth.user.nickname }}</span>
            <button
              class="app-settings"
              title="退出登录"
              aria-label="退出登录"
              @click="logout"
            >
              <LogOut :size="15" />
              <span class="app-action__label">退出</span>
            </button>
          </template>
          <RouterLink
            v-else
            to="/login"
            class="app-settings"
          >
            登录
          </RouterLink>
        </div>
      </div>
    </header>
    <main class="app-main">
      <RouterView />
    </main>
    <footer class="app-footer">
      <span>课程与批改内容由 AI 生成，仅供参考，请自行核实。</span>
      <span class="app-footer__links">
        <button
          v-if="auth.user"
          class="app-footer__feedback"
          @click="showFeedback = true"
        >
          反馈
        </button>
        <RouterLink to="/terms">用户协议</RouterLink>
        <RouterLink to="/privacy">隐私政策</RouterLink>
      </span>
    </footer>
    <SettingsModal
      :open="showSettings"
      @close="showSettings = false"
    />
    <FeedbackDialog
      :open="showFeedback"
      @close="showFeedback = false"
    />
    <ToastHost />
  </div>
</template>

<style scoped>
.app {
  /* 手机浏览器地址栏会吃掉 vh，dvh 可取真实可视高度（旧浏览器回退到 vh） */
  min-height: 100vh;
  min-height: 100dvh;
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
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  height: var(--header-h);
  padding-left: max(var(--page-pad), env(safe-area-inset-left));
  padding-right: max(var(--page-pad), env(safe-area-inset-right));
}
.app-brand {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  /* 品牌可被压缩：空间不够时优先截断品牌，而不是把右侧按钮挤成竖排文字 */
  flex: 0 1 auto;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-decoration: none;
}
.app-brand__mark {
  flex: none;
  width: 22px;
  height: 22px;
  color: var(--primary-btn);
}
.app-title {
  flex: 0 1 auto;
  min-width: 0;
  overflow: hidden;
  font-size: 14px;
  font-weight: 600;
  letter-spacing: -0.1px;
  color: var(--text);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.app-subtitle {
  flex: none;
  font-size: 12px;
  color: var(--text-dim);
  padding-left: 10px;
  border-left: 1px solid var(--border);
  white-space: nowrap;
}
.app-actions {
  display: flex;
  align-items: center;
  flex: none;
  gap: 2px;
  margin-left: auto;
  white-space: nowrap;
  /* 抵消按钮内边距，让文字右缘与内容区右缘对齐 */
  margin-right: -10px;
}
.app-settings {
  display: inline-flex;
  align-items: center;
  flex: none;
  gap: 5px;
  font: inherit;
  font-size: 13px;
  white-space: nowrap;
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
.app-user {
  flex: 0 1 auto;
  min-width: 0;
  max-width: 120px;
  overflow: hidden;
  margin: 0 4px 0 8px;
  font-size: 13px;
  color: var(--text);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.app-quota {
  flex: none;
  margin-right: 4px;
  font-size: 11px;
  color: var(--text-dim);
  white-space: nowrap;
}
.app-footer {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 16px;
  align-items: center;
  justify-content: center;
  padding: 18px var(--page-pad) 22px;
  font-size: 11px;
  color: var(--text-dim);
  border-top: 1px solid var(--border);
}
.app-footer__links {
  display: inline-flex;
  gap: 12px;
}
.app-footer a,
.app-footer__feedback {
  padding: 0;
  border: 0;
  color: inherit;
  font: inherit;
  text-decoration: none;
  background: transparent;
  cursor: pointer;
}
.app-footer__feedback:hover,
.app-footer a:hover {
  color: var(--text);
}

/* ---------- 顶栏响应式 ----------
 * 按可用宽度逐级收敛：品牌块可压缩、操作区永不收缩，
 * 任何宽度都不会把按钮文字挤成竖排（旧版在窄屏会把「偏好/管理」竖着排）。
 * 收敛顺序：副标题 → 昵称/配额说明 → 按钮文案 → 触控尺寸。
 */
@media (max-width: 1120px) {
  .app-header__inner {
    gap: 12px;
  }
  .app-actions {
    gap: 0;
  }
  .app-settings {
    padding: 5px 8px;
  }
}
@media (max-width: 960px) {
  .app-subtitle {
    display: none;
  }
}
@media (max-width: 860px) {
  /* 昵称长度不可控，优先让位给功能按钮 */
  .app-user {
    display: none;
  }
}
/* 手机：操作区图标化，保持顶栏单行 */
@media (max-width: 720px) {
  .app-header__inner {
    gap: 10px;
    padding-left: max(12px, env(safe-area-inset-left));
    padding-right: max(12px, env(safe-area-inset-right));
  }
  .app-brand {
    gap: 8px;
  }
  .app-title {
    font-size: 15px;
  }
  .app-brand__mark {
    width: 24px;
    height: 24px;
  }
  .app-quota {
    display: none;
  }
  .app-actions {
    gap: 2px;
    margin-right: -7px;
  }
  .app-settings {
    justify-content: center;
    width: 38px;
    height: 38px;
    padding: 0;
    border-radius: 8px;
  }
  .app-action__label {
    display: none;
  }
  .app-footer {
    gap: 8px 14px;
    padding: 16px var(--page-pad) calc(18px + env(safe-area-inset-bottom));
    line-height: 1.6;
    text-align: center;
  }
}
/* 超窄屏（320px 及以下）：再压一档，5 个操作仍能单行 */
@media (max-width: 360px) {
  .app-header__inner {
    gap: 8px;
    padding-left: max(10px, env(safe-area-inset-left));
    padding-right: max(10px, env(safe-area-inset-right));
  }
  .app-settings {
    width: 34px;
    height: 34px;
  }
  .app-title {
    font-size: 14px;
  }
  .app-brand__mark {
    width: 22px;
    height: 22px;
  }
}
</style>
