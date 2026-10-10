import { reactive } from 'vue'

export interface ToastItem {
  id: number
  text: string
}

export const toasts = reactive<ToastItem[]>([])
let seq = 0

export function showToast(text: string, ms = 5000): void {
  const id = ++seq
  toasts.push({ id, text })
  setTimeout(() => {
    const i = toasts.findIndex((t) => t.id === id)
    if (i >= 0) toasts.splice(i, 1)
  }, ms)
}

// 交互中提取到长期偏好的统一轻提示
export function showNewPreferences(prefs: { text: string }[] | undefined): void {
  for (const p of prefs ?? []) showToast(`已记下偏好：${p.text}`)
}
