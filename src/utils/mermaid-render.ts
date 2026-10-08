// Mermaid 渲染单例：懒加载 + 按代码文本缓存（流式/多实例不重复渲染）
//
// 必须放在普通模块里（而不是 <script setup>）：script setup 是每组件实例一份状态，
// 多实例各自从 0 编渲染 id 会相撞——mermaid.render 会顺手删掉页面上同 id 的旧节点
// （removeExistingElements），表现为“一打开编辑弹窗原图就消失”。
type MermaidApi = typeof import('mermaid').default

let mermaidApi: MermaidApi | null = null
let renderSeq = 0
const cache = new Map<string, string>()

// 挂载前剥掉 svg 根 id：页面上永远不出现渲染 id，mermaid 后续 render 的清理再也碰不到已挂载的图
export function stripRootSvgId(svg: string): string {
  return svg.replace(/^(<svg\b[^>]*?)\s+id="[^"]*"/, '$1')
}

export function mermaidCacheKey(code: string): string {
  return code.trim()
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
    const { svg } = await mermaidApi.render(`hys-mmd-${++renderSeq}-${Math.random().toString(36).slice(2, 8)}`, key)
    const clean = stripRootSvgId(svg)
    cache.set(key, clean)
    return clean
  } catch {
    return null
  }
}
