import { z } from 'zod'
import { dataPath, newId, nowIso, readJson, writeJson } from '../../repo/json-store'
import type { ResearchNote } from '../../../shared/types'

export function researchFile(topicId: string, nodeId: string): string {
  return dataPath('topics', topicId, 'research', `${nodeId}.json`)
}

export async function readResearchNote(topicId: string, nodeId: string): Promise<ResearchNote | null> {
  return readJson<ResearchNote | null>(researchFile(topicId, nodeId), null)
}

export const notePatchSchema = z.object({
  concepts: z.array(z.string()).default([]),
  derivations: z.array(z.string()).default([]),
  examples: z.array(z.string()).default([]),
  pitfalls: z.array(z.string()).default([]),
  sources: z.array(z.object({ title: z.string(), url: z.string() })).default([]),
})
export type NotePatch = z.infer<typeof notePatchSchema>

function unionStrings(base: string[], add: string[]): string[] {
  const seen = new Set(base)
  return [...base, ...add.filter((s) => !seen.has(s))]
}

// 合并研究笔记：内容按精确去重取并集，来源按 URL 去重，version 递增
export function mergeResearchNotes(
  base: ResearchNote | null,
  patch: NotePatch,
  nodeId: string,
  searchQueries: string[] = [],
): ResearchNote {
  const now = nowIso()
  if (!base) {
    return {
      id: newId('rn'),
      nodeId,
      concepts: patch.concepts,
      derivations: patch.derivations,
      examples: patch.examples,
      pitfalls: patch.pitfalls,
      sources: patch.sources.map((s) => ({ ...s, fetchedAt: now })),
      searchQueries: [...new Set(searchQueries)],
      version: 1,
      updatedAt: now,
    }
  }
  const seenUrls = new Set(base.sources.map((s) => s.url))
  return {
    ...base,
    concepts: unionStrings(base.concepts, patch.concepts),
    derivations: unionStrings(base.derivations, patch.derivations),
    examples: unionStrings(base.examples, patch.examples),
    pitfalls: unionStrings(base.pitfalls, patch.pitfalls),
    sources: [
      ...base.sources,
      ...patch.sources.filter((s) => !seenUrls.has(s.url)).map((s) => ({ ...s, fetchedAt: now })),
    ],
    searchQueries: [...new Set([...base.searchQueries, ...searchQueries])],
    version: base.version + 1,
    updatedAt: now,
  }
}

export async function saveResearchNote(
  topicId: string,
  nodeId: string,
  patch: NotePatch,
  searchQueries: string[] = [],
): Promise<ResearchNote> {
  const base = await readResearchNote(topicId, nodeId)
  const note = mergeResearchNotes(base, patch, nodeId, searchQueries)
  await writeJson(researchFile(topicId, nodeId), note)
  return note
}
