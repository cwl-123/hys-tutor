import type { Preference, ReportInput } from '@shared/types'

export async function submitReport(input: ReportInput): Promise<Preference[]> {
  const res = await fetch('/api/reports', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  const data = (await res.json()) as { error?: string; newPreferences?: Preference[] }
  if (!res.ok) throw new Error(data.error ?? `报错提交失败：${res.status}`)
  return data.newPreferences ?? []
}
