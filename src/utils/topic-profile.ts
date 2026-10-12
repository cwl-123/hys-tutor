// 方向个性化选项（开课表单与学习设置面板共用）
export const PROFILE_STYLES = ['通俗直观', '严谨推导', '实战代码', '案例驱动']
export const PROFILE_LEVELS = ['完全新手', '有一定基础', '比较熟悉想精进']

// 单选切换：再点一次已选中的项则取消
export function pickOption(current: string | null, value: string): string | null {
  return current === value ? null : value
}
