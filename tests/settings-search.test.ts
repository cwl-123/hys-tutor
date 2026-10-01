import { describe, expect, it } from 'vitest'
import { resolveSearchKeys, type Settings } from '../server/services/settings-service'

const base: Settings = { providers: [] }

describe('resolveSearchKeys', () => {
  it('页面设置优先于 .env', () => {
    const s: Settings = { ...base, search: { tavilyKey: ' page-tv ', bochaKey: 'page-bc' } }
    const env = { TAVILY_API_KEY: 'env-tv', BOCHA_API_KEY: 'env-bc' } as NodeJS.ProcessEnv
    expect(resolveSearchKeys(s, env)).toEqual({ tavilyKey: 'page-tv', bochaKey: 'page-bc' })
  })

  it('页面未配置时回退 .env', () => {
    const env = { TAVILY_API_KEY: 'env-tv', BOCHA_API_KEY: 'env-bc' } as NodeJS.ProcessEnv
    expect(resolveSearchKeys(base, env)).toEqual({ tavilyKey: 'env-tv', bochaKey: 'env-bc' })
  })

  it('单边配置互不影响，全空返回空串', () => {
    const s: Settings = { ...base, search: { tavilyKey: 'page-tv' } }
    const env = { BOCHA_API_KEY: 'env-bc' } as NodeJS.ProcessEnv
    expect(resolveSearchKeys(s, env)).toEqual({ tavilyKey: 'page-tv', bochaKey: 'env-bc' })
    expect(resolveSearchKeys(base, {} as NodeJS.ProcessEnv)).toEqual({ tavilyKey: '', bochaKey: '' })
  })
})
