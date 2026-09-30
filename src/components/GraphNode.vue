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
      <span class="knode__mastery">
        <i class="knode__dot" />{{ data.node.mastery }} 分
      </span>
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
  width: 190px;
  padding: 10px 14px;
  border-radius: 10px;
  border: 1px solid var(--border);
  border-left: 4px solid var(--border);
  background: #fff;
  box-shadow: 0 1px 3px rgb(15 23 42 / 6%);
  transition: box-shadow 0.15s;
}
.knode:hover {
  box-shadow: 0 4px 12px rgb(15 23 42 / 10%);
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
  border-color: #3b82f6;
  border-left-color: #3b82f6;
  box-shadow: 0 0 0 3px rgb(59 130 246 / 15%);
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
  font-size: 11px;
  color: #2563eb;
}
</style>
