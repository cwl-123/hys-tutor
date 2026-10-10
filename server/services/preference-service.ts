import { dataPath, newId, nowIso, readJson, writeJson } from '../repo/json-store'
import { completeJson } from '../llm/client'
import {
  PREFERENCE_EXTRACT_SYSTEM_PROMPT,
  llmPreferenceOpsSchema,
  preferenceExtractPrompt,
} from '../llm/prompts/preference'
import type { Preference, PreferenceSource } from '../../shared/types'

function prefsFile(): string {
  return dataPath('preferences.json')
}

export async function listPreferences(): Promise<Preference[]> {
  return readJson<Preference[]>(prefsFile(), [])
}

export async function addPreference(text: string, source: PreferenceSource): Promise<Preference> {
  const pref: Preference = { id: newId('p'), text: text.trim(), source, createdAt: nowIso() }
  const prefs = await listPreferences()
  await writeJson(prefsFile(), [...prefs, pref])
  return pref
}

export async function updatePreference(id: string, text: string): Promise<Preference | null> {
  const prefs = await listPreferences()
  const pref = prefs.find((p) => p.id === id)
  if (!pref) return null
  pref.text = text.trim()
  await writeJson(prefsFile(), prefs)
  return pref
}

export async function removePreference(id: string): Promise<boolean> {
  const prefs = await listPreferences()
  const next = prefs.filter((p) => p.id !== id)
  if (next.length === prefs.length) return false
  await writeJson(prefsFile(), next)
  return true
}

// 备课注入用文本（大纲 + 写作共用），空清单返回空串
export async function preferenceContextText(): Promise<string> {
  const prefs = await listPreferences()
  if (!prefs.length) return ''
  return `学习者长期偏好（讲法请全程贴合，不用等用户再提醒）：\n${prefs.map((p) => `- ${p.text}`).join('\n')}`
}

// 从一次用户交互中提取长期偏好：LLM 判断 + 去重合并，返回本次新增/更新的偏好（toast 用）
export async function extractPreferences(
  interaction: string,
  source: PreferenceSource,
): Promise<Preference[]> {
  const text = interaction.trim()
  if (!text) return []
  const prefs = await listPreferences()
  const result = await completeJson({
    system: PREFERENCE_EXTRACT_SYSTEM_PROMPT,
    prompt: preferenceExtractPrompt({
      interaction: text,
      existing: prefs.map((p) => ({ id: p.id, text: p.text })),
    }),
    schema: llmPreferenceOpsSchema,
    temperature: 0.2,
  })

  const changed: Preference[] = []
  const byId = new Map(prefs.map((p) => [p.id, p]))
  for (const op of result.ops) {
    if (op.action === 'merge') {
      const target = op.targetId ? byId.get(op.targetId) : undefined
      if (target) {
        target.text = op.text.trim()
        changed.push(target)
        continue
      }
      // targetId 无效时降级为 add（清单满员则丢弃）
      if (prefs.length >= 50) continue
      const pref: Preference = { id: newId('p'), text: op.text.trim(), source, createdAt: nowIso() }
      prefs.push(pref)
      byId.set(pref.id, pref)
      changed.push(pref)
      continue
    }
    if (prefs.length >= 50) continue
    // 服务端兜底去重：完全同文不重复入库
    const dup = prefs.find((p) => p.text === op.text.trim())
    if (dup) continue
    const pref: Preference = { id: newId('p'), text: op.text.trim(), source, createdAt: nowIso() }
    prefs.push(pref)
    byId.set(pref.id, pref)
    changed.push(pref)
  }
  if (changed.length) await writeJson(prefsFile(), prefs)
  return changed
}

// 提取是增强而非主流程：失败静默降级为空，绝不影响交互本身
export async function safeExtractPreferences(
  interaction: string,
  source: PreferenceSource,
): Promise<Preference[]> {
  try {
    return await extractPreferences(interaction, source)
  } catch (err) {
    console.error('[preference] 提取失败', err instanceof Error ? err.message : err)
    return []
  }
}
