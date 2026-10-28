import { deflateSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { extractDocumentText, extractPdfText } from '../server/services/document-text'

// 手搓一个最小 PDF：本项目的抽取器不依赖 xref，只需对象与内容流
function pdf(objects: string[], opts: { contentStream: string; fonts: string }): Buffer {
  const header = '%PDF-1.4\n'
  const body = objects.join('\n')
  const stream = deflateSync(Buffer.from(opts.contentStream))
  const contentObj = `4 0 obj\n<< /Length ${stream.length} /Filter /FlateDecode >>\nstream\n${stream.toString('latin1')}\nendstream\nendobj`
  const fontObj = `5 0 obj\n${opts.fonts}\nendobj`
  const trailer = 'trailer\n<< /Root 1 0 R >>\n%%EOF'
  return Buffer.from(`${header}${body}\n${contentObj}\n${fontObj}\n${trailer}`, 'latin1')
}

const CATALOG = [
  '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj',
  '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj',
  '3 0 obj\n<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>\nendobj',
]

function png(content = 'fake'): Buffer {
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from(content),
  ])
}

// 最小 ZIP（store 模式）：给 DOCX 测试用，不依赖第三方库
function zip(files: { name: string; data: Buffer }[]): Buffer {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  for (const file of files) {
    const name = Buffer.from(file.name)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt32LE(file.data.length, 18)
    local.writeUInt32LE(file.data.length, 22)
    local.writeUInt16LE(name.length, 26)
    const localRec = Buffer.concat([local, name, file.data])
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt32LE(file.data.length, 20)
    central.writeUInt32LE(file.data.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt32LE(offset, 42)
    centrals.push(Buffer.concat([central, name]))
    locals.push(localRec)
    offset += localRec.length
  }
  const cd = Buffer.concat(centrals)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(files.length, 8)
  eocd.writeUInt16LE(files.length, 10)
  eocd.writeUInt32LE(cd.length, 12)
  eocd.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, cd, eocd])
}

describe('extractPdfText', () => {
  it('抽取简单字体 + Flate 压缩的内容流', () => {
    const buf = pdf(CATALOG, {
      contentStream: 'BT /F1 12 Tf 72 720 Td (Hello PDF) Tj ET',
      fonts: '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    })
    expect(extractPdfText(buf)).toContain('Hello PDF')
  })

  it('按 ToUnicode 映射中文（Identity-H）', () => {
    const cmap = [
      '/CIDInit /ProcSet findresource begin',
      '10 beginbfchar',
      '<4F60> <4F60>',
      '<597D> <597D>',
      'endbfchar',
    ].join('\n')
    const cmpStream = deflateSync(Buffer.from(cmap))
    const objects = [
      ...CATALOG,
      `6 0 obj\n<< /Length ${cmpStream.length} /Filter /FlateDecode >>\nstream\n${cmpStream.toString('latin1')}\nendstream\nendobj`,
    ]
    const content = 'BT /F1 12 Tf 72 720 Td <4F60597D> Tj ET'
    const buf = Buffer.from(
      [
        '%PDF-1.4',
        ...objects,
        `4 0 obj\n<< /Length ${deflateSync(Buffer.from(content)).length} /Filter /FlateDecode >>\nstream\n${deflateSync(Buffer.from(content)).toString('latin1')}\nendstream\nendobj`,
        '5 0 obj\n<< /Type /Font /Subtype /Type0 /BaseFont /SimSun /Encoding /Identity-H /ToUnicode 6 0 R >>\nendobj',
        'trailer\n<< /Root 1 0 R >>\n%%EOF',
      ].join('\n'),
      'latin1',
    )
    expect(extractPdfText(buf)).toContain('你好')
  })

  it('扫描件（无文本流）返回空文本，由上层提示换格式', () => {
    const buf = pdf(CATALOG, {
      contentStream: 'q 100 0 0 100 0 0 cm /Im0 Do Q',
      fonts: '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    })
    expect(extractPdfText(buf).trim()).toBe('')
  })
})

describe('extractDocumentText', () => {
  it('纯文本按 UTF-8 读取', () => {
    const result = extractDocumentText(Buffer.from('第一章 需求分析\n第二章 架构设计'))
    expect(result?.format).toBe('text')
    expect(result?.text).toContain('第一章 需求分析')
  })

  it('DOCX 抽取段落文字', () => {
    const xml = `<?xml version="1.0"?><w:document><w:body>
      <w:p><w:r><w:t>课程大纲</w:t></w:r></w:p>
      <w:p><w:r><w:t>1. 财务分析</w:t></w:r><w:r><w:t>基础</w:t></w:r></w:p>
    </w:body></w:document>`
    const buf = zip([{ name: 'word/document.xml', data: Buffer.from(xml) }])
    const result = extractDocumentText(buf)
    expect(result?.format).toBe('docx')
    expect(result?.text).toContain('课程大纲')
    expect(result?.text).toContain('1. 财务分析基础')
  })

  it('二进制/未知压缩包返回 null', () => {
    expect(extractDocumentText(Buffer.from([0x00, 0x01, 0x02, 0x03]))).toBeNull()
    expect(extractDocumentText(zip([{ name: 'a.bin', data: Buffer.from('x') }]))).toBeNull()
  })

  it('带 BOM 的 UTF-16 文本按对应字节序读取', () => {
    const text = '课程大纲：财务分析'
    const le = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')])
    expect(extractDocumentText(le)?.text).toBe(text)
    const beBytes = [0xfe, 0xff]
    for (const ch of text) {
      const code = ch.codePointAt(0) ?? 0
      beBytes.push(code >> 8, code & 0xff)
    }
    expect(extractDocumentText(Buffer.from(beBytes))?.text).toBe(text)
  })
})

describe('图片不进入文本抽取', () => {
  it('PNG 被识别为二进制并返回 null（由多模态分支处理）', () => {
    expect(extractDocumentText(png())).toBeNull()
  })
})
