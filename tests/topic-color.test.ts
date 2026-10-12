import { describe, expect, it } from 'vitest'
import { TOPIC_PALETTE, topicColor, topicInitial } from '../src/utils/topic-color'

describe('topicColor 方向专属色', () => {
  it('同一 id 始终得到同一颜色', () => {
    expect(topicColor('t_abc')).toBe(topicColor('t_abc'))
  })

  it('结果总在色板内', () => {
    for (const id of ['', 'a', 't_1', 't_2', 'topic_with_long_id_123456']) {
      expect(TOPIC_PALETTE).toContain(topicColor(id))
    }
  })

  it('不同 id 能分散到多种颜色', () => {
    const ids = Array.from({ length: 40 }, (_, i) => `t_${i}`)
    expect(new Set(ids.map(topicColor)).size).toBeGreaterThanOrEqual(5)
  })
})

describe('topicInitial 方向图标首字', () => {
  it('取首个非空白字符，拉丁字母转大写', () => {
    expect(topicInitial('  wps 数据透视表')).toBe('W')
    expect(topicInitial('CTR/CVR 预估模型')).toBe('C')
    expect(topicInitial('英语口语')).toBe('英')
  })

  it('空名称兜底为 ·', () => {
    expect(topicInitial('   ')).toBe('·')
  })
})
