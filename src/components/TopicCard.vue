<script setup lang="ts">
import { computed, ref } from 'vue'
import { ArrowRight, ArrowUpRight, Trash2 } from 'lucide-vue-next'
import type { TopicWithStats } from '@shared/api'
import { errMsg } from '@shared/error'
import { useTopicStore } from '@/stores/topic'
import { showToast } from '@/utils/toast'
import { fmtDate } from '@/utils/format'
import { topicColor, topicInitial } from '@/utils/topic-color'

// 首页「我的学习方向」卡片：专属色图标 + 名称 / 偏好标签 / 三项指标 / 三段掌握进度 / 底栏操作
const props = defineProps<{ topic: TopicWithStats }>()

const store = useTopicStore()
const color = computed(() => topicColor(props.topic.id))
const initial = computed(() => topicInitial(props.topic.name))

// 删除二次确认：图标点一下进入确认态，再点「删除」才真正移除，避免误触
const confirming = ref(false)
const deleting = ref(false)

async function remove() {
  if (deleting.value) return
  deleting.value = true
  try {
    await store.deleteTopic(props.topic.id)
    showToast(`已删除学习方向「${props.topic.name}」`)
  } catch (err) {
    showToast(errMsg(err))
    confirming.value = false
  } finally {
    deleting.value = false
  }
}

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
        v-if="!confirming"
        :size="15"
        class="card__arrow"
      />
      <button
        v-if="!confirming"
        class="card__del"
        type="button"
        title="删除学习方向"
        aria-label="删除学习方向"
        @click.stop.prevent="confirming = true"
      >
        <Trash2 :size="14" />
      </button>
    </div>

    <div class="card__tags">
      <span
        v-if="topic.profile?.level"
        class="tag tag--level"
      >{{ topic.profile.level }}</span>
      <span
        v-if="topic.profile?.style"
        class="tag tag--style"
      >{{ topic.profile.style }}</span>
      <span
        v-if="!topic.profile?.level && !topic.profile?.style"
        class="tag tag--empty"
      >未设置偏好</span>
    </div>

    <div class="metrics">
      <div class="metric">
        <span class="metric__label">最近学习</span>
        <span
          class="metric__value"
          :class="{ 'metric__value--none': !lastStudied }"
        >
          <span
            v-if="isRecent"
            class="metric__dot"
            title="近一周有学习"
          />{{ lastStudied || '—' }}
        </span>
      </div>
      <div class="metric">
        <span class="metric__label">知识点</span>
        <span class="metric__value">{{ topic.stats.nodeCount }}</span>
      </div>
      <div class="metric">
        <span class="metric__label">已掌握</span>
        <span class="metric__value">{{ topic.stats.masteredCount }}</span>
      </div>
    </div>

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
    </div>

    <div class="card__foot">
      <template v-if="confirming">
        <span class="card__confirm-text">删除该方向？课程与掌握度将一并清除</span>
        <div class="card__confirm-actions">
          <button
            class="card__confirm-yes"
            type="button"
            :disabled="deleting"
            @click.stop.prevent="remove"
          >
            {{ deleting ? '删除中…' : '删除' }}
          </button>
          <button
            class="card__confirm-no"
            type="button"
            :disabled="deleting"
            @click.stop.prevent="confirming = false"
          >
            取消
          </button>
        </div>
      </template>
      <template v-else>
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
      </template>
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
.card__del {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--text-faint);
  cursor: pointer;
  opacity: 0;
  transition:
    opacity var(--dur-fast) var(--ease),
    color var(--dur-fast) var(--ease),
    background var(--dur-fast) var(--ease);
}
.card:hover .card__del {
  opacity: 1;
}
.card__del:hover {
  color: var(--mastery-red);
  background: var(--bg-muted);
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
  padding: 0 8px;
  font-size: 11px;
  color: var(--text-dim);
  background: var(--bg-muted);
  border-radius: 5px;
  white-space: nowrap;
}
.tag--level {
  color: var(--tag-level-text);
}
.tag--style {
  color: var(--tag-style-text);
}
.tag--empty {
  color: var(--text-faint);
  background: transparent;
  border: 1px dashed var(--border);
}

.metrics {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14px;
  margin-top: 18px;
}
.metric {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}
.metric + .metric {
  padding-left: 14px;
  border-left: 1px solid var(--border);
}
.metric__label {
  font-size: 11px;
  line-height: 16px;
  color: var(--text-faint);
}
.metric__value {
  display: inline-flex;
  align-items: baseline;
  gap: 5px;
  font-size: 20px;
  line-height: 24px;
  font-weight: 600;
  letter-spacing: -0.01em;
  font-variant-numeric: tabular-nums;
  color: var(--text);
  white-space: nowrap;
}
.metric__value--none {
  color: var(--text-faint);
  font-weight: 400;
}
.metric__dot {
  align-self: center;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--mastery-green);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--mastery-green) 18%, transparent);
}

.mastery {
  margin: 12px 0 16px;
}
.mastery__bar {
  display: flex;
  flex: 1;
  gap: 2px;
  height: 6px;
  padding: 1px;
  border-radius: 999px;
  background: var(--bg-muted);
  box-shadow: inset 0 0 0 1px var(--border);
  overflow: hidden;
}
.mastery__bar i {
  flex: none;
  min-width: 6px;
  height: 100%;
  border-radius: 999px;
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

.card__foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  height: 52px;
  margin-top: auto;
  border-top: 1px solid var(--border);
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
.card__confirm-text {
  min-width: 0;
  font-size: 12px;
  line-height: 1.4;
  color: var(--text-dim);
}
.card__confirm-actions {
  flex: none;
  display: flex;
  gap: 6px;
}
.card__confirm-yes,
.card__confirm-no {
  height: 28px;
  padding: 0 10px;
  font: inherit;
  font-size: 12px;
  border: none;
  border-radius: 6px;
  white-space: nowrap;
  cursor: pointer;
}
.card__confirm-yes {
  /* 固定深红：暗色下 --mastery-red 变亮，白字对比度不够 */
  background: #dc2626;
  color: #fff;
}
.card__confirm-yes:hover:not(:disabled) {
  background: #b91c1c;
}
.card__confirm-yes:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.card__confirm-no {
  background: var(--bg-muted);
  color: var(--text);
}
.card__confirm-no:hover:not(:disabled) {
  background: var(--border);
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

/* 触屏没有 hover：删除入口必须常驻，否则手机端无法删除方向 */
@media (hover: none) {
  .card__arrow,
  .card__del {
    opacity: 1;
  }
}

@media (max-width: 720px) {
  .card {
    --card-pad: 16px;

    padding: 16px 16px 0;
  }
  .card__name {
    font-size: 14px;
  }
  .card__arrow {
    display: none;
  }
  .card__del {
    width: 32px;
    height: 32px;
    margin-left: auto;
  }
  .metrics {
    gap: 10px;
    margin-top: 16px;
  }
  .metric + .metric {
    padding-left: 10px;
  }
  .metric__value {
    font-size: 18px;
  }
  .card__foot {
    height: 54px;
  }
  .card__confirm-text {
    font-size: 11px;
  }
  .card__cta {
    margin-right: -6px;
  }
}
</style>
