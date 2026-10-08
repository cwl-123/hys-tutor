import { mkdtemp, readdir, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as AssetStoreModule from '../server/services/asset-store'

// DATA_DIR 在 json-store 导入时绑定，必须先设 HYS_DATA_DIR 再动态导入
let store: typeof AssetStoreModule
let dataDir: string

function png(content = 'fake-png'): Buffer {
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(content)])
}

beforeAll(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), 'hys-assets-'))
  process.env.HYS_DATA_DIR = dataDir
  store = await import('../server/services/asset-store')
})

afterAll(() => {
  vi.unstubAllGlobals()
})

beforeEach(() => {
  vi.unstubAllGlobals()
})

describe('detectImageExt', () => {
  it('识别 png/jpeg/gif/webp', () => {
    expect(store.detectImageExt(png())).toBe('.png')
    expect(store.detectImageExt(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]))).toBe('.jpg')
    expect(store.detectImageExt(Buffer.from('GIF89a....'))).toBe('.gif')
    expect(store.detectImageExt(Buffer.concat([Buffer.from('RIFF0000WEBP'), Buffer.from('x')]))).toBe('.webp')
  })

  it('非图片/空缓冲返回 null', () => {
    expect(store.detectImageExt(Buffer.from('hello world'))).toBeNull()
    expect(store.detectImageExt(Buffer.alloc(0))).toBeNull()
    expect(store.detectImageExt(Buffer.from('<svg onload=alert(1)>'))).toBeNull() // 拒 SVG
  })
})

describe('isSafeAssetName', () => {
  it('简单文件名通过，路径穿越/斜杠拒绝', () => {
    expect(store.isSafeAssetName('abc123.png')).toBe(true)
    expect(store.isSafeAssetName('a-b_c.9.webp')).toBe(true)
    expect(store.isSafeAssetName('..')).toBe(false)
    expect(store.isSafeAssetName('../etc/passwd')).toBe(false)
    expect(store.isSafeAssetName('a/b.png')).toBe(false)
    expect(store.isSafeAssetName('.hidden')).toBe(false)
    expect(store.isSafeAssetName('')).toBe(false)
  })
})

describe('saveImageBuffer', () => {
  it('内容哈希命名 + 清单记来源，同内容去重复用', async () => {
    const topicId = 't_save'
    const a = await store.saveImageBuffer(topicId, png('same'), { originUrl: 'https://x/1.png', pageUrl: 'https://x/p' })
    expect(a).not.toBeNull()
    expect(a!.file).toMatch(/^[0-9a-f]{16}\.png$/)
    expect(a!.src).toBe(`/api/topics/${topicId}/assets/${a!.file}`)

    const b = await store.saveImageBuffer(topicId, png('same'), {})
    expect(b!.file).toBe(a!.file) // 同内容同文件
    expect(b!.meta.originUrl).toBe('https://x/1.png') // 来源不被空 meta 覆盖

    const files = await readdir(path.join(dataDir, 'topics', topicId, 'assets'))
    expect(files).toEqual([a!.file])
    const manifest = await store.readManifest(topicId)
    expect(manifest[a!.file].pageUrl).toBe('https://x/p')
    expect(manifest[a!.file].size).toBe(png('same').length)
  })

  it('非图片内容拒绝', async () => {
    await expect(store.saveImageBuffer('t_reject', Buffer.from('not image'), {})).resolves.toBeNull()
  })
})

describe('downloadImage', () => {
  it('下载成功落地为本地素材', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(new Uint8Array(png('dl')), { status: 200, headers: { 'content-type': 'image/png' } })),
    )
    const saved = await store.downloadImage('t_dl', 'https://cdn.example.com/a.png', { title: '示意图' })
    expect(saved).not.toBeNull()
    expect(saved!.src).toMatch(/^\/api\/topics\/t_dl\/assets\/[0-9a-f]{16}\.png$/)
    expect(saved!.meta.originUrl).toBe('https://cdn.example.com/a.png')
    expect(saved!.meta.title).toBe('示意图')
  })

  it('404 / 非图片 / 超限均返回 null 不抛错', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 404 })))
    await expect(store.downloadImage('t_dl2', 'https://x/missing.png')).resolves.toBeNull()

    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html></html>', { status: 200 })))
    await expect(store.downloadImage('t_dl2', 'https://x/page')).resolves.toBeNull()

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(new Uint8Array(png()), { status: 200, headers: { 'content-length': String(store.MAX_IMAGE_BYTES + 1) } })),
    )
    await expect(store.downloadImage('t_dl2', 'https://x/huge.png')).resolves.toBeNull()

    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new Error('timeout'))))
    await expect(store.downloadImage('t_dl2', 'https://x/err.png')).resolves.toBeNull()
  })
})

describe('localizeImages', () => {
  it('外链图下载改写为本地路径，并收集配图清单', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(new Uint8Array(png('loc')), { status: 200, headers: { 'content-type': 'image/png' } })),
    )
    const topicId = 't_loc'
    const md = '前文\n\n![漏斗](https://cdn.example.com/funnel.png)\n\n后文'
    const result = await store.localizeImages(topicId, md)
    expect(result.contentMd).not.toContain('cdn.example.com')
    expect(result.contentMd).toContain(`![漏斗](/api/topics/${topicId}/assets/`)
    expect(result.contentMd).toContain('前文')
    expect(result.contentMd).toContain('后文')
    expect(result.images).toHaveLength(1)
    expect(result.images[0].alt).toBe('漏斗')
    expect(result.images[0].originUrl).toBe('https://cdn.example.com/funnel.png')
  })

  it('下载失败：备课产线剔除，手动编辑保留原样', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('gone', { status: 403 })))
    const md = 'a\n\n![x](https://bad.example.com/x.png)\n\nb'

    const drop = await store.localizeImages('t_fail', md, { dropFailed: true })
    expect(drop.contentMd).toBe('a\n\n\n\nb')
    expect(drop.images).toHaveLength(0)

    const keep = await store.localizeImages('t_fail', md, { dropFailed: false })
    expect(keep.contentMd).toBe(md)
    expect(keep.images[0].src).toBe('https://bad.example.com/x.png')
  })

  it('代码块内的图片语法不动，围栏外正常处理', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(new Uint8Array(png('fence')), { status: 200 })),
    )
    const md = [
      '```markdown',
      '![示例](https://example.com/demo.png)',
      '```',
      '',
      '![真图](https://example.com/real.png)',
    ].join('\n')
    const result = await store.localizeImages('t_fence', md)
    expect(result.contentMd).toContain('![示例](https://example.com/demo.png)') // 教学示例保持原样
    expect(result.contentMd).not.toContain('![真图](https://example.com/real.png)')
    expect(result.images).toHaveLength(1)
  })

  it('已是本地素材的引用保留，未知来源剔除', async () => {
    const topicId = 't_local'
    const saved = await store.saveImageBuffer(topicId, png('mine'), {})
    const md = `![自绘](${saved!.src})\n\n![相对](./img.png)\n\n![数据](data:image/png;base64,xx)`
    const result = await store.localizeImages(topicId, md)
    expect(result.contentMd).toContain(`![自绘](${saved!.src})`)
    expect(result.contentMd).not.toContain('./img.png')
    expect(result.contentMd).not.toContain('data:image')
    expect(result.images).toEqual([
      { src: saved!.src, alt: '自绘', originUrl: undefined, pageUrl: undefined },
    ])
  })

  it('readAsset 拒路径穿越且取回内容一致', async () => {
    const topicId = 't_read'
    const saved = await store.saveImageBuffer(topicId, png('read-me'), {})
    const buf = await store.readAsset(topicId, saved!.file)
    expect(buf!.equals(png('read-me'))).toBe(true)
    await expect(store.readAsset(topicId, '../graph.json')).resolves.toBeNull()
    expect(await store.readAsset(topicId, 'no-such.png')).toBeNull()
    expect((await stat(path.join(dataDir, 'topics', topicId, 'assets', saved!.file))).size).toBeGreaterThan(0)
  })
})
