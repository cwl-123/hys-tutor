// 时间格式化统一出口（此前 HomeView/PreferencesView/NodePanel/ExerciseView 各有一份）

// 「2026年10月12日」
export function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' })
}

// 「10月12日 18:09」
export function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

// 「10月12日 18:09」（空字符串安全，ExerciseView 用）
export function fmtTime(iso: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getMonth() + 1}月${d.getDate()}日 ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// 选项序号 → 字母（0→A，超过 26 个选项时返回序号兜底，避免 'ABCD'[i] 越界出 undefined）
export function optionLetter(idx: number): string {
  return idx < 26 ? String.fromCharCode(65 + idx) : String(idx + 1)
}
