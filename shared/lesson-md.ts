// 课程 markdown 的章节级操作：解析 / 定位 / 局部替换。
// 章节 = 二级标题（##）起始、到下一个二级标题之前的内容；
// 首个二级标题之前的内容视为前言（heading = null）。

export interface LessonSection {
  heading: string | null
  raw: string
  start: number
  end: number
}

export function parseSections(md: string): LessonSection[] {
  const lines = md.split('\n')
  const lineStart: number[] = []
  let acc = 0
  for (const line of lines) {
    lineStart.push(acc)
    acc += line.length + 1
  }

  const sections: LessonSection[] = []
  let heading: string | null = null
  let startLine = 0
  let inFence = false

  const flush = (endLine: number): void => {
    const start = lineStart[startLine] ?? 0
    const end = endLine >= lines.length ? md.length : lineStart[endLine] - 1
    const raw = md.slice(start, end)
    if (raw.trim()) sections.push({ heading, raw, start, end })
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence
      continue
    }
    if (inFence) continue
    const m = line.match(/^##\s+(.+?)\s*$/)
    if (m) {
      flush(i)
      heading = m[1].trim()
      startLine = i
    }
  }
  flush(lines.length)
  return sections
}

export function listHeadings(md: string): string[] {
  return parseSections(md)
    .map((s) => s.heading)
    .filter((h): h is string => Boolean(h))
}

// 依标题定位章节：精确 → 忽略大小写 → 包含关系兜底
export function findSectionByHeading(md: string, heading: string): LessonSection | null {
  const target = heading.trim()
  if (!target) return null
  const sections = parseSections(md)
  return (
    sections.find((s) => s.heading === target) ??
    sections.find((s) => s.heading?.toLowerCase() === target.toLowerCase()) ??
    sections.find(
      (s) => s.heading && (s.heading.includes(target) || target.includes(s.heading)),
    ) ??
    null
  )
}

// 用修订后的章节 markdown 替换原文中对应章节；返回新的完整正文，定位失败返回 null
export function replaceSection(md: string, heading: string, revisedMd: string): string | null {
  const section = findSectionByHeading(md, heading)
  if (!section) return null
  return `${md.slice(0, section.start)}${revisedMd.trim()}${md.slice(section.end)}`
}

function normalize(text: string): string {
  return text.replace(/\s+/g, '')
}

// 依引用文字定位所属章节（供划词引用时判断改哪一节）
export function findSectionForQuote(md: string, quote: string): string | null {
  const target = normalize(quote)
  if (!target) return null
  let best: { heading: string; score: number } | null = null
  for (const s of parseSections(md)) {
    if (!s.heading) continue
    const body = normalize(s.raw)
    let score = 0
    if (body.includes(target)) score = target.length * 10
    else {
      for (const ch of new Set(target)) if (body.includes(ch)) score += 1
    }
    if (score > 0 && (!best || score > best.score)) best = { heading: s.heading, score }
  }
  return best?.heading ?? null
}