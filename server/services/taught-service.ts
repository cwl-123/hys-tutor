import { dataPath, nowIso, readJson, withLock, writeJson } from '../repo/json-store'

// 方向级「已讲元素」记忆：记录每课用过的具体案例/例子，供后续备课避免重复、做递进。
export interface TaughtEntry {
  lessonId: string
  nodeId: string
  nodeName: string
  objectives: string[]
  examples: string[]
  at: string
}

function taughtFile(topicId: string): string {
  return dataPath('topics', topicId, 'taught.json')
}

export async function listTaught(topicId: string): Promise<TaughtEntry[]> {
  return readJson<TaughtEntry[]>(taughtFile(topicId), [])
}

// 覆盖式记录（同一课重写/优化后覆盖旧记录），按时间追加
export async function recordTaught(
  topicId: string,
  entry: Omit<TaughtEntry, 'at'>,
): Promise<void> {
  const file = taughtFile(topicId)
  await withLock(file, async () => {
    const list = await listTaught(topicId)
    const next = [...list.filter((e) => e.lessonId !== entry.lessonId), { ...entry, at: nowIso() }]
    await writeJson(file, next)
  })
}

// 备课注入文本：已讲过的知识点与案例，写作时避免照搬
export function taughtContextText(entries: TaughtEntry[], limit = 8): string {
  const recent = entries.slice(-limit)
  if (recent.length === 0) return ''
  const lines = recent.map((e) => {
    const ex = e.examples.length ? `，已用案例：${e.examples.join('；')}` : ''
    return `- 《${e.nodeName}》${ex}`
  })
  return `已讲过的内容（本课请避免重复，尽量换新例子/新角度；确需复述时简要带过）：\n${lines.join('\n')}`
}