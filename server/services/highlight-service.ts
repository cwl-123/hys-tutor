import { dataPath, newId, nowIso, readJson, withLock, writeJson } from '../repo/json-store'
import type { Highlight, HighlightInput } from '../../shared/types'

function highlightsFile(topicId: string, lessonId: string): string {
  return dataPath('topics', topicId, 'highlights', `${lessonId}.json`)
}

// 某课全部划线（按时间升序，展示与正文渲染均按此顺序）
export async function listHighlights(topicId: string, lessonId: string): Promise<Highlight[]> {
  const list = await readJson<Highlight[]>(highlightsFile(topicId, lessonId), [])
  return [...list].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

// 新增一条划线；同一锚点（章节+文字+出现次序）已存在则直接复用，避免重复标注
export async function addHighlight(
  topicId: string,
  lessonId: string,
  input: HighlightInput,
  nodeId?: string,
): Promise<Highlight> {
  const file = highlightsFile(topicId, lessonId)
  const heading = input.heading ?? null
  const occurrence = input.occurrence ?? 0
  let created!: Highlight
  await withLock(file, async () => {
    const list = await readJson<Highlight[]>(file, [])
    const dup = list.find(
      (h) => h.heading === heading && h.text === input.text && h.occurrence === occurrence,
    )
    if (dup) {
      created = dup
      return
    }
    created = {
      id: newId('hl'),
      lessonId,
      nodeId,
      heading,
      text: input.text,
      occurrence,
      createdAt: nowIso(),
    }
    await writeJson(file, [...list, created])
  })
  return created
}

// 删除一条划线；返回是否删除成功
export async function removeHighlight(
  topicId: string,
  lessonId: string,
  highlightId: string,
): Promise<boolean> {
  const file = highlightsFile(topicId, lessonId)
  let removed = false
  await withLock(file, async () => {
    const list = await readJson<Highlight[]>(file, [])
    const next = list.filter((h) => h.id !== highlightId)
    removed = next.length !== list.length
    if (removed) await writeJson(file, next)
  })
  return removed
}