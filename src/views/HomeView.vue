<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ArrowRight, ArrowUpRight, LoaderCircle, Sparkles, Zap } from 'lucide-vue-next'
import { useTopicStore } from '@/stores/topic'
import { masteryLevel, type Topic, type TopicProfile } from '@shared/types'
import { PROFILE_LEVELS, PROFILE_STYLES, pickOption } from '@/utils/topic-profile'
import OnboardingChat from '@/components/OnboardingChat.vue'

const store = useTopicStore()
const router = useRouter()

const STYLES = PROFILE_STYLES
const LEVELS = PROFILE_LEVELS

const topicName = ref('')
const style = ref<string | null>(null)
const level = ref<string | null>(null)
const extra = ref('')
const creating = ref(false)
const mode = ref<'quick' | 'chat'>('quick')

onMounted(async () => {
  await store.fetchTopics()
})

// 有方向正在后台备课/优化时轮询刷新，卡片上的「课件生成中」状态无需手动刷新
let pollTimer: number | undefined
watch(
  () => store.topics.some((t) => t.stats.generatingLesson),
  (running) => {
    window.clearInterval(pollTimer)
    if (running) pollTimer = window.setInterval(() => void store.fetchTopics(), 5000)
  },
  { immediate: true },
)
onUnmounted(() => window.clearInterval(pollTimer))

async function doCreate(name: string, profile?: TopicProfile): Promise<Topic | null> {
  if (creating.value) return null
  creating.value = true
  try {
    const topic = await store.createTopic(name, profile)
    if (topic) await router.push(`/topic/${topic.id}`)
    return topic
  } finally {
    creating.value = false
  }
}

async function createTopic() {
  const name = topicName.value.trim()
  if (!name) return
  const topic = await doCreate(name, {
    style: style.value ?? undefined,
    level: level.value ?? undefined,
    extra: extra.value.trim() || undefined,
  })
  if (!topic) topicName.value = name
}

// 对话模式：确认提案卡后开课（与快速创建同一条生成管线）
async function onChatCreate(payload: { name: string; profile: TopicProfile }) {
  await doCreate(payload.name, payload.profile)
}

function fmtRelative(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
  if (days <= 0) return '今天'
  if (days === 1) return '昨天'
  if (days < 30) return `${days} 天前`
  return ''
}
</script>

<template>
  <div class="home">
    <!-- 顶部：品牌主张 + 创建新方向 -->
    <section class="hero">
      <div class="hero__copy">
        <h1>把任何方向，<br>学成自己的体系</h1>
        <p class="hero__sub">
          AI 联网调研构建知识图谱，按你的掌握度持续生成个性化微课。
        </p>
      </div>

      <div class="create">
        <div class="create__tabs">
          <button
            type="button"
            class="create__tab"
            :class="{ 'create__tab--on': mode === 'quick' }"
            :disabled="creating"
            @click="mode = 'quick'"
          >
            <Zap :size="13" />
            快速创建
          </button>
          <button
            type="button"
            class="create__tab"
            :class="{ 'create__tab--on': mode === 'chat' }"
            :disabled="creating"
            @click="mode = 'chat'"
          >
            <Sparkles :size="13" />
            AI 帮我理清
          </button>
        </div>

        <form
          v-show="mode === 'quick'"
          @submit.prevent="createTopic"
        >
          <input
            v-model="topicName"
            class="create__name"
            type="text"
            placeholder="想学什么？"
            :disabled="creating"
          >

          <div class="guide-row">
            <span class="guide-row__label">风格</span>
            <div class="chips">
              <button
                v-for="s in STYLES"
                :key="s"
                type="button"
                class="chip"
                :class="{ 'chip--on': style === s }"
                :disabled="creating"
                @click="style = pickOption(style, s)"
              >
                {{ s }}
              </button>
            </div>
          </div>
          <div class="guide-row">
            <span class="guide-row__label">程度</span>
            <div class="chips">
              <button
                v-for="l in LEVELS"
                :key="l"
                type="button"
                class="chip"
                :class="{ 'chip--on': level === l }"
                :disabled="creating"
                @click="level = pickOption(level, l)"
              >
                {{ l }}
              </button>
            </div>
          </div>
          <input
            v-model="extra"
            class="create__extra"
            type="text"
            placeholder="其他要求（可选）"
            :disabled="creating"
          >

          <div class="create__footer">
            <button
              class="create__submit"
              type="submit"
              :disabled="creating || !topicName.trim()"
            >
              <LoaderCircle
                v-if="creating"
                :size="14"
                class="spin"
              />
              {{ creating ? 'AI 调研生成中…' : '开启学习方向' }}
              <ArrowRight
                v-if="!creating"
                :size="14"
              />
            </button>
          </div>
        </form>

        <OnboardingChat
          v-show="mode === 'chat'"
          :creating="creating"
          @create="onChatCreate"
        />

        <div
          v-if="store.stageText"
          class="create__progress"
        >
          <span class="create__spinner" />
          <div>
            <div class="create__stage">
              {{ store.stageText }}
            </div>
            <div class="create__stage-sub">
              联网调研 → 生成知识图谱，约 1~3 分钟
            </div>
          </div>
        </div>
        <p
          v-if="store.error"
          class="create__error"
        >
          {{ store.error }}
        </p>
      </div>
    </section>

    <!-- 我的学习方向 -->
    <section class="topics">
      <div class="topics__head">
        <h2>我的学习方向</h2>
        <span class="topics__count">{{ store.topics.length }}</span>
      </div>

      <div class="topics__grid">
        <RouterLink
          v-for="t in store.topics"
          :key="t.id"
          class="card"
          :to="`/topic/${t.id}`"
        >
          <div class="card__top">
            <span class="card__name">{{ t.name }}</span>
            <span
              v-if="t.stats.generatingLesson"
              class="card__live"
            ><LoaderCircle
              :size="11"
              class="spin"
            /> 备课中</span>
            <ArrowUpRight
              :size="15"
              class="card__arrow"
            />
          </div>

          <div class="card__meta">
            <span>{{ t.stats.nodeCount }} 知识点</span>
            <span>·</span>
            <span>{{ t.stats.lessonCount }} 节课</span>
            <template v-if="t.stats.lastLessonAt && fmtRelative(t.stats.lastLessonAt)">
              <span>·</span>
              <span>{{ fmtRelative(t.stats.lastLessonAt) }}学过</span>
            </template>
            <span
              v-if="t.profile?.level"
              class="tag"
            >{{ t.profile.level }}</span>
          </div>

          <div
            v-if="t.stats.nodeCount > 0"
            class="card__progress"
          >
            <div class="card__bar">
              <i
                :class="`card__bar-fill--${masteryLevel(t.stats.avgMastery)}`"
                :style="{ width: `${t.stats.avgMastery}%` }"
              />
            </div>
            <span class="card__progress-text">{{ t.stats.avgMastery }} 分 · {{ t.stats.masteredCount }}/{{ t.stats.nodeCount }} 已掌握</span>
          </div>

          <div class="card__foot">
            <RouterLink
              v-if="!t.stats.generatingLesson"
              class="btn btn--primary btn--sm"
              :to="`/lesson/new?topic=${t.id}`"
              :title="t.stats.lessonCount ? '由排课引擎自动选下一课' : '开始第一课'"
              @click.stop
            >
              {{ t.stats.lessonCount ? '继续学习' : '开始学习' }}
            </RouterLink>
          </div>
        </RouterLink>

        <!-- 加载骨架 -->
        <template v-if="store.loading && store.topics.length === 0">
          <div
            v-for="i in 3"
            :key="`sk-${i}`"
            class="card card--skeleton"
          >
            <div class="skeleton card__sk-title" />
            <div class="skeleton card__sk-line" />
            <div class="skeleton card__sk-line card__sk-line--short" />
          </div>
        </template>

        <div
          v-if="!store.loading && store.topics.length === 0"
          class="topics__empty"
        >
          还没有学习方向，从上面开启第一个吧
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.home {
  min-height: calc(100vh - var(--header-h));
}

/* ---------- Hero + 创建 ---------- */
.hero {
  max-width: 1080px;
  margin: 0 auto;
  padding: 96px 32px 72px;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 80px;
  align-items: center;
}
.hero__copy h1 {
  margin: 0;
  font-size: 40px;
  line-height: 1.3;
  letter-spacing: -1px;
  font-weight: 650;
}
.hero__sub {
  margin: 18px 0 0;
  font-size: 15px;
  line-height: 1.8;
  color: var(--text-dim);
}
.create {
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  padding: 20px 22px;
}
.create__tabs {
  display: inline-flex;
  gap: 2px;
  padding: 3px;
  border-radius: var(--r-pill);
  background: var(--bg-muted);
}
.create__tab {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font: inherit;
  font-size: 12px;
  font-weight: 500;
  padding: 5px 14px;
  border: none;
  border-radius: var(--r-pill);
  background: transparent;
  color: var(--text-dim);
  cursor: pointer;
  transition: color var(--dur-fast) var(--ease);
}
.create__tab:hover:not(:disabled):not(.create__tab--on) {
  color: var(--text);
}
.create__tab--on {
  background: var(--bg);
  color: var(--text);
  box-shadow: var(--shadow-sm);
}
.create__tab:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.create__name {
  margin-top: 16px;
  width: 100%;
  font: inherit;
  font-size: 14px;
  padding: 10px 14px;
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  background: var(--bg);
  transition:
    border-color var(--dur-fast) var(--ease),
    box-shadow var(--dur-fast) var(--ease);
}
.create__name:focus {
  outline: none;
  border-color: var(--primary);
  box-shadow: var(--ring-primary);
}
.guide-row {
  margin-top: 14px;
  display: flex;
  align-items: center;
  gap: 12px;
}
.guide-row__label {
  flex: none;
  width: 28px;
  font-size: 12px;
  color: var(--text-faint);
}
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.chip {
  font: inherit;
  font-size: 12px;
  padding: 4px 12px;
  border-radius: var(--r-pill);
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  transition: all var(--dur-fast) var(--ease);
}
.chip:hover:not(:disabled) {
  border-color: var(--border-strong);
  color: var(--text);
}
.chip--on,
.chip--on:hover:not(:disabled) {
  border-color: var(--text);
  color: var(--text);
  font-weight: 500;
}
.create__extra {
  margin-top: 12px;
  width: 100%;
  font: inherit;
  font-size: 12px;
  padding: 8px 12px;
  border: 1px dashed var(--border);
  border-radius: var(--r-sm);
  background: transparent;
  color: var(--text);
}
.create__extra:focus {
  outline: none;
  border-color: var(--primary);
  border-style: solid;
  box-shadow: var(--ring-primary);
}
.create__footer {
  margin-top: 18px;
  display: flex;
  justify-content: flex-end;
}
.create__submit {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font: inherit;
  font-size: 13px;
  font-weight: 500;
  padding: 8px 18px;
  border: none;
  border-radius: var(--r-sm);
  background: var(--primary-btn);
  color: #fff;
  cursor: pointer;
  transition:
    background var(--dur-fast) var(--ease),
    opacity var(--dur-fast) var(--ease);
}
.create__submit:hover:not(:disabled) {
  background: var(--primary-btn-hover);
}
.create__submit:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.create__progress {
  margin-top: 14px;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-radius: var(--r-sm);
  background: var(--bg-subtle);
  border: 1px solid var(--border);
}
.create__spinner {
  flex: none;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  border: 2px solid var(--border-strong);
  border-top-color: var(--text-dim);
  animation: create-spin 0.7s linear infinite;
}
@keyframes create-spin {
  to {
    transform: rotate(360deg);
  }
}
.create__stage {
  font-size: 13px;
  font-weight: 500;
  color: var(--text);
}
.create__stage-sub {
  margin-top: 1px;
  font-size: 12px;
  color: var(--text-dim);
}
.create__error {
  margin: 10px 0 0;
  font-size: 13px;
  color: var(--mastery-red);
}

/* ---------- 方向列表 ---------- */
.topics {
  max-width: 1080px;
  margin: 0 auto;
  padding: 0 32px 96px;
}
.topics__head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 16px;
}
.topics__head h2 {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
}
.topics__count {
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  color: var(--text-dim);
  background: var(--bg-muted);
  border-radius: var(--r-pill);
  padding: 1px 8px;
}
.topics__grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 12px;
}
.card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 16px 18px;
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  text-decoration: none;
  color: inherit;
  transition:
    border-color var(--dur-fast) var(--ease),
    background var(--dur-fast) var(--ease);
}
.card:hover {
  border-color: var(--border-strong);
}
.card__top {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.card__name {
  font-size: 14px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.card__live {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: var(--amber-text);
  white-space: nowrap;
}
.card__arrow {
  flex: none;
  margin-left: auto;
  color: var(--text-faint);
  opacity: 0;
  transition: opacity var(--dur-fast) var(--ease);
}
.card:hover .card__arrow {
  opacity: 1;
}
.card__meta {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--text-dim);
  font-variant-numeric: tabular-nums;
}
.tag {
  font-size: 11px;
  padding: 1px 8px;
  border-radius: var(--r-pill);
  background: var(--bg-muted);
  color: var(--text-dim);
}
.card__progress {
  display: flex;
  align-items: center;
  gap: 10px;
}
.card__bar {
  flex: 1;
  position: relative;
  height: 3px;
  border-radius: var(--r-pill);
  background: var(--bg-muted);
  overflow: hidden;
}
.card__bar i {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  border-radius: var(--r-pill);
  transition: width var(--dur) var(--ease);
}
.card__bar-fill--red {
  background: var(--mastery-red);
}
.card__bar-fill--yellow {
  background: var(--mastery-yellow);
}
.card__bar-fill--green {
  background: var(--mastery-green);
}
.card__progress-text {
  flex: none;
  font-size: 11px;
  color: var(--text-faint);
  font-variant-numeric: tabular-nums;
}
.card__foot {
  display: flex;
  justify-content: flex-end;
  min-height: 26px;
}
.card--skeleton {
  pointer-events: none;
}
.card__sk-title {
  height: 16px;
  width: 55%;
}
.card__sk-line {
  height: 12px;
  width: 100%;
}
.card__sk-line--short {
  width: 45%;
}
.topics__empty {
  grid-column: 1 / -1;
  padding: 44px;
  text-align: center;
  color: var(--text-dim);
  font-size: 13px;
  border: 1px dashed var(--border);
  border-radius: var(--r-md);
}

@media (max-width: 900px) {
  .hero {
    grid-template-columns: 1fr;
    gap: 40px;
    padding-top: 56px;
  }
  .hero__copy h1 {
    font-size: 32px;
  }
}
</style>
