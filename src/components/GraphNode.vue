<script setup lang="ts">
import { Handle, Position } from '@vue-flow/core'
import { computed } from 'vue'
import { BookOpen, Check, LoaderCircle, TriangleAlert } from 'lucide-vue-next'
import { masteryLevel, type KnowledgeNode } from '@shared/types'

const props = defineProps<{
  data: {
    node: KnowledgeNode
    selected: boolean
    lessonCount: number
    lessonStatus?: 'generating' | 'generated' | 'failed'
  }
}>()

const level = computed(() => masteryLevel(props.data.node.mastery))
</script>

<template>
  <div
    class="knode"
    :class="[`knode--${level}`, { 'knode--selected': data.selected }]"
  >
    <Handle
      type="target"
      :position="Position.Top"
    />
    <div class="knode__name">
      {{ data.node.name }}
    </div>
    <div class="knode__row">
      <span class="knode__mastery">
        <i class="knode__dot" />{{ data.node.mastery }} 分
      </span>
      <span
        v-if="data.lessonStatus === 'generating'"
        class="knode__badge knode__badge--gen"
        title="课件正在生成中"
      ><LoaderCircle
        :size="9"
        class="spin"
      /> 生成中</span>
      <span
        v-else-if="data.lessonStatus === 'generated'"
        class="knode__badge knode__badge--ok"
        :title="`${data.lessonCount} 节已生成课件`"
      ><Check :size="9" /> 已生成<template v-if="data.lessonCount > 1"> ×{{ data.lessonCount }}</template></span>
      <span
        v-else-if="data.lessonStatus === 'failed'"
        class="knode__badge knode__badge--bad"
        title="最近一次生成失败"
      ><TriangleAlert :size="9" /> 失败</span>
      <span
        v-else-if="data.lessonCount > 0"
        class="knode__lessons"
        :title="`${data.lessonCount} 节历史课程`"
      ><BookOpen :size="10" /> {{ data.lessonCount }}</span>
    </div>
    <Handle
      type="source"
      :position="Position.Bottom"
    />
  </div>
</template>

<style scoped>
.knode {
  width: 190px;
  padding: 10px 14px;
  border-radius: 10px;
  border: 1px solid var(--border);
  border-left: 4px solid var(--border);
  background: #fff;
  box-shadow: 0 1px 3px rgb(var(--ink-rgb) / 6%);
  transition: box-shadow 0.15s;
}
.knode:hover {
  box-shadow: 0 4px 12px rgb(var(--ink-rgb) / 10%);
}
.knode--red {
  border-left-color: var(--mastery-red);
}
.knode--yellow {
  border-left-color: var(--mastery-yellow);
}
.knode--green {
  border-left-color: var(--mastery-green);
}
.knode--selected {
  border-color: var(--primary);
  border-left-color: var(--primary);
  box-shadow: 0 0 0 3px rgb(var(--primary-rgb) / 15%);
}
.knode__name {
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.knode__row {
  margin-top: 5px;
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.knode__mastery {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  color: var(--text-dim);
}
.knode__dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--border);
}
.knode--red .knode__dot {
  background: var(--mastery-red);
}
.knode--yellow .knode__dot {
  background: var(--mastery-yellow);
}
.knode--green .knode__dot {
  background: var(--mastery-green);
}
.knode__lessons {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: 11px;
  color: var(--primary-strong);
}
.knode__badge {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: 10px;
  padding: 1px 7px;
  border-radius: var(--r-pill);
  white-space: nowrap;
}
.knode__badge--gen {
  color: var(--amber-text);
  background: var(--amber-bg);
}
.knode__badge--ok {
  color: var(--green-hover);
  background: var(--green-bg);
}
.knode__badge--bad {
  color: var(--mastery-red);
  background: var(--red-bg);
}
</style>
