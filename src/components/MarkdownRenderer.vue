<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, watch } from 'vue'
import MarkdownIt from 'markdown-it'
import markdownKatex from '@traptitech/markdown-it-katex'
import { renderMermaid } from '@/utils/mermaid-render'
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
  const out = await codeToHtml(source, { lang, theme: 'github-light' })
  if (highlightCache.size >= HIGHLIGHT_CACHE_MAX) {
    highlightCache.delete(highlightCache.keys().next().value!)
  }
  highlightCache.set(key, out)
  return out
}

const props = defineProps<{ content: string; editable?: boolean }>()
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
onUnmounted(() => {
  enhanceRun++
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

watch(html, () => void enhanceCodeBlocks(), { immediate: true })
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
.md-body :deep(.mermaid-diagram) {
  position: relative;
  margin: 16px 0;
  padding: 16px;
  background: #fff;
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
  background: #fff;
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.15s;
}
.md-body :deep(.mermaid-diagram:hover .mermaid-edit-btn) {
  opacity: 1;
}
</style>
