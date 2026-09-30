import type { ReportInput } from '@shared/types'

export async function submitReport(input: ReportInput): Promise<void> {
  const res = await fetch('/api/reports', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  const data = (await res.json()) as { error?: string }
  if (!res.ok) throw new Error(data.error ?? `报错提交失败：${res.status}`)
}
