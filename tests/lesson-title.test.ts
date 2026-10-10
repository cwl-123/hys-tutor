import { describe, expect, it } from 'vitest'
import { firstHeadingOutsideCode, lessonTitle } from '../server/services/lesson-service'
import type { Lesson } from '../shared/types'

function makeLesson(contentMd: string, nodeIds: string[]): Lesson {
  return {
    id: 'l_test',
    topicId: 't_test',
    nodeIds,
    scheduleReason: '',
    masterySnapshot: {},
    injectedReports: [],
    researchNoteIds: [],
    sources: [],
    contentMd,
    status: 'generated',
    createdAt: '2026-10-10T00:00:00.000Z',
  }
}

describe('lessonTitle', () => {
  const nodeNames = { feature_hashing: '特征哈希与稀疏特征' }

  it('忽略代码块里的 # 注释，正文无一级标题时回退到知识点名', () => {
    const md = [
      '你已经把机器学习和 Embedding 打得很牢。',
      '',
      '## 一、从 one-hot 到哈希',
      '',
      '```python',
      '# [[ 0.  0. -4. -1.  0.  0.]]',
      'y = Phi @ x',
      '```',
    ].join('\n')
    expect(firstHeadingOutsideCode(md)).toBeNull()
    expect(lessonTitle(makeLesson(md, ['feature_hashing']), nodeNames)).toBe('特征哈希与稀疏特征')
  })

  it('优先采用代码块之外的一级标题', () => {
    const md = ['```python', '# 这是代码注释，不算标题', '```', '', '# CTR 特征工程：交叉特征', '', '正文'].join('\n')
    expect(lessonTitle(makeLesson(md, ['feature_hashing']), nodeNames)).toBe('CTR 特征工程：交叉特征')
  })

  it('波浪号围栏同样跳过，且不把 ## 当一级标题', () => {
    const md = ['~~~text', '# 注释', '~~~', '## 这是二级标题', ''].join('\n')
    expect(firstHeadingOutsideCode(md)).toBeNull()
  })
})