import { mkdtemp, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { newId, readJson, writeJson } from '../server/repo/json-store'

describe('json-store', () => {
  it('读写往返一致', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'hys-repo-'))
    const file = path.join(dir, 'a', 'b.json')
    const data = { hello: '世界', n: 1 }
    await writeJson(file, data)
    await expect(readJson(file, null)).resolves.toEqual(data)
  })

  it('文件不存在时返回 fallback', async () => {
    await expect(readJson('/tmp/hys-not-exist-xyz.json', { fallback: true })).resolves.toEqual({
      fallback: true,
    })
  })

  it('原子写不留 tmp 文件', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'hys-repo-'))
    const file = path.join(dir, 'x.json')
    await writeJson(file, [1, 2, 3])
    const files = await readdir(dir)
    expect(files).toEqual(['x.json'])
  })

  it('JSON 损坏时备份 .bak 现场并回退 fallback', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'hys-repo-'))
    const file = path.join(dir, 'broken.json')
    await writeFile(file, '{oops 不是合法 JSON')
    await expect(readJson(file, [])).resolves.toEqual([])
    const files = await readdir(dir)
    expect(files.some((f) => f.startsWith('broken.json.corrupt-') && f.endsWith('.bak'))).toBe(true)
  })

  it('newId 带前缀且唯一', () => {
    const a = newId('n')
    const b = newId('n')
    expect(a).toMatch(/^n_[0-9a-f]{8}$/)
    expect(a).not.toBe(b)
  })
})
