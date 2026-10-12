<script setup lang="ts">
import { computed } from 'vue'
import { ArrowRight, ArrowUpRight } from 'lucide-vue-next'
import type { TopicWithStats } from '@shared/api'
import { fmtDate } from '@/utils/format'
import { topicColor, topicInitial } from '@/utils/topic-color'

// 首页「我的学习方向」卡片：专属色图标 + 名称 / 偏好标签 / 三项指标 / 三段掌握进度 / 底栏操作
const props = defineProps<{ topic: TopicWithStats }>()

const color = computed(() => topicColor(props.topic.id))
const initial = computed(() => topicInitial(props.topic.name))

// 三段进度条：绿 已掌握 / 黄 学习中 / 红 薄弱，其余为未开始（灰色底轨）
const segments = computed(() => {
  const { nodeCount, masteredCount, learningCount, weakCount } = props.topic.stats
  const pct = (n: number) => (nodeCount ? (n / nodeCount) * 100 : 0)
  return [
    { key: 'green', n: masteredCount, width: pct(masteredCount) },
    { key: 'yellow', n: learningCount, width: pct(learningCount) },
    { key: 'red', n: weakCount, width: pct(weakCount) },
  ].filter((seg) => seg.n > 0)
})

const breakdownTitle = computed(() => {
  const { nodeCount, masteredCount, learningCount, weakCount } = props.topic.stats
  const untouched = nodeCount - masteredCount - learningCount - weakCount
  return `已掌握 ${masteredCount} · 学习中 ${learningCount} · 薄弱 ${weakCount} · 未开始 ${untouched}`
})

const RECENT_DAYS = 7
const daysSince = computed(() => {
  const iso = props.topic.stats.lastLessonAt
  return iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000) : null
})
const lastStudied = computed(() => (daysSince.value === null ? '' : fmtRelative(daysSince.value)))
// 一周内学过视为活跃，最近学习前显示绿点
const isRecent = computed(() => daysSince.value !== null && daysSince.value < RECENT_DAYS)

function fmtRelative(days: number): string {
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
    :style="{ '--topic': color }"
  >
    <div class="card__head">
      <span
        class="card__icon"
        aria-hidden="true"
      >{{ initial }}</span>
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
          <span
            v-if="isRecent"
            class="stat__dot"
            title="近一周有学习"
          />{{ lastStudied || '—' }}
        </dd>
      </div>
    </dl>

    <div
      class="mastery"
      :title="breakdownTitle"
    >
      <div
        class="mastery__bar"
        role="img"
        :aria-label="breakdownTitle"
      >
        <i
          v-for="seg in segments"
          :key="seg.key"
          :class="`mastery__seg--${seg.key}`"
          :style="{ width: `${seg.width}%` }"
        />
      </div>
      <span class="mastery__text"><strong>{{ topic.stats.masteredCount }}</strong> / {{ topic.stats.nodeCount }} 已掌握</span>
    </div>

    <div class="card__foot">
      <span class="card__created">创建于 {{ fmtDate(topic.createdAt) }}</span>
      <span
        v-if="topic.stats.generatingLesson"
        class="card__status"
      ><span class="card__pulse" />课件生成中</span>
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
  border-color: color-mix(in srgb, var(--topic) 28%, var(--border-strong));
  box-shadow: var(--shadow-sm);
}
.card__head {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 28px;
}
.card__icon {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 7px;
  font-size: 13px;
  font-weight: 600;
  color: var(--topic);
  background: color-mix(in srgb, var(--topic) 11%, var(--bg));
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--topic) 22%, transparent);
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
.stat__dot {
  display: inline-block;
  width: 6px;
  height: 6px;
  margin-right: 7px;
  vertical-align: 3px;
  border-radius: 50%;
  background: var(--mastery-green);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--mastery-green) 18%, transparent);
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
  display: flex;
  flex: 1;
  gap: 2px;
  height: 4px;
  border-radius: 2px;
  background: var(--bg-muted);
  overflow: hidden;
}
.mastery__bar i {
  flex: none;
  min-width: 3px;
  height: 100%;
  border-radius: 2px;
  transition: width var(--dur) var(--ease);
}
.mastery__seg--green {
  background: var(--mastery-green);
}
.mastery__seg--yellow {
  background: var(--mastery-yellow);
}
.mastery__seg--red {
  background: var(--mastery-red);
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
  height: 24px;
  padding: 0 9px;
  margin-right: 0;
  color: var(--amber-text);
  background: var(--amber-bg);
  box-shadow: inset 0 0 0 1px var(--amber-border);
}
.card__pulse {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--mastery-yellow);
  animation: card-pulse 1.4s var(--ease) infinite;
}
@keyframes card-pulse {
  50% {
    opacity: 0.35;
    transform: scale(0.8);
  }
}

</style>
