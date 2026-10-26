import { computed, ref } from 'vue'
import { defineStore } from 'pinia'

export interface AuthUser {
  id: string
  nickname: string
  role: 'user' | 'admin'
  mustChangePassword: boolean
}

export interface UsageView {
  actions: Record<'topic' | 'lesson' | 'grade' | 'chat', { used: number; limit: number }>
  tokensIn: number
  tokensOut: number
  costCny: number
  budgetCny: number
  budgetExceeded: boolean
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
  const res = await fetch(path, { credentials: 'same-origin', ...init, headers })
  const text = await res.text()
  let data: unknown = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = null
  }
  if (!res.ok) {
    const message = (data as { error?: string } | null)?.error || `请求失败（${res.status}）`
    throw new ApiError(res.status, message)
  }
  return data as T
}

interface AuthResponse {
  user: AuthUser | null
  usage?: UsageView
}

export const useAuthStore = defineStore('auth', () => {
  const user = ref<AuthUser | null>(null)
  const usage = ref<UsageView | null>(null)
  const loaded = ref(false)

  const isAdmin = computed(() => user.value?.role === 'admin')

  async function load(): Promise<void> {
    try {
      const data = await request<AuthResponse>('/api/auth/me')
      user.value = data.user
      usage.value = data.usage ?? null
    } catch {
      user.value = null
      usage.value = null
    } finally {
      loaded.value = true
    }
  }

  function absorb(data: AuthResponse): void {
    user.value = data.user
    usage.value = data.usage ?? null
  }

  async function login(nickname: string, password: string): Promise<void> {
    absorb(
      await request<AuthResponse>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ nickname, password }),
      }),
    )
    loaded.value = true
  }

  async function register(input: {
    inviteCode: string
    nickname: string
    password: string
    acceptedTerms: boolean
  }): Promise<void> {
    absorb(
      await request<AuthResponse>('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    )
    loaded.value = true
  }

  async function logout(): Promise<void> {
    try {
      await request('/api/auth/logout', { method: 'POST' })
    } finally {
      user.value = null
      usage.value = null
    }
  }

  async function changePassword(oldPassword: string, newPassword: string): Promise<void> {
    await request('/api/auth/password', {
      method: 'POST',
      body: JSON.stringify({ oldPassword, newPassword }),
    })
    if (user.value) user.value.mustChangePassword = false
  }

  async function refreshUsage(): Promise<void> {
    const data = await request<AuthResponse>('/api/auth/me')
    absorb(data)
  }

  return {
    user,
    usage,
    loaded,
    isAdmin,
    load,
    login,
    register,
    logout,
    changePassword,
    refreshUsage,
  }
})
