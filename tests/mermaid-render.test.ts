import { beforeAll, describe, expect, it } from 'vitest'
import { JSDOM } from 'jsdom'
import { mermaidCacheKey, renderMermaid } from '../src/utils/mermaid-render'

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

  // 回归 1（图表消失）：渲染状态曾放在 <script setup>（每实例一份），正文与编辑弹窗
  // 渲染 id 相撞，mermaid.removeExistingElements 按 id 删掉了页面上的旧图
  // 回归 2（图表变黑块）：样式作用域 #id 就挂在根 svg 上，剥掉根 id 会让整套配色失效
  it('样式作用域与根 id 保持一致，多实例先后渲染互不误删', async () => {
    const document = globalThis.document as Document
    const CODE = 'flowchart LR\n  A[曝光] --> B[点击]'

    const svgA = await renderMermaid(CODE)
    expect(svgA).toBeTruthy()

    // 根 svg 必须带 id（mermaid 配色样式按 #id 作用域挂载），且样式表引用同一 id
    const rootId = svgA!.match(/^<svg id="([^"]+)"/)?.[1]
    expect(rootId).toBeTruthy()
    expect(svgA).toContain(`#${rootId}{`)
    expect(svgA).toContain(`#${rootId} .node`)
    // 挂载 id 与渲染 id 不同命名空间：mermaid 后续 render 的清理碰不到它
    expect(rootId).toMatch(/^hys-m/)

    const wrapA = document.createElement('div')
    wrapA.innerHTML = svgA!
    document.body.appendChild(wrapA)
    expect(wrapA.querySelector('svg')).not.toBeNull()

    // 实例 B（编辑弹窗预览）渲染另一张图，A 的图必须还活着
    const svgB = await renderMermaid('graph TD\n  X --> Y')
    const wrapB = document.createElement('div')
    wrapB.innerHTML = svgB!
    document.body.appendChild(wrapB)
    expect(wrapA.querySelector('svg')).not.toBeNull()
    expect(wrapA.innerHTML.length).toBeGreaterThan(0)

    // 同代码命中缓存：同一份 SVG，不重复渲染
    expect(await renderMermaid(CODE)).toBe(svgA)

    // 空代码 / 语法错误返回 null，由调用方保留代码块
    await expect(renderMermaid('   ')).resolves.toBeNull()
    await expect(renderMermaid('这不是图 ???')).resolves.toBeNull()
  })
})
