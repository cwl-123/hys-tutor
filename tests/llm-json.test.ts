import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { extractJson, findJsonEnd, formatZodIssues, repairJson } from '../server/llm/client'

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

// 线上真实形态：完整 JSON 后面又续吐了一段碎片（"]}, ], \"teachi"），
// 旧实现切到「最后一个 }」会把这截垃圾带进来，整轮报废
describe('extractJson：JSON 后面多吐碎片', () => {
  it('丢掉完整对象之后的碎片', () => {
    const raw = '{"focus": "x", "sections": [{"title": "a"}]} , ], "teachingNotes": "…"}'
    expect(extractJson(raw)).toEqual({ focus: 'x', sections: [{ title: 'a' }] })
  })

  it('字符串里的花括号不干扰配平', () => {
    const raw = '{"a": "用 { } 举例", "b": 2} 多余的话'
    expect(extractJson(raw)).toEqual({ a: '用 { } 举例', b: 2 })
  })

  it('数组根也支持', () => {
    expect(extractJson('[1, {"a": 2}] 后面是废话')).toEqual([1, { a: 2 }])
  })

  it('正文先出现 [1] 引用标记时不误切', () => {
    const raw = '来源 [1] 如下：{"focus": "x", "n": [1, 2]}'
    expect(extractJson(raw)).toEqual({ focus: 'x', n: [1, 2] })
  })

  it('findJsonEnd 定位首个配平结尾', () => {
    const text = '前缀 {"a": [1, 2]} 尾巴'
    const start = text.indexOf('{')
    expect(findJsonEnd(text, start)).toBe(start + '{"a": [1, 2]}'.length - 1)
  })
})

describe('formatZodIssues', () => {
  it('把 zod 报错压成字段路径 + 原因', () => {
    const schema = z.object({ questions: z.array(z.object({ referenceAnswer: z.string() })) })
    const parsed = schema.safeParse({ questions: [{ }] })
    expect(parsed.success).toBe(false)
    const text = formatZodIssues(parsed.error)
    expect(text).toContain('questions.0.referenceAnswer')
  })

  it('非 zod 错误回退到原始 message', () => {
    expect(formatZodIssues(new Error('boom'))).toBe('boom')
  })
})
