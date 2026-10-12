import { ref } from 'vue'

// 外观主题：跟随系统 / 强制浅色 / 强制深色。
// 解析结果落在 <html data-theme>，CSS 只需认这一个属性（避免 media query 与手动切换打架）
export type ThemePref = 'auto' | 'light' | 'dark'

const STORAGE_KEY = 'hys-theme'

function readPref(): ThemePref {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    if (v === 'light' || v === 'dark' || v === 'auto') return v
  } catch {
    // localStorage 不可用（隐私模式等）时退回跟随系统
  }
  return 'auto'
}

function systemDark(): boolean {
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

export const themePref = ref<ThemePref>(readPref())
export const isDark = ref(false)

function resolveDark(pref: ThemePref): boolean {
  return pref === 'auto' ? systemDark() : pref === 'dark'
}

export function applyTheme(pref: ThemePref): void {
  themePref.value = pref
  try {
    localStorage.setItem(STORAGE_KEY, pref)
  } catch {
    // 忽略写入失败
  }
  isDark.value = resolveDark(pref)
  document.documentElement.dataset.theme = isDark.value ? 'dark' : 'light'
}

// 跟随系统时响应系统主题切换
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if (themePref.value === 'auto') applyTheme('auto')
})

// 模块加载即应用（main.ts 引入本模块后立即生效，避免首屏闪白）
applyTheme(readPref())
