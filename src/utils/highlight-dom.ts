// 课件划线在 DOM 上的定位与包裹。
// 锚点用「文字 + 同容器内第几次出现」描述，重渲染/编辑正文后仍能重新定位；
// 无法匹配时仅不画绿标，划线记录本身仍保留在划线本里。

export interface HighlightAnchor {
  id: string
  text: string
  occurrence: number
}

// 不参与划线的区域：代码块/引用角标/图表，避免包裹破坏其结构
const SKIP_SELECTOR = 'pre, code, .md-cite, .mermaid-diagram, .mermaid-edit-btn, figcaption'

interface TextSpan {
  node: Text
  start: number
  end: number
}

function collectTextNodes(root: HTMLElement): TextSpan[] {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const spans: TextSpan[] = []
  let acc = 0
  let node = walker.nextNode()
  while (node) {
    const text = node as Text
    const parent = text.parentElement
    const len = (text.nodeValue ?? '').length
    if (len > 0 && !parent?.closest(SKIP_SELECTOR)) {
      spans.push({ node: text, start: acc, end: acc + len })
    }
    acc += len
    node = walker.nextNode()
  }
  return spans
}

function joinSpans(spans: TextSpan[]): string {
  return spans.map((s) => s.node.nodeValue ?? '').join('')
}

// 把 [start,end) 这段文字逐文本节点切分并包进 <mark class="lesson-hl">
function wrapRange(spans: TextSpan[], start: number, end: number, id: string): void {
  for (const span of spans) {
    const a = Math.max(start, span.start)
    const b = Math.min(end, span.end)
    if (b <= a) continue
    const value = span.node.nodeValue ?? ''
    const relStart = a - span.start
    const relEnd = b - span.start
    const before = value.slice(0, relStart)
    const mid = value.slice(relStart, relEnd)
    const after = value.slice(relEnd)
    const parent = span.node.parentNode
    if (!parent) continue
    const mark = document.createElement('mark')
    mark.className = 'lesson-hl'
    mark.dataset.hlId = id
    mark.textContent = mid
    if (before) parent.insertBefore(document.createTextNode(before), span.node)
    parent.insertBefore(mark, span.node)
    if (after) parent.insertBefore(document.createTextNode(after), span.node)
    parent.removeChild(span.node)
  }
}

// 在给定出现次序处包裹文字；occurrence 越界时回退到第一次出现
function wrapAtOccurrence(root: HTMLElement, anchor: HighlightAnchor): void {
  const spans = collectTextNodes(root)
  const full = joinSpans(spans)
  let target = -1
  let n = 0
  let pos = full.indexOf(anchor.text)
  while (pos !== -1) {
    if (n === anchor.occurrence) {
      target = pos
      break
    }
    n++
    pos = full.indexOf(anchor.text, pos + 1)
  }
  if (target === -1) target = full.indexOf(anchor.text)
  if (target === -1) return
  wrapRange(spans, target, target + anchor.text.length, anchor.id)
}

// 清除既有划线（还原为纯文本），供重渲染前重置
export function unwrapHighlights(root: HTMLElement): void {
  for (const mark of Array.from(root.querySelectorAll('mark.lesson-hl'))) {
    const parent = mark.parentNode
    if (!parent) continue
    parent.replaceChild(document.createTextNode(mark.textContent ?? ''), mark)
    parent.normalize()
  }
}

export function applyHighlights(root: HTMLElement, anchors: HighlightAnchor[]): void {
  for (const anchor of anchors) {
    if (!anchor.text) continue
    wrapAtOccurrence(root, anchor)
  }
}

// 依据选区起点，算出「文字」在容器内是第几次出现（用于创建划线时固定锚点）
export function computeOccurrence(
  root: HTMLElement,
  startNode: Node,
  startOffset: number,
  text: string,
): number {
  if (!text || !root.contains(startNode)) return 0
  const range = document.createRange()
  range.selectNodeContents(root)
  try {
    range.setEnd(startNode, startOffset)
  } catch {
    return 0
  }
  const before = range.toString()
  let count = 0
  let pos = before.indexOf(text)
  while (pos !== -1) {
    count++
    pos = before.indexOf(text, pos + 1)
  }
  return count
}