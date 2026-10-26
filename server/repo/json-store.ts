import { copyFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { currentUserId, safeUserId } from './context'

// 数据目录：默认 <cwd>/data，可用 HYS_DATA_DIR 覆盖（测试隔离用）
export const DATA_DIR = process.env.HYS_DATA_DIR
  ? path.resolve(process.env.HYS_DATA_DIR)
  : path.resolve(process.cwd(), 'data')

// 显式按用户拼路径：注册等还没有请求上下文的场景用
export function userDataPath(userId: string, ...parts: string[]): string {
  return path.join(DATA_DIR, 'users', safeUserId(userId), ...parts)
}

// 请求链路默认入口：自动带当前用户维度，service 层不用感知多租户
export function dataPath(...parts: string[]): string {
  return userDataPath(currentUserId(), ...parts)
}

// 全局非用户数据（研究缓存、公告等）
export function globalPath(...parts: string[]): string {
  return path.join(DATA_DIR, 'global', ...parts)
}

export async function ensureUserDir(userId: string): Promise<void> {
  await mkdir(userDataPath(userId, 'topics'), { recursive: true })
}

export async function readJson<T>(file: string, fallback: T): Promise<T> {
  let raw: string
  try {
    raw = await readFile(file, 'utf-8')
  } catch {
    return fallback // 文件不存在/不可读：正常回退
  }
  try {
    return JSON.parse(raw) as T
  } catch (err) {
    // 文件损坏绝不能静默当「不存在」——否则下一次写入就用空数据覆盖掉历史。
    // 备份损坏现场供人工恢复，并显式报错
    const bak = `${file}.corrupt-${Date.now()}.bak`
    await copyFile(file, bak).catch(() => {})
    console.error(`[json-store] JSON 损坏：${file}（已备份到 ${bak}）`, err)
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

// 按 key 串行化的异步互斥锁：保护 read-modify-write 序列，防并发写互相覆盖丢数据
const locks = new Map<string, Promise<void>>()

export async function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(key) ?? Promise.resolve()
  let release!: () => void
  const gate = new Promise<void>((r) => (release = r))
  const stored = prev.then(() => gate)
  locks.set(key, stored)
  await prev
  try {
    return await fn()
  } finally {
    release()
    if (locks.get(key) === stored) locks.delete(key)
  }
}

export function newId(prefix: string): string {
  return `${prefix}_${randomUUID().slice(0, 8)}`
}

export function nowIso(): string {
  return new Date().toISOString()
}
