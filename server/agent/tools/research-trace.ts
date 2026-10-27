import { dataPath, nowIso, readJson, withLock, writeJson } from '../../repo/json-store'

// 研究阶段原始记录：搜索命中的全部候选（含是否保留与剔除原因）与抓取过的页面，
// 供复盘「Agent 挑了哪些源、丢弃了什么」，也便于离线重跑。
export interface SearchTrace {
  kind: 'search'
  at: string
  query: string
  results: {
    title: string
    url: string
    provider: string
    snippet: string
    kept: boolean
    dropReason?: string
  }[]
}

export interface FetchTrace {
  kind: 'fetch'
  at: string
  url: string
  title: string
  textLength: number
}

export type TraceEntry = SearchTrace | FetchTrace

function traceFile(topicId: string, nodeId: string): string {
  return dataPath('topics', topicId, 'research', 'raw', `${nodeId}.json`)
}

export async function readTrace(topicId: string, nodeId: string): Promise<TraceEntry[]> {
  return readJson<TraceEntry[]>(traceFile(topicId, nodeId), [])
}

export async function appendTrace(
  topicId: string,
  nodeId: string,
  entry: Omit<SearchTrace, 'at'> | Omit<FetchTrace, 'at'>,
): Promise<void> {
  const file = traceFile(topicId, nodeId)
  // 3 路预搜并行落 trace，读-改-写必须串行，否则后写的会覆盖前一条
  await withLock(file, async () => {
    const list = await readJson<TraceEntry[]>(file, [])
    list.push({ ...entry, at: nowIso() } as TraceEntry)
    await writeJson(file, list)
  })
}