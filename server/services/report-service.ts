import { dataPath, newId, nowIso, readJson, writeJson } from '../repo/json-store'
import type { ErrorReport, ReportInput } from '../../shared/types'

export function reportsFile(topicId: string): string {
  return dataPath('topics', topicId, 'reports.json')
}

export async function listReports(topicId: string): Promise<ErrorReport[]> {
  return readJson<ErrorReport[]>(reportsFile(topicId), [])
}

export async function addReport(topicId: string, input: ReportInput): Promise<ErrorReport> {
  const report: ErrorReport = {
    id: newId('r'),
    targetType: input.questionId ? 'question' : 'lesson',
    targetId: input.questionId ?? input.lessonId,
    lessonId: input.lessonId,
    nodeId: input.nodeId,
    quote: input.quote,
    note: input.note?.trim() || undefined,
    createdAt: nowIso(),
  }
  const reports = await listReports(topicId)
  await writeJson(reportsFile(topicId), [...reports, report])
  return report
}
