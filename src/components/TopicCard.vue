<script setup lang="ts">
import { computed } from 'vue'
import { ArrowRight, ArrowUpRight, LoaderCircle } from 'lucide-vue-next'
import type { TopicWithStats } from '@shared/api'
import { fmtDate } from '@/utils/format'

// 首页「我的学习方向」卡片：名称 / 偏好标签 / 三项指标 / 已掌握进度 / 底栏操作
const props = defineProps<{ topic: TopicWithStats }>()

// 进度条按「已掌握知识点占比」计算，与右侧 x / y 已掌握 文案同口径
const pct = computed(() => {
  const { nodeCount, masteredCount } = props.topic.stats
  return nodeCount ? Math.round((masteredCount / nodeCount) * 100) : 0
})

const lastStudied = computed(() => {
  const iso = props.topic.stats.lastLessonAt
  return iso ? fmtRelative(iso) : ''
})

function fmtRelative(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
  if (days <= 0) return '今天'
  if (days === 1) return '昨天'
  if (days < 30) return `${days} 天前`
  return ''
}
</script>

<template>
  <RouterLink
    class="card"
    :to="`/topic/${topic.id}`"
  >
    <div class="card__head">
      <span
        class="card__name"
        :title="topic.name"
      >{{ topic.name }}</span>
      <ArrowUpRight
        :size="15"
        class="card__arrow"
      />
    </div>

    <div class="card__tags">
      <span
        v-if="topic.profile?.level"
        class="tag"
      >{{ topic.profile.level }}</span>
      <span
        v-if="topic.profile?.style"
        class="tag"
      >{{ topic.profile.style }}</span>
      <span
        v-if="!topic.profile?.level && !topic.profile?.style"
        class="tag tag--empty"
      >未设置偏好</span>
    </div>

    <dl class="stats">
      <div class="stat">
        <dt>知识点</dt>
        <dd>{{ topic.stats.nodeCount }}</dd>
      </div>
      <div class="stat">
        <dt>课程</dt>
        <dd>{{ topic.stats.lessonCount }}</dd>
      </div>
      <div class="stat">
        <dt>最近学习</dt>
        <dd :class="{ 'stat__none': !lastStudied }">
          {{ lastStudied || '—' }}
        </dd>
      </div>
    </dl>

    <div class="mastery">
      <div
        class="mastery__bar"
        role="progressbar"
        :aria-valuenow="pct"
        aria-valuemin="0"
        aria-valuemax="100"
      >
        <i :style="{ width: `${pct}%` }" />
      </div>
      <span class="mastery__text"><strong>{{ topic.stats.masteredCount }}</strong> / {{ topic.stats.nodeCount }} 已掌握</span>
    </div>

    <div class="card__foot">
      <span class="card__created">创建于 {{ fmtDate(topic.createdAt) }}</span>
      <span
        v-if="topic.stats.generatingLesson"
        class="card__status"
      ><LoaderCircle
        :size="12"
        class="spin"
      />课件生成中</span>
      <RouterLink
        v-else
        class="card__cta"
        :to="`/lesson/new?topic=${topic.id}`"
        :title="topic.stats.lessonCount ? '由排课引擎自动选下一课' : '开始第一课'"
        @click.stop
      >
        {{ topic.stats.lessonCount ? '继续学习' : '开始学习' }}
        <ArrowRight :size="13" />
      </RouterLink>
    </div>
  </RouterLink>
</template>

<style scoped>
.card {
  --card-pad: 20px;

  display: flex;
  flex-direction: column;
  min-width: 0;
  padding: var(--card-pad) var(--card-pad) 0;
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  background: var(--bg);
  text-decoration: none;
  color: inherit;
  transition:
    border-color var(--dur-fast) var(--ease),
    box-shadow var(--dur-fast) var(--ease);
}
.card:hover {
  border-color: var(--border-strong);
  box-shadow: var(--shadow-sm);
}
.card__head {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 22px;
}
.card__name {
  min-width: 0;
  font-size: 15px;
  font-weight: 600;
  letter-spacing: -0.01em;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.card__arrow {
  flex: none;
  margin-left: auto;
  color: var(--text-faint);
  opacity: 0;
  transform: translate(-2px, 2px);
  transition:
    opacity var(--dur-fast) var(--ease),
    transform var(--dur-fast) var(--ease);
}
.card:hover .card__arrow {
  opacity: 1;
  transform: none;
}
.card__tags {
  display: flex;
  gap: 6px;
  height: 20px;
  margin-top: 10px;
}
.tag {
  display: inline-flex;
  align-items: center;
  height: 20px;
  padding: 0 7px;
  font-size: 11px;
  color: var(--text-dim);
  border: 1px solid var(--border);
  border-radius: 5px;
  white-space: nowrap;
}
.tag--empty {
  color: var(--text-faint);
  border-style: dashed;
}

.stats {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  margin: 20px 0 0;
}
.stat + .stat {
  padding-left: 16px;
  border-left: 1px solid var(--border);
}
.stat dt {
  font-size: 11px;
  line-height: 16px;
  color: var(--text-faint);
}
.stat dd {
  margin: 4px 0 0;
  font-size: 18px;
  line-height: 24px;
  font-weight: 600;
  letter-spacing: -0.01em;
  font-variant-numeric: tabular-nums;
  color: var(--text);
  white-space: nowrap;
}
.stat dd.stat__none {
  color: var(--text-faint);
  font-weight: 400;
}

.mastery {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 20px;
}
.mastery__bar {
  position: relative;
  flex: 1;
  height: 4px;
  border-radius: 2px;
  background: var(--bg-muted);
  overflow: hidden;
}
.mastery__bar i {
  position: absolute;
  inset: 0 auto 0 0;
  border-radius: 2px;
  background: var(--mastery-green);
  transition: width var(--dur) var(--ease);
}
.mastery__text {
  flex: none;
  font-size: 12px;
  color: var(--text-dim);
  font-variant-numeric: tabular-nums;
}
.mastery__text strong {
  font-weight: 600;
  color: var(--text);
}

.card__foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  height: 52px;
  margin-top: auto;
  border-top: 1px solid var(--border);
}
/* 中间区块与底栏的固定间距；margin-top:auto 让同一行卡片底栏对齐 */
.mastery {
  margin-bottom: 20px;
}
.card__created {
  font-size: 12px;
  color: var(--text-faint);
  font-variant-numeric: tabular-nums;
}
.card__cta,
.card__status {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 10px;
  font-size: 12px;
  font-weight: 500;
  border-radius: 6px;
  white-space: nowrap;
}
.card__cta {
  margin-right: -10px;
  color: var(--text);
  text-decoration: none;
  transition:
    background var(--dur-fast) var(--ease),
    color var(--dur-fast) var(--ease);
}
.card__cta .lucide {
  color: var(--text-dim);
  transition: transform var(--dur-fast) var(--ease);
}
.card__cta:hover {
  background: var(--bg-muted);
}
.card__cta:hover .lucide {
  color: var(--text);
  transform: translateX(2px);
}
.card__status {
  margin-right: -10px;
  color: var(--amber-text);
}

</style>
