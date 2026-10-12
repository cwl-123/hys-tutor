import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// json-store 在模块加载时读取 HYS_DATA_DIR，必须在动态 import 之前设置
const dataDir = await mkdtemp(path.join(tmpdir(), 'hys-taught-'))
process.env.HYS_DATA_DIR = dataDir

const { listTaught, recordTaught, taughtContextText } = await import('../server/services/taught-service')

describe('taughtContextText', () => {
  it('空清单返回空串', () => {
    expect(taughtContextText([])).toBe('')
  })

  it('拼出知识点与已用案例', () => {
    const text = taughtContextText([
      { lessonId: 'l1', nodeId: 'n1', nodeName: '逻辑回归', objectives: [], examples: ['GBDT+LR AUC 对比'], at: 'x' },
      { lessonId: 'l2', nodeId: 'n2', nodeName: '特征工程', objectives: [], examples: [], at: 'x' },
    ])
    expect(text).toContain('逻辑回归')
    expect(text).toContain('GBDT+LR AUC 对比')
    expect(text).toContain('特征工程')
    expect(text).toContain('避免重复')
  })
})

describe('recordTaught / listTaught', () => {
  it('写入后可读出；同一课重复写入覆盖旧记录', async () => {
    await recordTaught('t_taught', {
      lessonId: 'l1',
      nodeId: 'n1',
      nodeName: '逻辑回归',
      objectives: ['能推导梯度'],
      examples: ['旧例子'],
    })
    await recordTaught('t_taught', {
      lessonId: 'l1',
      nodeId: 'n1',
      nodeName: '逻辑回归',
      objectives: ['能推导梯度'],
      examples: ['新例子'],
    })
    await recordTaught('t_taught', {
      lessonId: 'l2',
      nodeId: 'n2',
      nodeName: '特征工程',
      objectives: [],
      examples: [],
    })
    const list = await listTaught('t_taught')
    expect(list).toHaveLength(2)
    expect(list.find((e) => e.lessonId === 'l1')?.examples).toEqual(['新例子'])
    expect(list.every((e) => e.at)).toBe(true)
  })
})