import { beforeAll, describe, expect, it } from 'vitest'
import { JSDOM } from 'jsdom'
import { mermaidCacheKey, renderMermaid, stripRootSvgId } from '../src/utils/mermaid-render'

describe('stripRootSvgId', () => {
  it('只剥 svg 根 id，内部 id 原样保留', () => {
    expect(stripRootSvgId('<svg id="hys-mmd-1" width="100%"><g id="keep">x</g></svg>')).toBe(
      '<svg width="100%"><g id="keep">x</g></svg>',
    )
    expect(stripRootSvgId('<svg width="100%" id="a" class="b"><defs id="d"/></svg>')).toBe(
      '<svg width="100%" class="b"><defs id="d"/></svg>',
    )
    expect(stripRootSvgId('<svg><g id="keep"/></svg>')).toBe('<svg><g id="keep"/></svg>')
    expect(stripRootSvgId('<svg viewBox="0 0 1 1"></svg>')).toBe('<svg viewBox="0 0 1 1"></svg>')
  })
})

describe('mermaidCacheKey', () => {
  it('按去首尾空白的代码文本归一', () => {
    expect(mermaidCacheKey('flowchart LR\n  A --> B\n')).toBe('flowchart LR\n  A --> B')
    expect(mermaidCacheKey('  x  ')).toBe('x')
  })
})

describe('renderMermaid（jsdom 回归）', () => {
  beforeAll(() => {
    const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true })
    const g = globalThis as Record<string, unknown>
    g.window = dom.window
    g.document = dom.window.document
    g.DOMParser = dom.window.DOMParser
    g.Element = dom.window.Element
    g.SVGElement = dom.window.SVGElement
    g.HTMLElement = dom.window.HTMLElement
    g.Node = dom.window.Node
    g.CSSStyleSheet ??= class {
      cssRules: unknown[] = []
      replaceSync() {}
      insertRule(rule: string, index = 0) {
        this.cssRules.splice(index, 0, rule)
        return index
      }
    }
    g.ResizeObserver ??= class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    for (const proto of [dom.window.SVGElement.prototype as unknown as Record<string, unknown>]) {
      proto.getBBox ??= () => ({ x: 0, y: 0, width: 100, height: 20 })
      proto.getComputedTextLength ??= () => 10
      proto.getScreenCTM ??= () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0, inverse: () => ({}) })
      proto.createSVGPoint ??= () => ({ x: 0, y: 0, matrixTransform: () => ({ x: 0, y: 0 }) })
    }
  })

  // 回归 bug：渲染状态曾放在 <script setup>（每组件实例一份），正文与编辑弹窗各自从 1
  // 编渲染 id 相撞，mermaid.removeExistingElements 会删掉页面上同 id 的旧图——
  // 表现为“一打开编辑图表弹窗，原图就消失”
  it('多实例先后渲染互不误删，产出 svg 无渲染 id', async () => {
    const document = globalThis.document as Document
    const CODE = 'flowchart LR\n  A[曝光] --> B[点击]'

    // 实例 A（正文）：渲染并挂载
    const svgA = await renderMermaid(CODE)
    expect(svgA).toBeTruthy()
    // 根 svg 上不得有 id（mermaid 清理逻辑按 getElementById(渲染id) 删节点）
    const rootTag = svgA!.slice(0, svgA!.indexOf('>') + 1)
    expect(rootTag).not.toContain('id="')
    const wrapA = document.createElement('div')
    wrapA.innerHTML = svgA!
    document.body.appendChild(wrapA)
    expect(wrapA.querySelector('svg')).not.toBeNull()

    // 实例 B（编辑弹窗预览）：渲染另一张图
    const svgB = await renderMermaid('graph TD\n  X --> Y')
    const wrapB = document.createElement('div')
    wrapB.innerHTML = svgB!
    document.body.appendChild(wrapB)

    // A 的图必须还活着（修复前此处 wrapA 被清空）
    expect(wrapA.querySelector('svg')).not.toBeNull()
    expect(wrapA.innerHTML.length).toBeGreaterThan(0)

    // 同代码命中缓存：同一份 SVG，不重复渲染
    expect(await renderMermaid(CODE)).toBe(svgA)

    // 空代码 / 语法错误返回 null，由调用方保留代码块
    await expect(renderMermaid('   ')).resolves.toBeNull()
    await expect(renderMermaid('这不是图 ???')).resolves.toBeNull()
  })
})
