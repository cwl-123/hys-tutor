<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ArrowRight, LoaderCircle, Sparkles, Zap } from 'lucide-vue-next'
import { useTopicStore } from '@/stores/topic'
import { masteryLevel, type Topic, type TopicProfile } from '@shared/types'
import { fmtDate } from '@/utils/format'
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
  return fmtDate(iso)
}
</script>

<template>
  <div class="home">
    <!-- 顶部：品牌 + 创建新方向 -->
    <section class="hero">
      <div class="hero__copy">
        <h1>把任何方向，学成自己的体系</h1>
        <p class="hero__sub">
          AI 联网调研知识体系 · 每轮微课按你的掌握度定制 · 练习反馈实时驱动下一课
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
            <Zap :size="14" />
            快速创建
          </button>
          <button
            type="button"
            class="create__tab"
            :class="{ 'create__tab--on': mode === 'chat' }"
            :disabled="creating"
            @click="mode = 'chat'"
          >
            <Sparkles :size="14" />
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
            placeholder="想学什么？如：CTR/CVR 预估模型、Kubernetes 网络、期权定价…"
            :disabled="creating"
          >

          <div class="create__guide">
            <div class="guide-row">
              <span class="guide-row__label">讲解风格</span>
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
              <span class="guide-row__label">当前程度</span>
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
              placeholder="其他要求（可选）：如「多结合广告业务案例」「少讲数学多讲工程实现」…"
              :disabled="creating"
            >
          </div>

          <div class="create__footer">
            <p class="create__hint">
              以上选择会注入调研、图谱与每节课的生成，进入方向后可随时在「学习设置」中调整
            </p>
            <button
              class="create__submit"
              type="submit"
              :disabled="creating || !topicName.trim()"
            >
              {{ creating ? 'AI 调研生成中…' : '开启学习方向' }}
              <ArrowRight
                v-if="!creating"
                :size="16"
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
              联网调研 → 生成知识图谱，约 1~3 分钟，请勿关闭页面
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
        <span class="topics__count">{{ store.topics.length }} 个</span>
      </div>

      <div class="topics__grid">
        <div
          v-for="t in store.topics"
          :key="t.id"
          class="card"
        >
          <RouterLink
            :to="`/topic/${t.id}`"
            class="card__main"
          >
            <div class="card__top">
              <div class="card__title">
                <span class="card__name">{{ t.name }}</span>
                <span
                  v-if="t.stats.generatingLesson"
                  class="card__live"
                ><LoaderCircle
                  :size="11"
                  class="spin"
                /> 课件生成中</span>
              </div>
              <span class="card__arrow"><ArrowRight :size="17" /></span>
            </div>

            <div
              v-if="t.profile?.style || t.profile?.level"
              class="card__tags"
            >
              <span
                v-if="t.profile?.level"
                class="tag"
              >{{ t.profile.level }}</span>
              <span
                v-if="t.profile?.style"
                class="tag tag--style"
              >{{ t.profile.style }}</span>
            </div>

            <div class="card__stats">
              <span><strong>{{ t.stats.nodeCount }}</strong> 知识点</span>
              <span class="card__dot">·</span>
              <span><strong>{{ t.stats.lessonCount }}</strong> 节课</span>
              <span
                v-if="t.stats.lastLessonAt"
                class="card__dot"
              >·</span>
              <span v-if="t.stats.lastLessonAt">最近学习 {{ fmtRelative(t.stats.lastLessonAt) }}</span>
            </div>
          </RouterLink>

          <div
            v-if="t.stats.nodeCount > 0"
            class="card__progress"
          >
            <div class="card__progress-row">
              <span class="card__progress-label">平均掌握</span>
              <strong class="card__progress-score">{{ t.stats.avgMastery }}</strong>
              <span class="card__progress-sub">{{ t.stats.masteredCount }}/{{ t.stats.nodeCount }} 已掌握</span>
            </div>
            <div class="card__bar">
              <i
                :class="`card__bar-fill--${masteryLevel(t.stats.avgMastery)}`"
                :style="{ width: `${t.stats.avgMastery}%` }"
              />
            </div>
          </div>

          <div class="card__foot">
            <span class="card__meta">创建于 {{ fmtDate(t.createdAt) }}</span>
            <span
              v-if="t.stats.generatingLesson"
              class="card__waiting"
            ><LoaderCircle
              :size="12"
              class="spin"
            /> 课件生成中</span>
            <RouterLink
              v-else
              class="btn btn--primary btn--sm card__go"
              :to="`/lesson/new?topic=${t.id}`"
              :title="t.stats.lessonCount ? '由排课引擎自动选下一课' : '开始第一课'"
              @click.stop
            >
              {{ t.stats.lessonCount ? '继续学习' : '开始学习' }}
              <ArrowRight :size="13" />
            </RouterLink>
          </div>
        </div>

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
  background:
    radial-gradient(1200px 400px at 50% -100px, rgb(var(--primary-rgb) / 7%), transparent),
    var(--bg);
}

/* ---------- Hero + 创建 ---------- */
.hero {
  max-width: 1120px;
  margin: 0 auto;
  padding: 72px 40px 48px;
  display: grid;
  grid-template-columns: 1fr 1.1fr;
  gap: 56px;
  align-items: center;
}
.hero__copy h1 {
  margin: 0;
  font-size: 40px;
  line-height: 1.25;
  letter-spacing: -0.5px;
  font-weight: 700;
  background: linear-gradient(120deg, var(--text) 30%, var(--primary-hover));
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
}
.hero__sub {
  margin: 18px 0 0;
  font-size: 15px;
  line-height: 1.9;
  color: var(--text-dim);
}
.create {
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: var(--r-lg);
  padding: 26px 28px;
  box-shadow: var(--shadow-lg);
}
.create__name {
  margin-top: 16px;
  width: 100%;
  font: inherit;
  font-size: 16px;
  padding: 12px 16px;
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  transition:
    border-color var(--dur-fast) var(--ease),
    box-shadow var(--dur-fast) var(--ease);
}
.create__name:focus {
  outline: none;
  border-color: var(--primary);
  box-shadow: var(--ring-primary);
}
.create__guide {
  margin-top: 18px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.guide-row {
  display: flex;
  align-items: center;
  gap: 12px;
}
.guide-row__label {
  flex: none;
  width: 64px;
  font-size: 13px;
  color: var(--text-dim);
}
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.chip {
  font: inherit;
  font-size: 13px;
  padding: 5px 14px;
  border-radius: var(--r-pill);
  border: 1px solid var(--border);
  background: var(--bg);
  color: var(--text);
  cursor: pointer;
  transition: all var(--dur-fast) var(--ease);
}
.chip:hover:not(:disabled) {
  border-color: var(--primary-soft);
  color: var(--primary-hover);
}
.chip--on,
.chip--on:hover:not(:disabled) {
  border-color: var(--primary);
  background: var(--primary-bg);
  color: var(--primary-hover);
  font-weight: 500;
  box-shadow: 0 0 0 3px rgb(var(--primary-rgb) / 8%);
}
.create__extra {
  width: 100%;
  font: inherit;
  font-size: 13px;
  padding: 9px 14px;
  border: 1px dashed var(--border);
  border-radius: var(--r-md);
  color: var(--text);
}
.create__extra:focus {
  outline: none;
  border-color: var(--primary);
  border-style: solid;
  box-shadow: var(--ring-primary);
}
.create__footer {
  margin-top: 20px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}
.create__hint {
  margin: 0;
  font-size: 12px;
  color: var(--text-dim);
  line-height: 1.6;
}
.create__submit {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font: inherit;
  font-size: 15px;
  font-weight: 600;
  padding: 11px 26px;
  border: none;
  border-radius: var(--r-md);
  background: var(--primary-btn);
  color: #fff;
  cursor: pointer;
  transition:
    background var(--dur-fast) var(--ease),
    opacity var(--dur-fast) var(--ease),
    transform var(--dur-fast) var(--ease);
}
.create__submit:hover:not(:disabled) {
  background: var(--primary-btn-hover);
  transform: translateY(-1px);
}
/* 禁用态保留品牌色降饱和，避免「按钮坏了」的观感 */
.create__submit:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.create__tabs {
  display: flex;
  gap: 6px;
}
.create__tab {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font: inherit;
  font-size: 13px;
  font-weight: 500;
  padding: 7px 16px;
  border: 1px solid var(--border);
  border-radius: var(--r-pill);
  background: var(--bg);
  color: var(--text-dim);
  cursor: pointer;
  transition: all var(--dur-fast) var(--ease);
}
.create__tab:hover:not(:disabled):not(.create__tab--on) {
  border-color: var(--primary-soft);
  color: var(--primary-hover);
}
.create__tab--on {
  border-color: var(--primary);
  background: var(--primary-bg);
  color: var(--primary-hover);
  box-shadow: 0 0 0 3px rgb(var(--primary-rgb) / 8%);
}
.create__tab:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.create__progress {
  margin-top: 16px;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  border-radius: var(--r-md);
  background: var(--primary-bg);
  border: 1px solid var(--primary-border);
}
.create__spinner {
  flex: none;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  border: 2px solid var(--primary-border);
  border-top-color: var(--primary);
  animation: create-spin 0.7s linear infinite;
}
@keyframes create-spin {
  to {
    transform: rotate(360deg);
  }
}
.create__stage {
  font-size: 13px;
  font-weight: 600;
  color: var(--primary-hover);
}
.create__stage-sub {
  margin-top: 2px;
  font-size: 12px;
  color: var(--primary);
  opacity: 0.85;
}
.create__error {
  margin: 12px 0 0;
  font-size: 13px;
  color: var(--mastery-red);
}

/* ---------- 方向列表 ---------- */
.topics {
  max-width: 1120px;
  margin: 0 auto;
  padding: 8px 40px 80px;
}
.topics__head {
  display: flex;
  align-items: baseline;
  gap: 10px;
  margin-bottom: 20px;
}
.topics__head h2 {
  margin: 0;
  font-size: 20px;
  font-weight: 600;
}
.topics__count {
  font-size: 13px;
  color: var(--text-dim);
}
.topics__grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 18px;
}
.card {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 22px 24px 18px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: var(--r-lg);
  box-shadow: var(--shadow-sm);
  text-decoration: none;
  transition:
    transform var(--dur-fast) var(--ease),
    box-shadow var(--dur-fast) var(--ease),
    border-color var(--dur-fast) var(--ease);
}
.card:hover {
  transform: translateY(-2px);
  border-color: var(--primary-border);
  box-shadow: 0 10px 28px rgb(var(--primary-rgb) / 10%);
}
.card__main {
  display: flex;
  flex-direction: column;
  gap: 12px;
  text-decoration: none;
  color: inherit;
  min-width: 0;
}
.card__foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding-top: 12px;
  border-top: 1px dashed var(--border);
}
.card__waiting {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  color: var(--amber-text);
}
.card__go {
  text-decoration: none;
}
.card__progress {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.card__progress-row {
  display: flex;
  align-items: baseline;
  gap: 6px;
  font-size: 12px;
  color: var(--text-dim);
}
.card__progress-score {
  font-size: 15px;
  font-weight: 700;
  color: var(--text);
  font-variant-numeric: tabular-nums;
}
.card__bar {
  position: relative;
  height: 6px;
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
.card--skeleton {
  pointer-events: none;
}
.card__sk-title {
  height: 22px;
  width: 60%;
}
.card__sk-line {
  height: 14px;
  width: 100%;
}
.card__sk-line--short {
  width: 45%;
}
.card__top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.card__title {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.card__name {
  font-size: 17px;
  font-weight: 600;
  color: var(--text);
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
  padding: 2px 9px;
  border-radius: var(--r-pill);
  color: var(--amber-text);
  background: var(--amber-bg);
  border: 1px solid var(--amber-border);
  white-space: nowrap;
}
.card__arrow {
  display: inline-flex;
  color: var(--text-dim);
  transition:
    transform var(--dur-fast) var(--ease),
    color var(--dur-fast) var(--ease);
}
.card:hover .card__arrow {
  transform: translateX(3px);
  color: var(--primary-strong);
}
.card__tags {
  display: flex;
  gap: 6px;
}
.tag {
  font-size: 11px;
  padding: 2px 10px;
  border-radius: var(--r-pill);
  background: var(--bg-muted);
  color: var(--text-secondary);
}
.tag--style {
  background: var(--primary-bg);
  color: var(--primary-hover);
}
.card__stats {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: var(--text-dim);
}
.card__stats strong {
  color: var(--text);
  font-weight: 600;
}
.card__dot {
  color: var(--border);
}
.card__meta {
  font-size: 12px;
  color: var(--text-dim);
  opacity: 0.8;
}
.topics__empty {
  grid-column: 1 / -1;
  padding: 40px;
  text-align: center;
  color: var(--text-dim);
  font-size: 14px;
  border: 1px dashed var(--border);
  border-radius: var(--r-lg);
}

@media (max-width: 900px) {
  .hero {
    grid-template-columns: 1fr;
    gap: 32px;
    padding-top: 48px;
  }
}
</style>
