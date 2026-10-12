// 学习方向专属色：按方向 id 稳定取色，首页卡片图标用来区分不同方向
// 刻意避开红 / 黄 / 绿（掌握度语义色），色相两两拉开，均为中等饱和度，浅色 / 深色主题下都可读
export const TOPIC_PALETTE = [
  '#3e63dd', // 蓝
  '#ef5f00', // 橙
  '#12a594', // 青绿
  '#d6409f', // 粉
  '#8e4ec6', // 紫
  '#0797b9', // 青
  '#a07553', // 棕
] as const

export type TopicColor = (typeof TOPIC_PALETTE)[number]

// djb2 字符串哈希，结果稳定且分布足够均匀
function hash(str: string): number {
  let h = 5381
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0
  return h
}

export function topicColor(id: string): TopicColor {
  return TOPIC_PALETTE[hash(id) % TOPIC_PALETTE.length] as TopicColor
}

// 图标首字：首个非空白字符，拉丁字母转大写；空名称兜底为 ·
export function topicInitial(name: string): string {
  const ch = Array.from(name.trim())[0]
  return ch ? ch.toUpperCase() : '·'
}
