<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, watch } from 'vue'
import MarkdownIt from 'markdown-it'
import markdownKatex from '@traptitech/markdown-it-katex'
import { renderMermaid } from '@/utils/mermaid-render'
import { applyHighlights, unwrapHighlights, type HighlightAnchor } from '@/utils/highlight-dom'
import 'katex/dist/katex.min.css'

// MarkdownIt 规则配置是确定性的，全应用共享单例（否则一页 20+ 实例各自重建）
const md = new MarkdownIt({ html: false, linkify: true })
md.use(markdownKatex, { throwOnError: false })

// 外链新窗口打开
const defaultLinkOpen =
  md.renderer.rules.link_open ??
  ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options))
md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  tokens[idx].attrSet('target', '_blank')
  tokens[idx].attrSet('rel', 'noopener')
  return defaultLinkOpen(tokens, idx, options, env, self)
}

// 图片：![图注](src) → <figure> + 懒加载 + 图注
const defaultImage =
  md.renderer.rules.image ??
  ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options))
md.renderer.rules.image = (tokens, idx, options, env, self) => {
  tokens[idx].attrSet('loading', 'lazy')
  const img = defaultImage(tokens, idx, options, env, self)
  const caption = (tokens[idx].children ?? [])
    .map((t) => t.content)
    .join('')
    .trim()
  const figcaption = caption ? `<figcaption>${md.utils.escapeHtml(caption)}</figcaption>` : ''
  return `<figure class="md-figure">${img}${figcaption}</figure>`
}

// Shiki 动态导入（全量 grammar 数 MB，不进首屏共享 chunk）
type CodeToHtml = typeof import('shiki')['codeToHtml']
let shikiPromise: Promise<CodeToHtml> | null = null
function loadShiki(): Promise<CodeToHtml> {
  shikiPromise ??= import('shiki').then((m) => m.codeToHtml)
  return shikiPromise
}

// 高亮结果按 lang+源码缓存（LRU 上限 200）：流式/编辑场景每个 delta 都重渲，
// 不缓存的话同一段代码会被 codeToHtml 反复计算
const highlightCache = new Map<string, string>()
const HIGHLIGHT_CACHE_MAX = 200

async function highlight(source: string, lang: string): Promise<string> {
  const key = `${lang}\n${source}`
  const hit = highlightCache.get(key)
  if (hit) {
    highlightCache.delete(key)
    highlightCache.set(key, hit)
    return hit
  }
  const codeToHtml = await loadShiki()
  // 双主题：元素只带 --shiki-light/-dark 变量，亮暗由 CSS 切换（见下方 .shiki 样式）
  const out = await codeToHtml(source, {
    lang,
    themes: { light: 'github-light', dark: 'github-dark' },
    defaultColor: false,
  })
  if (highlightCache.size >= HIGHLIGHT_CACHE_MAX) {
    highlightCache.delete(highlightCache.keys().next().value!)
  }
  highlightCache.set(key, out)
  return out
}

const props = defineProps<{
  content: string
  editable?: boolean
  // 参考来源（供正文 [n] 引用标记 hover 显示标题预览）
  citeSources?: { idx: number; title: string; url?: string }[]
  // 本节划线锚点（绿色高亮）；区块由父组件按章节传入
  highlights?: HighlightAnchor[]
}>()
const emit = defineEmits<{ (e: 'edit-mermaid', code: string): void }>()

const container = ref<HTMLElement | null>(null)
const html = computed(() => md.render(props.content))

// Mermaid 渲染走模块级单例（懒加载 + 缓存见 utils/mermaid-render.ts）
function mountMermaid(pre: HTMLPreElement, code: string, svg: string) {
  const wrap = document.createElement('div')
  wrap.className = 'mermaid-diagram'
  wrap.innerHTML = svg
  if (props.editable) {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'mermaid-edit-btn'
    btn.textContent = '编辑图表'
    btn.addEventListener('click', () => emit('edit-mermaid', code))
    wrap.appendChild(btn)
  }
  pre.replaceWith(wrap)
}

// 过期增强任务丢弃：内容快速变化时多轮 enhance 交错，旧轮次不得再操作 DOM
let enhanceRun = 0
// 划线有独立的轮次计数（与代码/引用增强互不干扰）
let hlRun = 0
onUnmounted(() => {
  enhanceRun++
  hlRun++
})

// Shiki/Mermaid 都是异步的：先渲染普通 <pre><code>，挂载后逐块替换
async function enhanceCodeBlocks() {
  const run = ++enhanceRun
  await nextTick()
  const root = container.value
  if (!root) return
  const blocks = root.querySelectorAll<HTMLPreElement>('pre')
  for (const pre of blocks) {
    if (run !== enhanceRun) return
    // Shiki 产物（pre.shiki）不含 language class，跳过避免被当成新块重复高亮
    if (pre.classList.contains('shiki') || pre.dataset.enhanced) continue
    const code = pre.querySelector('code')
    if (!code) continue
    pre.dataset.enhanced = '1'
    const lang = code.className.match(/language-([\w-]+)/)?.[1] || 'text'
    const source = code.textContent ?? ''

    if (lang === 'mermaid') {
      const svg = source.trim() ? await renderMermaid(source) : null
      if (run !== enhanceRun) return
      if (svg) mountMermaid(pre, source, svg)
      continue
    }
    try {
      const highlighted = await highlight(source, lang)
      if (run !== enhanceRun) return
      pre.outerHTML = highlighted
    } catch {
      // 未知语言等高亮失败时保留原样
    }
  }
}

// 正文纯文本引用 [n] → 可 hover 预览来源标题的角标。
// 走 DOM 文本节点替换（而不是改 html 字符串），不会误伤链接/属性里的方括号
async function enhanceCitations() {
  await nextTick()
  const root = container.value
  if (!root || !props.citeSources?.length) return
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const targets: Text[] = []
  let node: Node | null = walker.nextNode()
  while (node) {
    const text = node as Text
    if (/\[\d+\]/.test(text.nodeValue ?? '')) {
      const parent = text.parentElement
      // 跳过代码块/链接/按钮/已处理角标
      if (parent && !parent.closest('pre, code, a, button, .md-cite, figcaption')) {
        targets.push(text)
      }
    }
    node = walker.nextNode()
  }
  for (const text of targets) {
    const frag = document.createDocumentFragment()
    for (const part of (text.nodeValue ?? '').split(/(\[\d+\])/g)) {
      const m = part.match(/^\[(\d+)\]$/)
      if (!m) {
        if (part) frag.appendChild(document.createTextNode(part))
        continue
      }
      const n = Number(m[1])
      const src = props.citeSources?.find((s) => s.idx === n)
      const el = document.createElement('sup')
      el.className = 'md-cite'
      el.textContent = part
      el.dataset.title = src ? `来源 ${n}：${src.title}` : `来源 ${n}`
      frag.appendChild(el)
    }
    text.parentNode?.replaceChild(frag, text)
  }
}

// 划线：先清除旧绿标再按锚点重画（增删划线时可只重跑这一步）
async function applyHighlightsRun() {
  const run = ++hlRun
  await nextTick()
  const root = container.value
  if (!root || run !== hlRun) return
  unwrapHighlights(root)
  if (props.highlights?.length) applyHighlights(root, props.highlights)
}

watch(html, () => {
  void enhanceCodeBlocks()
  void enhanceCitations()
  void applyHighlightsRun()
}, { immediate: true })
// 仅划线变化（增删）时正文 html 不变，需单独触发重绘
watch(
  () => props.highlights,
  () => void applyHighlightsRun(),
)
</script>

<template>
  <!-- eslint-disable vue/no-v-html -->
  <div
    ref="container"
    class="md-body"
    v-html="html"
  />
</template>

<style scoped>
.md-body {
  font-size: 15px;
  line-height: 1.8;
  max-width: 820px;
}
.md-body :deep(h1) {
  font-size: 24px;
  border-bottom: 1px solid var(--border);
  padding-bottom: 8px;
}
.md-body :deep(h2) {
  font-size: 19px;
  margin-top: 28px;
}
.md-body :deep(h3) {
  font-size: 16px;
}
.md-body :deep(pre) {
  background: var(--bg-subtle);
  border: 1px solid var(--border);
  padding: 14px 16px;
  border-radius: var(--r-md);
  overflow-x: auto;
  font-size: 13px;
}
/* Shiki 双主题：defaultColor:false 输出 --shiki-light/-dark 变量，这里按主题选用 */
.md-body :deep(.shiki) {
  background-color: var(--shiki-light-bg) !important;
  color: var(--shiki-light);
}
.md-body :deep(.shiki span) {
  color: var(--shiki-light);
}
html[data-theme='dark'] .md-body :deep(.shiki) {
  background-color: var(--shiki-dark-bg) !important;
  color: var(--shiki-dark);
}
html[data-theme='dark'] .md-body :deep(.shiki span) {
  color: var(--shiki-dark);
}
.md-body :deep(code) {
  font-family: 'SF Mono', Menlo, monospace;
  font-size: 0.92em;
}
.md-body :deep(:not(pre) > code) {
  background: var(--bg-muted);
  padding: 1px 5px;
  border-radius: 4px;
}
.md-body :deep(blockquote) {
  margin: 0;
  padding: 4px 14px;
  border-left: 3px solid var(--border);
  color: var(--text-dim);
}
.md-body :deep(table) {
  border-collapse: collapse;
}
.md-body :deep(th),
.md-body :deep(td) {
  border: 1px solid var(--border);
  padding: 6px 12px;
}
.md-body :deep(th) {
  background: var(--bg-subtle);
  font-weight: 600;
}
.md-body :deep(a) {
  color: var(--primary-strong);
}
.md-body :deep(.md-figure) {
  margin: 16px 0;
  text-align: center;
}
.md-body :deep(.md-figure img) {
  max-width: 100%;
  height: auto;
  border-radius: var(--r-sm);
  border: 1px solid var(--border);
}
.md-body :deep(.md-figure figcaption) {
  margin-top: 6px;
  font-size: 13px;
  color: var(--text-dim);
}
/* 引用角标：hover 显示来源标题预览 */
.md-body :deep(.md-cite) {
  position: relative;
  display: inline-block;
  font-size: 11px;
  font-weight: 600;
  line-height: 1.4;
  padding: 0 4px;
  margin: 0 1px;
  border-radius: 4px;
  background: var(--primary-bg);
  color: var(--primary-strong);
  cursor: help;
  vertical-align: 1px;
  user-select: none;
}
.md-body :deep(.md-cite)::after {
  content: attr(data-title);
  position: absolute;
  left: 50%;
  top: calc(100% + 8px);
  transform: translateX(-50%);
  width: max-content;
  max-width: 320px;
  padding: 8px 10px;
  font-size: 12px;
  font-weight: 400;
  line-height: 1.6;
  text-align: left;
  white-space: normal;
  color: var(--text);
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  box-shadow: var(--shadow-lg);
  opacity: 0;
  visibility: hidden;
  transition: opacity var(--dur-fast) var(--ease);
  z-index: var(--z-toast);
  pointer-events: none;
}
.md-body :deep(.md-cite:hover)::after {
  opacity: 1;
  visibility: visible;
}
.md-body :deep(.mermaid-diagram) {
  position: relative;
  margin: 16px 0;
  padding: 16px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  overflow-x: auto;
  text-align: center;
}
.md-body :deep(.mermaid-diagram svg) {
  max-width: 100%;
  height: auto;
}
.md-body :deep(.mermaid-edit-btn) {
  position: absolute;
  top: 8px;
  right: 8px;
  padding: 2px 10px;
  font-size: 12px;
  color: var(--text-dim);
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.15s;
}
.md-body :deep(.mermaid-diagram:hover .mermaid-edit-btn) {
  opacity: 1;
}
/* 课程划线：绿色标注重点/好句，可点击查看与删除 */
.md-body :deep(.lesson-hl) {
  background: var(--green-bg);
  color: inherit;
  border-radius: 2px;
  padding: 1px 0;
  box-shadow: inset 0 -2px 0 var(--mastery-green);
  cursor: pointer;
  transition: background var(--dur-fast) var(--ease);
}
.md-body :deep(.lesson-hl:hover) {
  background: var(--green-border);
}
/* 从划线本跳转过来时闪一下，便于定位 */
.md-body :deep(.lesson-hl--flash) {
  animation: lesson-hl-flash 1.2s ease;
}
@keyframes lesson-hl-flash {
  0% {
    box-shadow:
      inset 0 -2px 0 var(--mastery-green),
      0 0 0 0 var(--mastery-green);
  }
  60% {
    box-shadow:
      inset 0 -2px 0 var(--mastery-green),
      0 0 0 6px transparent;
  }
  100% {
    box-shadow: inset 0 -2px 0 var(--mastery-green);
  }
}

/* ---------- 手机端正文 ---------- */
@media (max-width: 720px) {
  .md-body {
    max-width: 100%;
    font-size: 15px;
    line-height: 1.85;
    overflow-wrap: anywhere;
  }
  .md-body :deep(h1) {
    font-size: 21px;
  }
  .md-body :deep(h2) {
    font-size: 18px;
    margin-top: 24px;
  }
  /* 触屏没有 hover，引用角标的悬浮卡无法使用，且其绝对定位会撑宽页面 */
  .md-body :deep(.md-cite)::after {
    display: none;
  }
  .md-body :deep(pre) {
    max-width: 100%;
    padding: 12px;
    font-size: 12.5px;
    -webkit-overflow-scrolling: touch;
  }
  /* 宽表格在正文内横向滚动，不把整页撑宽 */
  .md-body :deep(table) {
    display: block;
    width: max-content;
    max-width: 100%;
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
  }
  .md-body :deep(th),
  .md-body :deep(td) {
    padding: 6px 10px;
    white-space: nowrap;
  }
  .md-body :deep(.mermaid-diagram) {
    padding: 10px;
  }
  .md-body :deep(.md-figure) {
    margin: 14px 0;
  }
}
</style>
