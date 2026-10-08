<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import MarkdownIt from 'markdown-it'
import markdownKatex from '@traptitech/markdown-it-katex'
import { codeToHtml } from 'shiki'
import 'katex/dist/katex.min.css'

const props = defineProps<{ content: string; editable?: boolean }>()
const emit = defineEmits<{ (e: 'edit-mermaid', code: string): void }>()

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

const container = ref<HTMLElement | null>(null)
const html = computed(() => md.render(props.content))

// ---------- Mermaid：懒加载 + 按代码文本缓存（流式输出期间不重复渲染） ----------
type MermaidApi = typeof import('mermaid').default
let mermaidApi: MermaidApi | null = null
let mermaidSeq = 0
const mermaidCache = new Map<string, string>()

async function renderMermaid(code: string): Promise<string | null> {
  const cached = mermaidCache.get(code)
  if (cached) return cached
  try {
    if (!mermaidApi) {
      mermaidApi = (await import('mermaid')).default
      mermaidApi.initialize({
        startOnLoad: false,
        securityLevel: 'antiscript',
        theme: 'neutral',
        suppressErrorRendering: true,
      })
    }
    const { svg } = await mermaidApi.render(`hys-mmd-${++mermaidSeq}`, code)
    mermaidCache.set(code, svg)
    return svg
  } catch {
    // 语法错误（流式未闭合/画错图）保留代码块原样
    return null
  }
}

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

// Shiki/Mermaid 都是异步的：先渲染普通 <pre><code>，挂载后逐块替换
async function enhanceCodeBlocks() {
  await nextTick()
  const root = container.value
  if (!root) return
  const blocks = root.querySelectorAll<HTMLPreElement>('pre')
  for (const pre of blocks) {
    const code = pre.querySelector('code')
    if (!code || pre.dataset.enhanced) continue
    pre.dataset.enhanced = '1'
    const lang = code.className.match(/language-([\w-]+)/)?.[1] || 'text'
    const source = code.textContent ?? ''

    if (lang === 'mermaid') {
      const svg = source.trim() ? await renderMermaid(source) : null
      if (svg) mountMermaid(pre, source, svg)
      continue
    }
    try {
      const highlighted = await codeToHtml(source, {
        lang,
        theme: 'github-light',
      })
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
  background: #f6f8fa;
  padding: 12px;
  border-radius: 8px;
  overflow-x: auto;
  font-size: 13px;
}
.md-body :deep(code) {
  font-family: 'SF Mono', Menlo, monospace;
  font-size: 0.92em;
}
.md-body :deep(:not(pre) > code) {
  background: #f0f1f3;
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
  padding: 5px 10px;
}
.md-body :deep(a) {
  color: #2563eb;
}
.md-body :deep(.md-figure) {
  margin: 16px 0;
  text-align: center;
}
.md-body :deep(.md-figure img) {
  max-width: 100%;
  height: auto;
  border-radius: 8px;
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
  border-radius: 8px;
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
  border-radius: 6px;
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.15s;
}
.md-body :deep(.mermaid-diagram:hover .mermaid-edit-btn) {
  opacity: 1;
}
</style>
