import type { Preference } from '@shared/types'

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init)
  const data = (await res.json()) as T & { error?: string }
  if (!res.ok) throw new Error(data.error ?? `请求失败：${res.status}`)
  return data
}

export async function listPreferences(): Promise<Preference[]> {
  const data = await request<{ preferences: Preference[] }>('/api/preferences')
  return data.preferences
}

export async function createPreference(text: string): Promise<Preference> {
  const data = await request<{ preference: Preference }>('/api/preferences', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  })
  return data.preference
}

export async function updatePreference(id: string, text: string): Promise<Preference> {
  const data = await request<{ preference: Preference }>(`/api/preferences/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  })
  return data.preference
}

export async function deletePreference(id: string): Promise<void> {
  await request<{ ok: boolean }>(`/api/preferences/${id}`, { method: 'DELETE' })
}
