<script setup lang="ts">
import { computed } from 'vue'
import type { LessonMeta } from '@shared/api'
import { masteryLevel, type KnowledgeNode } from '@shared/types'

const props = defineProps<{
  node: KnowledgeNode
  allNodes: KnowledgeNode[]
  lessons: LessonMeta[]
}>()

const emit = defineEmits<{
  close: []
  learn: [id: string]
}>()

const level = computed(() => masteryLevel(props.node.mastery))
const levelLabel = computed(() =>
  level.value === 'green' ? '已掌握' : level.value === 'yellow' ? '学习中' : '未掌握',
)

const deps = computed(() =>
  props.node.deps
    .map((id) => props.allNodes.find((n) => n.id === id))
    .filter((n): n is KnowledgeNode => n !== undefined),
)

// 前置未全部 ≥80 则锁定，不能指定学习
const lockedDeps = computed(() => deps.value.filter((d) => d.mastery < 80))

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}
</script>

<template>
  <aside class="panel">
    <header class="panel__header">
      <div>
        <div class="panel__label">
          知识点
        </div>
        <div class="panel__title">
          {{ node.name }}
        </div>
      </div>
      <button
        class="panel__close"
        title="关闭"
        @click="emit('close')"
      >
        ×
      </button>
    </header>

    <section class="panel__section">
      <p class="panel__desc">
        {{ node.description }}
      </p>
    </section>

    <section class="panel__section">
      <div class="mastery">
        <span class="mastery__score">{{ node.mastery }}</span>
        <span
          class="mastery__level"
          :class="`mastery__level--${level}`"
        >{{ levelLabel }}</span>
      </div>
      <div class="mastery__bar">
        <i
          :class="`mastery__fill--${level}`"
          :style="{ width: `${node.mastery}%` }"
        />
        <i class="mastery__unlock" />
      </div>
      <p class="panel__muted">
        {{ node.mastery >= 80 ? '已解锁下游知识点' : '达到 80 分解锁下游知识点' }}
      </p>
    </section>

    <section class="panel__section">
      <span class="panel__label">前置依赖</span>
      <div class="deps">
        <span
          v-for="d in deps"
          :key="d.id"
          class="dep-chip"
        >{{ d.name }}</span>
        <span
          v-if="deps.length === 0"
          class="panel__muted"
        >
          无（入门节点）
        </span>
      </div>
    </section>

    <section class="panel__section">
      <span class="panel__label">历史课程（{{ lessons.length }}）</span>
      <div class="lessons">
        <RouterLink
          v-for="l in lessons"
          :key="l.id"
          :to="`/lesson/${l.id}`"
          class="lesson-item"
        >
          <span class="lesson-item__title">
            {{ l.title }}
            <em
              v-if="l.status !== 'generated'"
              class="lesson-item__live"
            >{{ l.status === 'failed' ? '失败' : '备课中' }}</em>
          </span>
          <span class="lesson-item__meta">{{ fmtDate(l.createdAt) }} · {{ l.wordCount }} 字</span>
        </RouterLink>
        <p
          v-if="lessons.length === 0"
          class="panel__muted"
        >
          还没有该知识点的课程
        </p>
      </div>
    </section>

    <footer class="panel__footer">
      <button
        class="learn-btn"
        :disabled="lockedDeps.length > 0"
        :title="lockedDeps.length ? `前置未达标：${lockedDeps.map((d) => `${d.name}=${d.mastery}`).join('、')}` : ''"
        @click="emit('learn', node.id)"
      >
        {{ node.mastery >= 80 ? '再学一遍这个知识点 →' : '学这个知识点 →' }}
      </button>
      <p
        v-if="lockedDeps.length"
        class="panel__muted"
      >
        前置未达标：{{ lockedDeps.map((d) => `${d.name} ${d.mastery} 分`).join('、') }}（需 80 分）
      </p>
    </footer>
  </aside>
</template>

<style scoped>
.panel {
  width: 320px;
  border-left: 1px solid var(--border);
  background: #fff;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
}
.panel__header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  padding: 18px 20px 14px;
  border-bottom: 1px solid var(--border);
}
.panel__label {
  font-size: 12px;
  color: var(--text-dim);
  letter-spacing: 0.5px;
}
.panel__title {
  margin-top: 2px;
  font-size: 17px;
  font-weight: 600;
}
.panel__close {
  border: none;
  background: none;
  font-size: 20px;
  line-height: 1;
  cursor: pointer;
  color: var(--text-dim);
}
.panel__close:hover {
  color: var(--text);
}
.panel__section {
  padding: 16px 20px;
  border-bottom: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.panel__desc {
  margin: 0;
  font-size: 13px;
  line-height: 1.8;
  color: var(--text);
}
.panel__muted {
  margin: 0;
  font-size: 12px;
  color: var(--text-dim);
}
.mastery {
  display: flex;
  align-items: baseline;
  gap: 10px;
}
.mastery__score {
  font-size: 28px;
  font-weight: 700;
  line-height: 1;
}
.mastery__level {
  font-size: 12px;
  padding: 2px 10px;
  border-radius: 999px;
}
.mastery__level--red {
  background: #fef2f2;
  color: var(--mastery-red);
}
.mastery__level--yellow {
  background: #fffbeb;
  color: #b45309;
}
.mastery__level--green {
  background: #f0fdf4;
  color: #15803d;
}
.mastery__bar {
  position: relative;
  height: 6px;
  border-radius: 3px;
  background: #f1f5f9;
}
.mastery__bar i {
  position: absolute;
  top: 0;
  bottom: 0;
  border-radius: 3px;
}
.mastery__fill--red {
  background: var(--mastery-red);
}
.mastery__fill--yellow {
  background: var(--mastery-yellow);
}
.mastery__fill--green {
  background: var(--mastery-green);
}
.mastery__unlock {
  left: 80%;
  width: 2px;
  background: #94a3b8;
}
.deps {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.dep-chip {
  font-size: 12px;
  padding: 3px 10px;
  border-radius: 999px;
  background: #f1f5f9;
  color: #475569;
}
.lessons {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.lesson-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 7px 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  text-decoration: none;
}
.lesson-item:hover {
  border-color: #3b82f6;
  background: #eff6ff;
}
.lesson-item__title {
  font-size: 13px;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.lesson-item__live {
  font-style: normal;
  font-size: 11px;
  color: #b45309;
  background: #fffbeb;
  border-radius: 4px;
  padding: 1px 6px;
  margin-left: 6px;
}
.lesson-item__meta {
  font-size: 11px;
  color: var(--text-dim);
}
.panel__footer {
  margin-top: auto;
  padding: 14px 20px 18px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.learn-btn {
  font: inherit;
  font-size: 14px;
  font-weight: 600;
  padding: 10px 16px;
  border: none;
  border-radius: 10px;
  background: #16a34a;
  color: #fff;
  cursor: pointer;
}
.learn-btn:hover:not(:disabled) {
  opacity: 0.9;
}
.learn-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
</style>
