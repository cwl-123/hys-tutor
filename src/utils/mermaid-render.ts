// Mermaid 渲染单例：懒加载 + 按代码文本缓存（流式/多实例不重复渲染）
//
// 必须放在普通模块里（而不是 <script setup>）：script setup 是每组件实例一份状态，
// 多实例各自从 0 编渲染 id 会相撞——mermaid.render 会顺手删掉页面上同 id 的旧节点
// （removeExistingElements），表现为“一打开编辑弹窗原图就消失”。
type MermaidApi = typeof import('mermaid').default

let mermaidApi: MermaidApi | null = null
let renderSeq = 0
const cache = new Map<string, string>()

export function mermaidCacheKey(code: string): string {
  return code.trim()
}

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 10)
}

// 渲染 mermaid 代码为 SVG 字符串；语法错误/空代码返回 null（调用方保留代码块原样）
export async function renderMermaid(code: string): Promise<string | null> {
  const key = mermaidCacheKey(code)
  if (!key) return null
  const cached = cache.get(key)
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
    const renderId = `hys-r${++renderSeq}-${randomSuffix()}`
    const { svg } = await mermaidApi.render(renderId, key)
    // 整体重写渲染 id 为挂载 id：
    // - 样式作用域 #id 挂在根 svg 上，id 必须保留（删了整个配色会失效、图变黑块）
    // - 但页面上的 id 绝不能与后续 mermaid.render 传入的 id 相同
    //   （render 前的 removeExistingElements 会删掉页面上同 id 的节点）
    const mountId = `hys-m${randomSuffix()}`
    const clean = svg.split(renderId).join(mountId)
    cache.set(key, clean)
    return clean
  } catch {
    return null
  }
}
