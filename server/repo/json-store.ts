import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import path from 'node:path'

// 数据目录：默认 <cwd>/data，可用 HYS_DATA_DIR 覆盖（测试隔离用）
export const DATA_DIR = process.env.HYS_DATA_DIR
  ? path.resolve(process.env.HYS_DATA_DIR)
  : path.resolve(process.cwd(), 'data')

export function dataPath(...parts: string[]): string {
  return path.join(DATA_DIR, ...parts)
}

export async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(file, 'utf-8')) as T
  } catch {
    return fallback
  }
}

// 原子写：先写 tmp 再 rename，避免中途崩溃产生半截 JSON
export async function writeJson(file: string, data: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true })
  const tmp = `${file}.${randomUUID()}.tmp`
  await writeFile(tmp, JSON.stringify(data, null, 2))
  await rename(tmp, file)
}

export function newId(prefix: string): string {
  return `${prefix}_${randomUUID().slice(0, 8)}`
}

export function nowIso(): string {
  return new Date().toISOString()
}
