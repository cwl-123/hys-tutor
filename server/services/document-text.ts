// 开课附件文本抽取：图片交给多模态模型直接看，其余文件在这里转成纯文本。
// 不引第三方解析库：PDF 用 zlib 自己解内容流，DOCX/PPTX 走 ZIP + XML，
// 纯文本按 UTF-8 / GB18030 顺序尝试。读不出来时返回空文本，由调用方给用户可执行的提示。
import { inflateRawSync, inflateSync } from 'node:zlib'

export interface ExtractedDocument {
  format: string
  text: string
}

const MAX_INFLATE_BYTES = 20 * 1024 * 1024

export function looksLikePdf(buf: Buffer): boolean {
  return buf.subarray(0, 1024).toString('latin1').includes('%PDF-')
}

export function looksLikeZip(buf: Buffer): boolean {
  return (
    buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b && (buf[2] === 0x03 || buf[2] === 0x05)
  )
}

export function extractDocumentText(buf: Buffer): ExtractedDocument | null {
  if (!buf.length) return null
  if (looksLikePdf(buf)) return { format: 'pdf', text: cleanText(extractPdfText(buf)) }
  if (looksLikeZip(buf)) return extractOoxml(buf)
  const text = decodePlainText(buf)
  if (text === null) return null
  return { format: 'text', text: cleanText(text) }
}

// ---------- 纯文本 ----------

function decodePlainText(buf: Buffer): string | null {
  // Windows 记事本常存的 UTF-16（带 BOM）
  if (buf[0] === 0xff && buf[1] === 0xfe) {
    const text = new TextDecoder('utf-16le').decode(buf.subarray(2))
    return isMostlyText(text) ? text : null
  }
  if (buf[0] === 0xfe && buf[1] === 0xff) {
    const text = new TextDecoder('utf-16be').decode(buf.subarray(2))
    return isMostlyText(text) ? text : null
  }
  // NUL 字节基本可以判定是二进制
  if (buf.subarray(0, 2048).includes(0)) return null
  const decoders = ['utf-8', 'gb18030']
  for (const encoding of decoders) {
    try {
      const text = new TextDecoder(encoding, { fatal: true }).decode(buf)
      if (!isMostlyText(text)) continue
      return text
    } catch {
      // 换下一种编码
    }
  }
  try {
    const text = new TextDecoder('utf-8').decode(buf)
    return isMostlyText(text) ? text : null
  } catch {
    return null
  }
}

function isMostlyText(text: string): boolean {
  if (!text) return false
  let bad = 0
  const sample = text.slice(0, 4000)
  for (const ch of sample) {
    const code = ch.codePointAt(0) ?? 0
    if (code === 0xfffd) bad++
    else if (code < 0x20 && code !== 9 && code !== 10 && code !== 13) bad++
  }
  return bad / Math.max(sample.length, 1) < 0.05
}

// ---------- DOCX / PPTX ----------

function readZipEntries(buf: Buffer): Map<string, Buffer> {
  const entries = new Map<string, Buffer>()
  let eocd = -1
  const minPos = Math.max(0, buf.length - 22 - 65535)
  for (let i = buf.length - 22; i >= minPos; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) return entries
  const count = buf.readUInt16LE(eocd + 10)
  let p = buf.readUInt32LE(eocd + 16)
  for (let i = 0; i < count; i++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) break
    const method = buf.readUInt16LE(p + 10)
    const compressedSize = buf.readUInt32LE(p + 20)
    const nameLen = buf.readUInt16LE(p + 28)
    const extraLen = buf.readUInt16LE(p + 30)
    const commentLen = buf.readUInt16LE(p + 32)
    const offset = buf.readUInt32LE(p + 42)
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8')
    p += 46 + nameLen + extraLen + commentLen

    const entry = readLocalZipEntry(buf, offset, method, compressedSize)
    if (entry) entries.set(name, entry)
  }
  return entries
}

function readLocalZipEntry(
  buf: Buffer,
  offset: number,
  method: number,
  compressedSize: number,
): Buffer | null {
  if (offset + 30 > buf.length || buf.readUInt32LE(offset) !== 0x04034b50) return null
  const nameLen = buf.readUInt16LE(offset + 26)
  const extraLen = buf.readUInt16LE(offset + 28)
  const start = offset + 30 + nameLen + extraLen
  if (start + compressedSize > buf.length) return null
  const raw = buf.subarray(start, start + compressedSize)
  try {
    if (method === 0) return raw
    if (method === 8) return inflateRawSync(raw, { maxOutputLength: MAX_INFLATE_BYTES })
  } catch {
    return null
  }
  return null
}

function decodeXmlEntities(input: string): string {
  return input
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

function extractOoxml(buf: Buffer): ExtractedDocument | null {
  const entries = readZipEntries(buf)
  const doc = entries.get('word/document.xml')
  if (doc) {
    const xml = doc.toString('utf8')
    const text = xml
      .replace(/<w:tab\b[^>]*\/>/g, '\t')
      .replace(/<w:br\b[^>]*\/>/g, '\n')
      .replace(/<\/w:p>/g, '\n')
      .replace(/<\/w:tr>/g, '\n')
      .replace(/<\/w:tc>/g, '\t')
      .replace(/<[^>]+>/g, '')
    return { format: 'docx', text: cleanText(decodeXmlEntities(text)) }
  }

  const slides = [...entries.keys()]
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => slideNo(a) - slideNo(b))
  if (slides.length) {
    const pages = slides.map((name, idx) => {
      const xml = entries.get(name)?.toString('utf8') ?? ''
      const runs = [...xml.matchAll(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g)].map((m) =>
        decodeXmlEntities(m[1]),
      )
      const body = runs.join(' ').trim()
      return body ? `【第 ${idx + 1} 页】${body}` : ''
    })
    return { format: 'pptx', text: cleanText(pages.filter(Boolean).join('\n\n')) }
  }

  // 其它 zip（xlsx / 压缩包）不猜内容，交给上层提示用户换格式
  return null
}

function slideNo(name: string): number {
  return Number(name.match(/slide(\d+)\.xml$/)?.[1] ?? 0)
}

// ---------- PDF ----------

interface PdfObject {
  dict: string
  stream?: Buffer
}

interface PdfFont {
  cmap: Map<string, string> | null
  keyWidth: number
}

const REF_RE = /\/([A-Za-z0-9]+)\s+(\d+)\s+\d+\s+R/g

function refOf(dict: string, key: string): number | null {
  const m = dict.match(new RegExp(`/${key}\\s+(\\d+)\\s+\\d+\\s+R`))
  return m ? Number(m[1]) : null
}

// 从 dict 中取内联字典 << ... >>（支持嵌套），取不到返回 null
function inlineDict(dict: string, key: string): string | null {
  const keyIdx = dict.search(new RegExp(`/${key}\\s*<<`))
  if (keyIdx < 0) return null
  const start = dict.indexOf('<<', keyIdx)
  let depth = 0
  let i = start
  while (i < dict.length) {
    if (dict[i] === '<' && dict[i + 1] === '<') {
      depth++
      i += 2
      continue
    }
    if (dict[i] === '>' && dict[i + 1] === '>') {
      depth--
      i += 2
      if (depth === 0) return dict.slice(start + 2, i - 2)
      continue
    }
    i++
  }
  return null
}

function parsePdfObjects(buf: Buffer): Map<number, PdfObject> {
  const objects = new Map<number, PdfObject>()
  const s = buf.toString('latin1')
  const re = /(\d+)\s+(\d+)\s+obj\b/g
  let m: RegExpExecArray | null
  while ((m = re.exec(s))) {
    const num = Number(m[1])
    const start = m.index + m[0].length
    const objEnd = s.indexOf('endobj', start)
    const streamIdx = s.indexOf('stream', start)
    let dict = ''
    let stream: Buffer | undefined
    let nextPos = start

    if (streamIdx >= 0 && (objEnd < 0 || streamIdx < objEnd) && isStreamKeyword(s, streamIdx)) {
      dict = s.slice(start, streamIdx).trim()
      let dataStart = streamIdx + 'stream'.length
      if (s[dataStart] === '\r') dataStart++
      if (s[dataStart] === '\n') dataStart++
      const endstream = s.indexOf('endstream', dataStart)
      if (endstream < 0) {
        re.lastIndex = start
        continue
      }
      let dataEnd = endstream
      while (dataEnd > dataStart && (s[dataEnd - 1] === '\n' || s[dataEnd - 1] === '\r')) dataEnd--
      stream = buf.subarray(dataStart, dataEnd)
      nextPos = endstream + 'endstream'.length
    } else {
      dict = s.slice(start, objEnd >= 0 ? objEnd : s.length).trim()
      nextPos = objEnd >= 0 ? objEnd + 'endobj'.length : s.length
    }

    objects.set(num, { dict, stream })
    re.lastIndex = Math.max(re.lastIndex, nextPos)
  }
  expandObjectStreams(objects)
  return objects
}

// 排除 “endstream” 这类误命中：关键字前必须是空白
function isStreamKeyword(s: string, idx: number): boolean {
  const prev = s[idx - 1]
  return prev === undefined || /\s/.test(prev)
}

// 部分 PDF 把对象压进 /ObjStm，展开后字体/页面字典才找得到
function expandObjectStreams(objects: Map<number, PdfObject>): void {
  for (const obj of [...objects.values()]) {
    if (!/\/Type\s*\/ObjStm/.test(obj.dict)) continue
    const data = decodeStream(obj)
    if (!data) continue
    const first = Number(obj.dict.match(/\/First\s+(\d+)/)?.[1] ?? 0)
    const count = Number(obj.dict.match(/\/N\s+(\d+)/)?.[1] ?? 0)
    if (!first || !count) continue
    const header = data.subarray(0, first).toString('latin1').trim().split(/\s+/).map(Number)
    for (let i = 0; i < count; i++) {
      const objNum = header[i * 2]
      const offset = header[i * 2 + 1]
      if (!Number.isFinite(objNum) || !Number.isFinite(offset)) continue
      const body = data.subarray(first + offset).toString('latin1')
      const end = body.search(/\bendobj\b/)
      const dict = (end >= 0 ? body.slice(0, end) : body).trim()
      if (dict) objects.set(objNum, { dict })
    }
  }
}

function decodeStream(obj: PdfObject): Buffer | null {
  if (!obj.stream) return null
  const filter = obj.dict.match(/\/Filter\s*(\[[^\]]*\]|\/[A-Za-z0-9]+)/)?.[1] ?? ''
  if (!/FlateDecode/.test(filter)) {
    // 无压缩或其它编码：无压缩直接用，其它编码放弃
    return filter ? null : obj.stream
  }
  try {
    return inflateSync(obj.stream, { maxOutputLength: MAX_INFLATE_BYTES })
  } catch {
    return null
  }
}

function hexToUnicode(hex: string): string {
  let out = ''
  const clean = hex.length % 2 ? `${hex}0` : hex
  for (let i = 0; i + 3 < clean.length; i += 4) {
    out += String.fromCharCode(parseInt(clean.slice(i, i + 4), 16))
  }
  return out
}

// 只解析 ToUnicode CMap 里最常见的 bfchar / bfrange
function parseCMap(text: string): Map<string, string> {
  const map = new Map<string, string>()
  for (const block of text.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const pair of block[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) {
      map.set(pair[1].toLowerCase(), hexToUnicode(pair[2]))
    }
  }
  for (const block of text.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    const rangeRe = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*(?:<([0-9A-Fa-f]+)>|\[([\s\S]*?)\])/g
    for (const range of block[1].matchAll(rangeRe)) {
      const lo = parseInt(range[1], 16)
      const hi = parseInt(range[2], 16)
      const width = range[1].length
      if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi < lo || hi - lo > 65535) continue
      if (range[3]) {
        const dst = range[3]
        const prefix = dst.length > 4 ? dst.slice(0, -4) : ''
        const base = parseInt(dst.slice(-4), 16)
        for (let code = lo; code <= hi; code++) {
          const key = code.toString(16).padStart(width, '0')
          map.set(key, hexToUnicode(prefix + (base + code - lo).toString(16).padStart(4, '0')))
        }
      } else {
        const items = [...(range[4] ?? '').matchAll(/<([0-9A-Fa-f]+)>/g)].map((x) => x[1])
        items.forEach((dst, i) => {
          const code = lo + i
          if (code > hi) return
          map.set(code.toString(16).padStart(width, '0'), hexToUnicode(dst))
        })
      }
    }
  }
  return map
}

function parseFont(num: number, objects: Map<number, PdfObject>): PdfFont | null {
  const obj = objects.get(num)
  if (!obj) return null
  const toUni = refOf(obj.dict, 'ToUnicode')
  let cmap: Map<string, string> | null = null
  if (toUni) {
    const streamObj = objects.get(toUni)
    const data = streamObj ? decodeStream(streamObj) : null
    if (data) cmap = parseCMap(data.toString('latin1'))
  }
  const type0 = /\/Subtype\s*\/Type0/.test(obj.dict)
  const firstKey = cmap && cmap.size ? [...cmap.keys()][0] : ''
  const keyWidth = firstKey.length === 4 ? 2 : type0 ? 2 : 1
  return { cmap, keyWidth: cmap && cmap.size ? keyWidth : type0 ? 2 : 1 }
}

function pageResources(pageNum: number, objects: Map<number, PdfObject>): string {
  let dict = objects.get(pageNum)?.dict ?? ''
  for (let depth = 0; depth < 4 && dict; depth++) {
    const inline = inlineDict(dict, 'Resources')
    if (inline) return inline
    const resRef = refOf(dict, 'Resources')
    if (resRef) return objects.get(resRef)?.dict ?? ''
    const parent = refOf(dict, 'Parent')
    if (!parent) break
    dict = objects.get(parent)?.dict ?? ''
  }
  return ''
}

function fontsOf(pageNum: number, objects: Map<number, PdfObject>): Map<string, PdfFont> {
  const fonts = new Map<string, PdfFont>()
  const resources = pageResources(pageNum, objects)
  if (!resources) return fonts
  const inline = inlineDict(resources, 'Font')
  const fontRef = refOf(resources, 'Font')
  const block = inline ?? (fontRef ? (objects.get(fontRef)?.dict ?? '') : '')
  if (!block) return fonts
  for (const m of block.matchAll(REF_RE)) {
    const font = parseFont(Number(m[2]), objects)
    if (font) fonts.set(m[1], font)
  }
  return fonts
}

// 所有资源字典里的字体按资源名兜底（内容流里 Tf 没匹配到页面字体时用）
function allFonts(objects: Map<number, PdfObject>): Map<string, PdfFont> {
  const fonts = new Map<string, PdfFont>()
  for (const obj of objects.values()) {
    const inline = inlineDict(obj.dict, 'Font')
    const fontRef = refOf(obj.dict, 'Font')
    const block = inline ?? (fontRef ? (objects.get(fontRef)?.dict ?? '') : '')
    if (!block) continue
    for (const m of block.matchAll(REF_RE)) {
      const font = parseFont(Number(m[2]), objects)
      if (font) fonts.set(m[1], font)
    }
  }
  return fonts
}

function contentRefs(pageDict: string): number[] {
  const inline = inlineDict(pageDict, 'Contents')
  if (inline) return [...inline.matchAll(/(\d+)\s+\d+\s+R/g)].map((m) => Number(m[1]))
  const single = refOf(pageDict, 'Contents')
  if (single !== null) return [single]
  return []
}

interface PdfToken {
  t: 'str' | 'num' | 'name' | 'op' | '[' | ']'
  v?: Buffer | number | string
}

function* tokenizeContent(content: string): Generator<PdfToken> {
  let i = 0
  const isWs = (c: string) =>
    c === ' ' || c === '\n' || c === '\r' || c === '\t' || c === '\f' || c === '\0'
  const isDelim = (c: string) => '()<>[]{}/%'.includes(c)
  while (i < content.length) {
    const c = content[i]
    if (isWs(c)) {
      i++
      continue
    }
    if (c === '%') {
      while (i < content.length && content[i] !== '\n' && content[i] !== '\r') i++
      continue
    }
    if (c === '(') {
      i++
      const bytes: number[] = []
      let depth = 1
      while (i < content.length && depth > 0) {
        const ch = content[i]
        if (ch === '\\') {
          const esc = content[i + 1]
          i += 2
          switch (esc) {
            case 'n':
              bytes.push(10)
              break
            case 'r':
              bytes.push(13)
              break
            case 't':
              bytes.push(9)
              break
            case 'b':
              bytes.push(8)
              break
            case 'f':
              bytes.push(12)
              break
            case '(':
              bytes.push(40)
              break
            case ')':
              bytes.push(41)
              break
            case '\\':
              bytes.push(92)
              break
            case '\r':
              if (content[i] === '\n') i++
              break
            case '\n':
              break
            default: {
              if (esc >= '0' && esc <= '7') {
                let oct = esc
                while (oct.length < 3 && content[i] >= '0' && content[i] <= '7') {
                  oct += content[i]
                  i++
                }
                bytes.push(parseInt(oct, 8) & 0xff)
              } else if (esc !== undefined) {
                bytes.push(esc.charCodeAt(0) & 0xff)
              }
            }
          }
          continue
        }
        if (ch === '(') depth++
        else if (ch === ')') {
          depth--
          if (depth === 0) {
            i++
            break
          }
        }
        bytes.push(ch.charCodeAt(0) & 0xff)
        i++
      }
      yield { t: 'str', v: Buffer.from(bytes) }
      continue
    }
    if (c === '<' && content[i + 1] !== '<') {
      const end = content.indexOf('>', i + 1)
      if (end < 0) break
      let hex = content.slice(i + 1, end).replace(/[^0-9A-Fa-f]/g, '')
      if (hex.length % 2) hex += '0'
      yield { t: 'str', v: Buffer.from(hex, 'hex') }
      i = end + 1
      continue
    }
    if (c === '<' && content[i + 1] === '<') {
      let depth = 0
      while (i < content.length) {
        if (content[i] === '<' && content[i + 1] === '<') {
          depth++
          i += 2
          continue
        }
        if (content[i] === '>' && content[i + 1] === '>') {
          depth--
          i += 2
          if (depth === 0) break
          continue
        }
        i++
      }
      continue
    }
    if (c === '[') {
      yield { t: '[' }
      i++
      continue
    }
    if (c === ']') {
      yield { t: ']' }
      i++
      continue
    }
    if (c === '/') {
      let j = i + 1
      while (j < content.length && !isWs(content[j]) && !isDelim(content[j])) j++
      yield { t: 'name', v: content.slice(i + 1, j) }
      i = j
      continue
    }
    if (c === ')' || c === '>' || c === '{' || c === '}') {
      i++
      continue
    }
    let j = i
    while (j < content.length && !isWs(content[j]) && !isDelim(content[j])) j++
    const token = content.slice(i, j)
    i = j
    if (!token) {
      i++
      continue
    }
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(token)) yield { t: 'num', v: Number(token) }
    else yield { t: 'op', v: token }
  }
}

type Operand = PdfToken & { arr?: Operand[] }

function decodeShow(bytes: Buffer, font: PdfFont | null): string {
  if (!font) return bytes.toString('latin1')
  if (!font.cmap) return font.keyWidth === 2 ? '' : bytes.toString('latin1')
  let out = ''
  for (let i = 0; i + font.keyWidth <= bytes.length; i += font.keyWidth) {
    const key = bytes.subarray(i, i + font.keyWidth).toString('hex')
    const mapped = font.cmap.get(key)
    if (mapped !== undefined) out += mapped
    else if (font.keyWidth === 1) out += String.fromCharCode(bytes[i])
  }
  return out
}

function extractPageText(content: string, fonts: Map<string, PdfFont>): string {
  const chunks: string[] = []
  let pendingBreak = false
  let currentFont: PdfFont | null = null
  const operands: Operand[] = []
  const arrays: Operand[][] = []
  let lastY: number | null = null

  const newline = () => {
    if (chunks.length) pendingBreak = true
  }
  const show = (bytes: Buffer | undefined) => {
    if (!bytes) return
    const text = decodeShow(bytes, currentFont)
    if (!text) return
    if (pendingBreak && chunks.length) chunks.push('\n')
    pendingBreak = false
    chunks.push(text)
  }
  const addOperand = (op: Operand) => {
    if (arrays.length) arrays[arrays.length - 1].push(op)
    else operands.push(op)
  }

  for (const tok of tokenizeContent(content) as Generator<Operand>) {
    if (tok.t === '[') {
      arrays.push([])
      continue
    }
    if (tok.t === ']') {
      const arr = arrays.pop() ?? []
      addOperand({ t: 'op', v: '[]', arr })
      continue
    }
    if (tok.t !== 'op' || tok.v === '[]') {
      addOperand(tok)
      continue
    }
    const op = String(tok.v ?? '')
    switch (op) {
      case 'Tf': {
        const name = operands.find((o) => o.t === 'name')
        currentFont = name?.v ? (fonts.get(String(name.v)) ?? null) : null
        break
      }
      case 'Tj':
        show([...operands].reverse().find((o) => o.t === 'str')?.v as Buffer | undefined)
        break
      case 'TJ': {
        const arr = [...operands].reverse().find((o) => o.arr)?.arr ?? []
        for (const item of arr) {
          if (item.t === 'str') show(item.v as Buffer)
        }
        break
      }
      case "'": {
        newline()
        const str = [...operands].reverse().find((o) => o.t === 'str')
        show(str?.v as Buffer | undefined)
        break
      }
      case '"': {
        newline()
        const str = [...operands].reverse().find((o) => o.t === 'str')
        show(str?.v as Buffer | undefined)
        break
      }
      case 'Td':
      case 'TD': {
        const nums = operands.filter((o) => o.t === 'num').map((o) => Number(o.v))
        if (nums.length >= 2 && Math.abs(nums[nums.length - 1]) > 0.1) newline()
        break
      }
      case 'Tm': {
        const nums = operands.filter((o) => o.t === 'num').map((o) => Number(o.v))
        const y = nums.length >= 6 ? nums[5] : null
        if (y !== null && lastY !== null && Math.abs(y - lastY) > 0.1) newline()
        if (y !== null) lastY = y
        break
      }
      case 'T*':
        newline()
        break
      case 'BT':
        if (chunks.length) newline()
        lastY = null
        break
      case 'ET':
        newline()
        break
      case 'Do':
        // 图片 XObject 不参与文本
        break
    }
    operands.length = 0
  }
  return chunks.join('')
}

export function extractPdfText(buf: Buffer): string {
  const objects = parsePdfObjects(buf)
  if (!objects.size) return ''
  const pages = [...objects.entries()].filter(([, o]) => /\/Type\s*\/Page\b(?!s)/.test(o.dict))
  const fallbackFonts = allFonts(objects)
  const parts: string[] = []

  if (pages.length) {
    for (const [num, page] of pages) {
      const fonts = fontsOf(num, objects)
      const refs = contentRefs(page.dict)
      const content = refs
        .map((ref) => objects.get(ref))
        .map((o) => (o ? decodeStream(o) : null))
        .filter((b): b is Buffer => !!b)
        .map((b) => b.toString('latin1'))
        .join('\n')
      if (content) parts.push(extractPageText(content, fonts.size ? fonts : fallbackFonts))
    }
  }

  // 页面树没解析出来时，退化为扫描所有带 BT 的流
  if (!parts.some((p) => p.trim())) {
    for (const obj of objects.values()) {
      const data = decodeStream(obj)
      if (!data) continue
      const content = data.toString('latin1')
      if (!/\bBT\b/.test(content)) continue
      parts.push(extractPageText(content, fallbackFonts))
    }
  }
  return parts.join('\n\n')
}

// ---------- 清理 ----------

function cleanText(text: string): string {
  return (
    text
      // 部分 PDF 的 ToUnicode 把汉字映射到康熙部首（如「一」→「⼀」），拉回常用汉字
      .replace(/[\u2e80-\u2fdf]/g, (ch) => ch.normalize('NFKC'))
      .replace(/\r\n?/g, '\n')
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
      .replace(/\u00a0/g, ' ')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/[ \t]{2,}/g, ' ')
      .trim()
  )
}
