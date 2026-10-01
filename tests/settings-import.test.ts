import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { findCandidate, listImportCandidates } from '../server/services/import-service'

async function fakeHome(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), 'hys-import-'))
}

async function writeJsonAt(home: string, rel: string, data: unknown): Promise<void> {
  const file = path.join(home, rel)
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, JSON.stringify(data), 'utf-8')
}

describe('import-service', () => {
  it('空目录返回空列表', async () => {
    expect(listImportCandidates(await fakeHome())).toEqual([])
  })

  it('扫描 OpenCode provider，过滤无 key 与 AiHubMix，key 脱敏', async () => {
    const home = await fakeHome()
    await writeJsonAt(home, '.config/opencode/opencode.json', {
      provider: {
        deepseek: {
          options: { apiKey: 'sk-1234567890abcdef', baseURL: 'https://api.deepseek.com/v1' },
          models: { 'deepseek-flash': {}, 'deepseek-v4-pro': {} },
        },
        nokey: { options: { baseURL: 'https://example.com' }, models: { m: {} } },
        aihub: {
          options: { apiKey: 'sk-xxx', baseURL: 'https://aihubmix.com/v1' },
          models: { m: {} },
        },
      },
    })
    const list = listImportCandidates(home)
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({
      id: 'opencode:deepseek',
      source: 'OpenCode',
      baseUrl: 'https://api.deepseek.com/v1',
      model: 'deepseek-flash',
      models: ['deepseek-flash', 'deepseek-v4-pro'],
    })
    expect(list[0].apiKeyMasked).toBe('sk-123…cdef')
    expect(JSON.stringify(list)).not.toContain('sk-1234567890abcdef')
  })

  it('扫描 Codex config.toml + auth.json', async () => {
    const home = await fakeHome()
    await writeJsonAt(home, '.codex/auth.json', { OPENAI_API_KEY: 'codex-key-123456' })
    const dir = path.join(home, '.codex')
    await mkdir(dir, { recursive: true })
    await writeFile(
      path.join(dir, 'config.toml'),
      'model_provider = "foo"\nmodel = "gpt-6-astra"\n\n[model_providers.foo]\nbase_url = "https://api.foo.com"\n',
      'utf-8',
    )
    const list = listImportCandidates(home)
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({
      id: 'codex',
      source: 'Codex',
      baseUrl: 'https://api.foo.com',
      model: 'gpt-6-astra',
    })
  })

  it('Claude Code 仅在配置自定义网关时可导入', async () => {
    const home = await fakeHome()
    await writeJsonAt(home, '.claude/settings.json', {
      env: { ANTHROPIC_AUTH_TOKEN: 'token-1234567890' },
    })
    expect(listImportCandidates(home)).toEqual([])
    await writeJsonAt(home, '.claude/settings.json', {
      env: {
        ANTHROPIC_AUTH_TOKEN: 'token-1234567890',
        ANTHROPIC_BASE_URL: 'https://relay.example.com',
        ANTHROPIC_MODEL: 'sonnet',
      },
    })
    const list = listImportCandidates(home)
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ id: 'claude-code', model: 'sonnet' })
  })

  it('findCandidate 返回真实 key，找不到返回 null', async () => {
    const home = await fakeHome()
    await writeJsonAt(home, '.config/opencode/opencode.json', {
      provider: {
        kimi: {
          options: { apiKey: 'real-key-123456', baseURL: 'https://api.kimi.com/coding/v1' },
          models: { k3: {} },
        },
      },
    })
    expect(findCandidate('opencode:kimi', home)?.apiKey).toBe('real-key-123456')
    expect(findCandidate('opencode:nope', home)).toBeNull()
  })
})
