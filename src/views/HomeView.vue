<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import {
  ArrowRight,
  ArrowUpRight,
  Gauge,
  Globe,
  LoaderCircle,
  Repeat,
  Sparkles,
  Zap,
} from 'lucide-vue-next'
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

// 卡片头像：按 topic id 哈希取渐变，稳定不闪烁
const AVATAR_GRADIENTS = [
  'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
  'linear-gradient(135deg, #0ea5e9 0%, #2563eb 100%)',
  'linear-gradient(135deg, #f59e0b 0%, #ef4444 100%)',
  'linear-gradient(135deg, #10b981 0%, #0d9488 100%)',
  'linear-gradient(135deg, #ec4899 0%, #8b5cf6 100%)',
  'linear-gradient(135deg, #f97316 0%, #eab308 100%)',
]
function avatarOf(t: Topic): string {
  let h = 0
  for (const ch of t.id) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return AVATAR_GRADIENTS[h % AVATAR_GRADIENTS.length]
}
function initialOf(name: string): string {
  return [...name.trim()][0]?.toUpperCase() ?? '学'
}
</script>

<template>
  <div class="home">
    <!-- 顶部：品牌主张 + 创建新方向 -->
    <section class="hero">
      <div class="hero__copy">
        <span class="hero__badge">
          <Sparkles :size="13" />
          AI 自适应私教
        </span>
        <h1>
          把任何方向，<br>学成<span class="hero__accent">自己的体系</span>
        </h1>
        <p class="hero__sub">
          AI 联网调研知识体系，每轮微课按你的掌握度定制，练习反馈实时驱动下一课。
        </p>
        <ul class="hero__feats">
          <li><Globe :size="14" /><span>联网调研<br>构建知识图谱</span></li>
          <li><Gauge :size="14" /><span>掌握度驱动<br>个性排课</span></li>
          <li><Repeat :size="14" /><span>练习反馈<br>闭环迭代</span></li>
        </ul>
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
              <LoaderCircle
                v-if="creating"
                :size="15"
                class="spin"
              />
              {{ creating ? 'AI 调研生成中…' : '开启学习方向' }}
              <ArrowRight
                v-if="!creating"
                :size="15"
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
        <span class="topics__count">{{ store.topics.length }}</span>
      </div>

      <div class="topics__grid">
        <div
          v-for="(t, i) in store.topics"
          :key="t.id"
          class="card"
          :style="{ '--i': i }"
        >
          <RouterLink
            :to="`/topic/${t.id}`"
            class="card__main"
          >
            <div class="card__top">
              <span
                class="card__avatar"
                :style="{ background: avatarOf(t) }"
              >{{ initialOf(t.name) }}</span>
              <div class="card__heading">
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
              </div>
              <span class="card__arrow"><ArrowUpRight :size="16" /></span>
            </div>

            <div class="card__stats">
              <span><strong>{{ t.stats.nodeCount }}</strong> 知识点</span>
              <span class="card__dot" />
              <span><strong>{{ t.stats.lessonCount }}</strong> 节课</span>
              <template v-if="t.stats.lastLessonAt">
                <span class="card__dot" />
                <span>最近学习 {{ fmtRelative(t.stats.lastLessonAt) }}</span>
              </template>
            </div>
          </RouterLink>

          <div
            v-if="t.stats.nodeCount > 0"
            class="card__progress"
          >
            <div class="card__progress-row">
              <span class="card__progress-label">平均掌握</span>
              <strong
                class="card__progress-score"
                :class="`card__progress-score--${masteryLevel(t.stats.avgMastery)}`"
              >{{ t.stats.avgMastery }}</strong>
              <span class="card__progress-sub">{{ t.stats.masteredCount }}/{{ t.stats.nodeCount }} 已掌握</span>
            </div>
            <div class="card__bar">
              <i
                :class="`card__bar-fill--${masteryLevel(t.stats.avgMastery)}`"
                :style="{ width: `${Math.max(t.stats.avgMastery, 2)}%` }"
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
            <div class="card__sk-top">
              <div class="skeleton card__sk-avatar" />
              <div class="card__sk-head">
                <div class="skeleton card__sk-title" />
                <div class="skeleton card__sk-line card__sk-line--short" />
              </div>
            </div>
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
    radial-gradient(900px 320px at 20% -60px, rgb(var(--primary-rgb) / 8%), transparent),
    radial-gradient(700px 300px at 85% 0%, rgb(139 92 246 / 6%), transparent),
    var(--bg);
}

/* ---------- Hero + 创建 ---------- */
.hero {
  max-width: 1160px;
  margin: 0 auto;
  padding: 80px 40px 56px;
  display: grid;
  grid-template-columns: 1fr 1.05fr;
  gap: 64px;
  align-items: center;
}
.hero__badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 500;
  letter-spacing: 0.2px;
  color: var(--primary-hover);
  background: var(--primary-bg);
  border: 1px solid var(--primary-border);
  border-radius: var(--r-pill);
  padding: 5px 13px;
}
.hero__copy h1 {
  margin: 22px 0 0;
  font-size: 44px;
  line-height: 1.28;
  letter-spacing: -0.8px;
  font-weight: 700;
}
.hero__accent {
  background: linear-gradient(115deg, var(--primary-strong) 10%, #8b5cf6 90%);
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
}
.hero__sub {
  margin: 20px 0 0;
  font-size: 15px;
  line-height: 1.9;
  color: var(--text-dim);
  max-width: 420px;
}
.hero__feats {
  list-style: none;
  margin: 34px 0 0;
  padding: 0;
  display: flex;
  gap: 12px;
}
.hero__feats li {
  flex: 1;
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 14px 16px;
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  background: color-mix(in srgb, var(--bg) 70%, transparent);
  font-size: 12px;
  line-height: 1.6;
  color: var(--text-secondary);
}
.hero__feats .lucide {
  flex: none;
  margin-top: 3px;
  color: var(--primary);
}
.create {
  position: relative;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: var(--r-lg);
  padding: 24px 28px 26px;
  box-shadow: var(--shadow-lg);
}
/* 卡片顶部品牌渐变描线 */
.create::before {
  content: '';
  position: absolute;
  top: -1px;
  left: 28px;
  right: 28px;
  height: 2px;
  border-radius: 2px;
  background: linear-gradient(90deg, var(--primary) 0%, #8b5cf6 100%);
  opacity: 0.9;
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
  font-size: 13px;
  font-weight: 500;
  padding: 6px 16px;
  border: none;
  border-radius: var(--r-pill);
  background: transparent;
  color: var(--text-dim);
  cursor: pointer;
  transition: all var(--dur-fast) var(--ease);
}
.create__tab:hover:not(:disabled):not(.create__tab--on) {
  color: var(--text);
}
.create__tab--on {
  background: var(--bg);
  color: var(--primary-hover);
  box-shadow: var(--shadow-sm);
}
.create__tab:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.create__name {
  margin-top: 18px;
  width: 100%;
  font: inherit;
  font-size: 15px;
  padding: 12px 16px;
  border: 1px solid var(--border);
  border-radius: var(--r-md);
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
.create__guide {
  margin-top: 16px;
  padding: 16px 18px;
  border-radius: var(--r-md);
  background: var(--bg-subtle);
  border: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  gap: 13px;
}
.guide-row {
  display: flex;
  align-items: center;
  gap: 12px;
}
.guide-row__label {
  flex: none;
  width: 60px;
  font-size: 12px;
  font-weight: 500;
  color: var(--text-dim);
}
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
}
.chip {
  font: inherit;
  font-size: 12px;
  padding: 4px 13px;
  border-radius: var(--r-pill);
  border: 1px solid var(--border);
  background: var(--bg);
  color: var(--text-secondary);
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
  font-size: 12px;
  padding: 9px 13px;
  border: 1px dashed var(--border-strong);
  border-radius: var(--r-sm);
  background: var(--bg);
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
  color: var(--text-faint);
  line-height: 1.6;
}
.create__submit {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font: inherit;
  font-size: 14px;
  font-weight: 600;
  padding: 11px 24px;
  border: none;
  border-radius: var(--r-md);
  background: linear-gradient(120deg, var(--primary-btn) 30%, #4f46e5 100%);
  color: #fff;
  cursor: pointer;
  box-shadow: 0 2px 8px rgb(var(--primary-rgb) / 30%);
  transition:
    filter var(--dur-fast) var(--ease),
    opacity var(--dur-fast) var(--ease),
    transform var(--dur-fast) var(--ease),
    box-shadow var(--dur-fast) var(--ease);
}
.create__submit:hover:not(:disabled) {
  filter: brightness(1.06);
  transform: translateY(-1px);
  box-shadow: 0 4px 14px rgb(var(--primary-rgb) / 38%);
}
.create__submit:active:not(:disabled) {
  transform: translateY(0);
}
/* 禁用态保留品牌色降饱和，避免「按钮坏了」的观感 */
.create__submit:disabled {
  opacity: 0.45;
  cursor: not-allowed;
  box-shadow: none;
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
  max-width: 1160px;
  margin: 0 auto;
  padding: 4px 40px 88px;
}
.topics__head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 22px;
}
.topics__head h2 {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  letter-spacing: 0.1px;
}
.topics__count {
  font-size: 12px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: var(--text-dim);
  background: var(--bg-muted);
  border-radius: var(--r-pill);
  padding: 2px 10px;
}
.topics__grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(330px, 1fr));
  gap: 18px;
}
.card {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 20px 22px 16px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: var(--r-lg);
  box-shadow: var(--shadow-sm);
  animation: card-in 0.35s var(--ease) both;
  animation-delay: calc(var(--i, 0) * 45ms);
  transition:
    transform var(--dur-fast) var(--ease),
    box-shadow var(--dur-fast) var(--ease),
    border-color var(--dur-fast) var(--ease);
}
@keyframes card-in {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
}
.card:hover {
  transform: translateY(-3px);
  border-color: var(--primary-border);
  box-shadow: 0 12px 32px rgb(var(--primary-rgb) / 12%);
}
.card__main {
  display: flex;
  flex-direction: column;
  gap: 12px;
  text-decoration: none;
  color: inherit;
  min-width: 0;
}
.card__top {
  display: flex;
  align-items: center;
  gap: 12px;
}
.card__avatar {
  flex: none;
  width: 40px;
  height: 40px;
  border-radius: 11px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 17px;
  font-weight: 600;
  color: #fff;
  text-shadow: 0 1px 2px rgb(0 0 0 / 18%);
  box-shadow: inset 0 0 0 1px rgb(255 255 255 / 18%);
}
.card__heading {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.card__title {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.card__name {
  font-size: 15px;
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
  flex: none;
  display: inline-flex;
  color: var(--text-faint);
  opacity: 0;
  transform: translate(-3px, 3px);
  transition: all var(--dur-fast) var(--ease);
}
.card:hover .card__arrow {
  opacity: 1;
  transform: translate(0, 0);
  color: var(--primary-strong);
}
.card__tags {
  display: flex;
  gap: 6px;
}
.tag {
  font-size: 11px;
  padding: 2px 9px;
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
  gap: 10px;
  font-size: 12px;
  color: var(--text-dim);
}
.card__stats strong {
  color: var(--text);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.card__dot {
  width: 3px;
  height: 3px;
  border-radius: 50%;
  background: var(--border-strong);
}
.card__progress {
  display: flex;
  flex-direction: column;
  gap: 7px;
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
  font-variant-numeric: tabular-nums;
}
.card__progress-score--red {
  color: var(--mastery-red);
}
.card__progress-score--yellow {
  color: var(--mastery-yellow);
}
.card__progress-score--green {
  color: var(--mastery-green);
}
.card__progress-sub {
  margin-left: auto;
  color: var(--text-faint);
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
  background: linear-gradient(90deg, #f87171, var(--mastery-red));
}
.card__bar-fill--yellow {
  background: linear-gradient(90deg, #fbbf24, var(--mastery-yellow));
}
.card__bar-fill--green {
  background: linear-gradient(90deg, #4ade80, var(--mastery-green));
}
.card__foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding-top: 13px;
  border-top: 1px solid var(--border);
}
.card__meta {
  font-size: 12px;
  color: var(--text-faint);
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
.card--skeleton {
  pointer-events: none;
}
.card__sk-top {
  display: flex;
  align-items: center;
  gap: 12px;
}
.card__sk-avatar {
  flex: none;
  width: 40px;
  height: 40px;
  border-radius: 11px;
}
.card__sk-head {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 8px;
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
  font-size: 14px;
  border: 1px dashed var(--border);
  border-radius: var(--r-lg);
}

@media (max-width: 900px) {
  .hero {
    grid-template-columns: 1fr;
    gap: 36px;
    padding-top: 52px;
  }
  .hero__copy h1 {
    font-size: 34px;
  }
}
</style>
