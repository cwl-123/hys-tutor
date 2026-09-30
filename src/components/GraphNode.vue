<script setup lang="ts">
import { Handle, Position } from '@vue-flow/core'
import { computed } from 'vue'
import { masteryLevel, type KnowledgeNode } from '@shared/types'

const props = defineProps<{ data: { node: KnowledgeNode; selected: boolean; lessonCount: number } }>()

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
      <span class="knode__mastery">{{ data.node.mastery }} 分</span>
      <span
        v-if="data.lessonCount > 0"
        class="knode__lessons"
        :title="`${data.lessonCount} 节历史课程`"
      >📖 {{ data.lessonCount }}</span>
    </div>
    <Handle
      type="source"
      :position="Position.Bottom"
    />
  </div>
</template>

<style scoped>
.knode {
  width: 200px;
  padding: 10px 12px;
  border-radius: 10px;
  border: 2px solid var(--border);
  background: #fff;
  box-shadow: 0 1px 3px rgb(0 0 0 / 8%);
}
.knode--red {
  border-color: var(--mastery-red);
  background: #fef2f2;
}
.knode--yellow {
  border-color: var(--mastery-yellow);
  background: #fffbeb;
}
.knode--green {
  border-color: var(--mastery-green);
  background: #f0fdf4;
}
.knode--selected {
  outline: 2px solid #3b82f6;
  outline-offset: 1px;
}
.knode__name {
  font-size: 14px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.knode__row {
  margin-top: 4px;
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.knode__mastery {
  font-size: 12px;
  color: var(--text-dim);
}
.knode__lessons {
  font-size: 11px;
  color: #2563eb;
}
</style>
