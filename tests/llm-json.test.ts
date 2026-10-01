import { describe, expect, it } from 'vitest'
import { extractJson, repairJson } from '../server/llm/client'

describe('extractJson', () => {
  it('抠出代码围栏里的 JSON', () => {
    expect(extractJson('前言\n```json\n{"a": 1}\n```\n后语')).toEqual({ a: 1 })
  })

  it('容忍前后废话', () => {
    expect(extractJson('结果如下：{"a": [1, 2]} 希望有帮助')).toEqual({ a: [1, 2] })
  })

  it('无 JSON 抛错', () => {
    expect(() => extractJson('没有JSON')).toThrow('未找到 JSON')
  })

  it('修复字符串内未转义的英文双引号', () => {
    const raw = '{"focus": "把这些"砖瓦"升级为词块", "n": 1}'
    expect(extractJson(raw)).toEqual({ focus: '把这些"砖瓦"升级为词块', n: 1 })
  })

  it('引号在值末尾也能正确修复', () => {
    const raw = '{"quote": "他说"你好"", "ok": true}'
    expect(extractJson(raw)).toEqual({ quote: '他说"你好"', ok: true })
  })

  it('修复嵌套数组对象里的引号', () => {
    const raw = '{"items": [{"t": "所谓"词块"指…"}, {"t": "x"}], "s": "end"}'
    expect(extractJson(raw)).toEqual({ items: [{ t: '所谓"词块"指…' }, { t: 'x' }], s: 'end' })
  })

  it('已转义的引号不受影响', () => {
    const raw = '{"a": "已\\"转义", "b": 2}'
    expect(extractJson(raw)).toEqual({ a: '已"转义', b: 2 })
  })
})

describe('repairJson', () => {
  it('合法 JSON 原样通过', () => {
    const raw = '{"a": "x", "b": [1, {"c": ":"}]}'
    expect(JSON.parse(repairJson(raw))).toEqual({ a: 'x', b: [1, { c: ':' }] })
  })
})
