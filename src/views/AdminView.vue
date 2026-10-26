<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { errMsg } from '@shared/error'

interface AdminUser {
  id: string
  nickname: string
  role: string
  status: string
  createdAt: string
  lastLoginAt: string | null
}

interface FeedbackRow {
  id: string
  nickname: string | null
  kind: string
  page: string | null
  body: string
  contact: string | null
  status: string
  createdAt: string
}

interface Stats {
  users: number
  activeSessions: number
  spendToday: { costCny: number; budgetCny: number; overBudget: boolean }
}

const users = ref<AdminUser[]>([])
const feedback = ref<FeedbackRow[]>([])
const stats = ref<Stats | null>(null)
const loading = ref(true)
const error = ref<string | null>(null)
const notice = ref<string | null>(null)

const inviteCount = ref(5)
const inviteDays = ref(7)
const generating = ref(false)
const generated = ref<{ code: string; expiresAt: string }[]>([])

async function request<T>(url: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(url, {
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
  const text = await res.text()
  let data: unknown = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = null
  }
  if (!res.ok)
    throw new Error((data as { error?: string } | null)?.error || `请求失败（${res.status}）`)
  return data as T
}

async function reload(): Promise<void> {
  loading.value = true
  error.value = null
  try {
    const [u, s, f] = await Promise.all([
      request<{ users: AdminUser[] }>('/api/admin/users'),
      request<Stats>('/api/admin/stats'),
      request<{ feedback: FeedbackRow[] }>('/api/admin/feedback'),
    ])
    users.value = u.users
    stats.value = s
    feedback.value = f.feedback
  } catch (err) {
    error.value = errMsg(err)
  } finally {
    loading.value = false
  }
}

async function generateInvites(): Promise<void> {
  generating.value = true
  notice.value = null
  error.value = null
  try {
    const data = await request<{ invites: { code: string; expiresAt: string }[] }>(
      '/api/admin/invites',
      {
        method: 'POST',
        body: JSON.stringify({ count: inviteCount.value, days: inviteDays.value }),
      },
    )
    generated.value = [...data.invites, ...generated.value]
    notice.value = `已生成 ${data.invites.length} 个邀请码，仅本次可见，请立刻复制保存。`
  } catch (err) {
    error.value = errMsg(err)
  } finally {
    generating.value = false
  }
}

async function copyCode(code: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(code)
    notice.value = `已复制 ${code}`
  } catch {
    notice.value = '复制失败，请手动选中'
  }
}

async function toggleStatus(user: AdminUser): Promise<void> {
  const next = user.status === 'active' ? 'disabled' : 'active'
  if (!confirm(`确定${next === 'disabled' ? '禁用' : '恢复'}「${user.nickname}」？`)) return
  try {
    await request(`/api/admin/users/${user.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: next }),
    })
    user.status = next
  } catch (err) {
    alert(errMsg(err))
  }
}

async function resetPassword(user: AdminUser): Promise<void> {
  const pwd = prompt(`给「${user.nickname}」设置临时密码（至少 8 位）：`)
  if (!pwd) return
  try {
    await request(`/api/admin/users/${user.id}/reset-password`, {
      method: 'POST',
      body: JSON.stringify({ password: pwd }),
    })
    alert('已重置。对方下次登录后必须修改密码。')
  } catch (err) {
    alert(errMsg(err))
  }
}

function kindLabel(kind: string): string {
  return (
    { bug: '功能异常', content: '内容有误', suggestion: '改进建议', other: '其他' }[kind] ?? kind
  )
}

function fmt(ts: string | null): string {
  if (!ts) return '从未登录'
  return new Date(ts).toLocaleString('zh-CN', { hour12: false })
}

onMounted(reload)
</script>

<template>
  <div class="admin">
    <header class="admin-head">
      <h1>内测管理</h1>
      <button
        class="btn"
        @click="reload"
      >
        刷新
      </button>
    </header>

    <p
      v-if="error"
      class="banner banner--error"
    >
      {{ error }}
    </p>
    <p
      v-if="notice"
      class="banner"
    >
      {{ notice }}
    </p>

    <section
      v-if="stats"
      class="stat-row"
    >
      <div class="stat">
        <span>用户</span>
        <strong>{{ stats.users }}</strong>
      </div>
      <div class="stat">
        <span>活跃会话</span>
        <strong>{{ stats.activeSessions }}</strong>
      </div>
      <div class="stat">
        <span>今日花费</span>
        <strong>¥{{ stats.spendToday.costCny.toFixed(2) }}</strong>
        <small>预算 ¥{{ stats.spendToday.budgetCny }}</small>
      </div>
    </section>

    <section class="panel">
      <h2>生成邀请码</h2>
      <div class="invite-form">
        <label>数量 <input
          v-model.number="inviteCount"
          type="number"
          min="1"
          max="50"
        ></label>
        <label>有效天数 <input
          v-model.number="inviteDays"
          type="number"
          min="1"
          max="90"
        ></label>
        <button
          class="btn btn--primary"
          :disabled="generating"
          @click="generateInvites"
        >
          {{ generating ? '生成中…' : '生成' }}
        </button>
      </div>
      <ul
        v-if="generated.length"
        class="codes"
      >
        <li
          v-for="inv in generated"
          :key="inv.code"
        >
          <code>{{ inv.code }}</code>
          <span>有效至 {{ fmt(inv.expiresAt) }}</span>
          <button
            class="link"
            @click="copyCode(inv.code)"
          >
            复制
          </button>
        </li>
      </ul>
    </section>

    <section class="panel">
      <h2>
        用户反馈 <small class="count">{{ feedback.length }}</small>
      </h2>
      <p
        v-if="!feedback.length"
        class="empty"
      >
        暂无反馈
      </p>
      <ul
        v-else
        class="feedback-list"
      >
        <li
          v-for="item in feedback"
          :key="item.id"
        >
          <div class="feedback-list__head">
            <strong>{{ kindLabel(item.kind) }}</strong>
            <span>{{ item.nickname ?? '已注销用户' }} · {{ fmt(item.createdAt) }}</span>
          </div>
          <p>{{ item.body }}</p>
          <div
            v-if="item.page || item.contact"
            class="feedback-list__meta"
          >
            <span v-if="item.page">页面：{{ item.page }}</span>
            <span v-if="item.contact">联系：{{ item.contact }}</span>
          </div>
        </li>
      </ul>
    </section>

    <section class="panel">
      <h2>用户</h2>
      <p v-if="loading">
        加载中…
      </p>
      <table
        v-else
        class="users"
      >
        <thead>
          <tr>
            <th>昵称</th>
            <th>角色</th>
            <th>状态</th>
            <th>注册</th>
            <th>最近登录</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="u in users"
            :key="u.id"
          >
            <td>{{ u.nickname }}</td>
            <td>{{ u.role === 'admin' ? '管理员' : '用户' }}</td>
            <td>{{ u.status === 'active' ? '正常' : '已禁用' }}</td>
            <td>{{ fmt(u.createdAt) }}</td>
            <td>{{ fmt(u.lastLoginAt) }}</td>
            <td class="ops">
              <button
                class="link"
                @click="resetPassword(u)"
              >
                重置密码
              </button>
              <button
                class="link"
                @click="toggleStatus(u)"
              >
                {{ u.status === 'active' ? '禁用' : '恢复' }}
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </section>
  </div>
</template>

<style scoped>
.admin {
  max-width: 960px;
  margin: 0 auto;
  padding: 28px var(--page-pad) 80px;
}
.admin-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 18px;
}
.admin-head h1 {
  margin: 0;
  font-size: 22px;
}
.banner {
  padding: 9px 12px;
  margin: 0 0 14px;
  font-size: 13px;
  color: var(--text);
  background: var(--bg-muted);
  border-radius: 7px;
}
.banner--error {
  color: var(--danger, #b42318);
}
.stat-row {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
  margin-bottom: 18px;
}
.stat {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 14px 16px;
  border: 1px solid var(--border);
  border-radius: 10px;
}
.stat span,
.stat small {
  font-size: 12px;
  color: var(--text-dim);
}
.stat strong {
  font-size: 22px;
}
.panel {
  padding: 18px 20px;
  margin-bottom: 18px;
  border: 1px solid var(--border);
  border-radius: 10px;
}
.panel h2 {
  margin: 0 0 14px;
  font-size: 15px;
}
.invite-form {
  display: flex;
  align-items: flex-end;
  gap: 12px;
  font-size: 12px;
  color: var(--text-dim);
}
.invite-form label {
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.invite-form input {
  width: 90px;
  height: 34px;
  padding: 0 9px;
  font: inherit;
  color: var(--text);
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 6px;
}
.btn {
  height: 34px;
  padding: 0 13px;
  font: inherit;
  font-size: 13px;
  color: var(--text);
  background: var(--bg-muted);
  border: 1px solid var(--border);
  border-radius: 6px;
  cursor: pointer;
}
.btn--primary {
  color: #fff;
  background: var(--primary-btn);
  border-color: var(--primary-btn);
}
.codes {
  padding: 0;
  margin: 14px 0 0;
  list-style: none;
}
.codes li {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 7px 0;
  font-size: 12px;
  border-top: 1px solid var(--border);
}
.codes code {
  font-size: 14px;
  letter-spacing: 1px;
  color: var(--text);
}
.codes span {
  color: var(--text-dim);
}
.users {
  width: 100%;
  font-size: 13px;
  border-collapse: collapse;
}
.users th,
.users td {
  padding: 9px 8px;
  text-align: left;
  border-bottom: 1px solid var(--border);
}
.users th {
  font-size: 12px;
  font-weight: 500;
  color: var(--text-dim);
}
.ops {
  display: flex;
  gap: 10px;
}
.link {
  padding: 0;
  font: inherit;
  font-size: 12px;
  color: var(--primary-btn);
  background: none;
  border: none;
  cursor: pointer;
}
.count {
  margin-left: 6px;
  color: var(--text-dim);
  font-size: 12px;
  font-weight: 400;
}
.empty {
  margin: 0;
  color: var(--text-dim);
  font-size: 13px;
}
.feedback-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.feedback-list li {
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-muted);
}
.feedback-list__head {
  display: flex;
  gap: 10px;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: 5px;
  font-size: 12px;
}
.feedback-list__head span {
  color: var(--text-dim);
}
.feedback-list p {
  margin: 0;
  font-size: 13px;
  white-space: pre-wrap;
}
.feedback-list__meta {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 14px;
  margin-top: 6px;
  color: var(--text-dim);
  font-size: 11px;
}
</style>
