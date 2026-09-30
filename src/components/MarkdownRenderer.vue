<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import MarkdownIt from 'markdown-it'
import markdownKatex from '@traptitech/markdown-it-katex'
import { codeToHtml } from 'shiki'
import 'katex/dist/katex.min.css'

const props = defineProps<{ content: string }>()

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

const container = ref<HTMLElement | null>(null)
const html = computed(() => md.render(props.content))

// Shiki 是异步的：先渲染普通 <pre><code>，挂载后逐块替换为高亮 HTML
async function enhanceCodeBlocks() {
  await nextTick()
  const root = container.value
  if (!root) return
  const blocks = root.querySelectorAll<HTMLPreElement>('pre')
  for (const pre of blocks) {
    const code = pre.querySelector('code')
    if (!code || pre.dataset.shikiDone) continue
    pre.dataset.shikiDone = '1'
    const lang = code.className.match(/language-([\w-]+)/)?.[1] || 'text'
    try {
      const highlighted = await codeToHtml(code.textContent ?? '', {
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
</style>
