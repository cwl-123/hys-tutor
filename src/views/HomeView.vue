<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { CornerDownLeft, LoaderCircle, Sparkles, Zap } from 'lucide-vue-next'
import { useTopicStore } from '@/stores/topic'
import type { Topic, TopicProfile } from '@shared/types'
import { PROFILE_LEVELS, PROFILE_STYLES, pickOption } from '@/utils/topic-profile'
import OnboardingChat from '@/components/OnboardingChat.vue'
import TopicCard from '@/components/TopicCard.vue'

const store = useTopicStore()
const router = useRouter()

const STYLES = PROFILE_STYLES
const LEVELS = PROFILE_LEVELS

// Hero 左栏的工作流说明（与 AGENTS.md 闭环一致：调研 → 图谱 → 微课）
const STEPS = [
  { no: '01', title: '联网调研', desc: '检索并研读一手资料，整理研究笔记' },
  { no: '02', title: '知识图谱', desc: '拆解概念与前置依赖，生成学习路径' },
  { no: '03', title: '自适应微课', desc: '按掌握度排课，随堂练习实时反馈' },
] as const

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

</script>

<template>
  <div class="home">
    <!-- 顶部：左栏品牌主张 + 工作流，右栏创建面板；与下方卡片共用三列网格 -->
    <section class="hero page-grid">
      <div class="hero__copy">
        <div>
          <h1>把任何方向，<br>学成自己的体系</h1>
          <p class="hero__sub">
            AI 联网调研构建知识图谱，按你的掌握度持续生成个性化微课。
          </p>
        </div>
        <ol class="steps">
          <li
            v-for="st in STEPS"
            :key="st.no"
            class="step"
          >
            <span class="step__no">{{ st.no }}</span>
            <span class="step__title">{{ st.title }}</span>
            <span class="step__desc">{{ st.desc }}</span>
          </li>
        </ol>
      </div>

      <div class="composer">
        <div class="composer__head">
          <div
            class="seg"
            role="tablist"
          >
            <button
              type="button"
              role="tab"
              class="seg__item"
              :class="{ 'seg__item--on': mode === 'quick' }"
              :aria-selected="mode === 'quick'"
              :disabled="creating"
              @click="mode = 'quick'"
            >
              <Zap :size="13" />
              快速创建
            </button>
            <button
              type="button"
              role="tab"
              class="seg__item"
              :class="{ 'seg__item--on': mode === 'chat' }"
              :aria-selected="mode === 'chat'"
              :disabled="creating"
              @click="mode = 'chat'"
            >
              <Sparkles :size="13" />
              AI 帮我理清
            </button>
          </div>
        </div>

        <form
          v-show="mode === 'quick'"
          class="composer__form"
          @submit.prevent="createTopic"
        >
          <div class="composer__body">
            <input
              v-model="topicName"
              class="composer__title"
              type="text"
              placeholder="想学什么？如：CTR/CVR 预估模型、Kubernetes 网络、期权定价"
              :disabled="creating"
            >

            <div class="fields">
              <div class="field">
                <span class="field__label">讲解风格</span>
                <div class="chips">
                  <button
                    v-for="s in STYLES"
                    :key="s"
                    type="button"
                    class="chip"
                    :class="{ 'chip--on': style === s }"
                    :aria-pressed="style === s"
                    :disabled="creating"
                    @click="style = pickOption(style, s)"
                  >
                    {{ s }}
                  </button>
                </div>
              </div>
              <div class="field">
                <span class="field__label">当前程度</span>
                <div class="chips">
                  <button
                    v-for="l in LEVELS"
                    :key="l"
                    type="button"
                    class="chip"
                    :class="{ 'chip--on': level === l }"
                    :aria-pressed="level === l"
                    :disabled="creating"
                    @click="level = pickOption(level, l)"
                  >
                    {{ l }}
                  </button>
                </div>
              </div>
              <div class="field field--area">
                <span class="field__label">补充要求</span>
                <textarea
                  v-model="extra"
                  class="field__input field__textarea"
                  rows="1"
                  placeholder="可选，如「多结合广告业务案例」「少讲数学多讲工程实现」，可写多行"
                  :disabled="creating"
                />
              </div>
            </div>
          </div>

          <div class="composer__foot">
            <p class="composer__hint">
              以上偏好会注入调研、图谱与每节课的生成，之后可随时调整
            </p>
            <button
              class="submit"
              type="submit"
              :disabled="creating || !topicName.trim()"
            >
              <LoaderCircle
                v-if="creating"
                :size="14"
                class="spin"
              />
              {{ creating ? 'AI 调研生成中…' : '开启学习方向' }}
              <kbd
                v-if="!creating"
                class="submit__kbd"
              ><CornerDownLeft :size="11" /></kbd>
            </button>
          </div>
        </form>

        <div
          v-show="mode === 'chat'"
          class="composer__body composer__body--chat"
        >
          <OnboardingChat
            :creating="creating"
            @create="onChatCreate"
          />
        </div>

        <div
          v-if="store.stageText || store.error"
          class="composer__status"
        >
          <div
            v-if="store.stageText"
            class="progress"
          >
            <LoaderCircle
              :size="14"
              class="spin progress__icon"
            />
            <span class="progress__stage">{{ store.stageText }}</span>
            <span class="progress__sub">联网调研并生成知识图谱，约 1~3 分钟</span>
          </div>
          <p
            v-if="store.error"
            class="composer__error"
          >
            {{ store.error }}
          </p>
        </div>
      </div>
    </section>

    <!-- 我的学习方向 -->
    <section class="topics">
      <header class="topics__head">
        <h2>我的学习方向</h2>
        <span class="topics__count">{{ store.topics.length }}</span>
      </header>

      <div class="page-grid">
        <TopicCard
          v-for="t in store.topics"
          :key="t.id"
          :topic="t"
        />

        <!-- 加载骨架 -->
        <template v-if="store.loading && store.topics.length === 0">
          <div
            v-for="i in 3"
            :key="`sk-${i}`"
            class="card card--skeleton"
          >
            <div class="skeleton card__sk card__sk--title" />
            <div class="skeleton card__sk card__sk--short" />
            <div class="skeleton card__sk card__sk--block" />
            <div class="skeleton card__sk" />
          </div>
        </template>

        <div
          v-if="!store.loading && store.topics.length === 0"
          class="topics__empty"
        >
          <p class="topics__empty-title">
            还没有学习方向
          </p>
          <p class="topics__empty-sub">
            在上方输入一个想学的方向，AI 会先联网调研再为你生成知识图谱
          </p>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
/* ============================================================
 * 布局：顶栏、Hero、卡片共用 --page-max 容器与同一套三列网格，
 * 创建面板左缘与第二列卡片左缘严格对齐
 * ============================================================ */
.home {
  --gap: 16px;
  --card-pad: 20px;

  max-width: var(--page-max);
  margin: 0 auto;
  padding: 0 var(--page-pad) 120px;
  min-height: calc(100vh - var(--header-h));
}
.page-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--gap);
}

/* ---------- Hero ---------- */
.hero {
  padding: 88px 0 56px;
  align-items: stretch;
}
.hero__copy {
  display: flex;
  flex-direction: column;
  gap: 44px;
  padding-right: 24px;
}
.hero__copy h1 {
  /* 抵消行高留白，让首行字顶与右侧面板上缘对齐 */
  margin: -6px 0 0;
  font-size: 40px;
  line-height: 1.25;
  letter-spacing: -0.02em;
  font-weight: 650;
  color: var(--text);
}
.hero__sub {
  margin: 20px 0 0;
  max-width: 300px;
  font-size: 15px;
  line-height: 1.75;
  color: var(--text-dim);
}

.steps {
  margin: 0;
  padding: 0;
  list-style: none;
  border-top: 1px solid var(--border);
}
.step {
  display: flex;
  align-items: baseline;
  gap: 12px;
  height: 44px;
  line-height: 44px;
  border-bottom: 1px solid var(--border);
  white-space: nowrap;
  overflow: hidden;
}
.step__no {
  flex: none;
  width: 16px;
  font-family: ui-monospace, 'SF Mono', Menlo, monospace;
  font-size: 11px;
  font-weight: 500;
  color: var(--primary);
}
.step__title {
  flex: none;
  width: 72px;
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
}
.step__desc {
  min-width: 0;
  font-size: 12px;
  color: var(--text-dim);
  overflow: hidden;
  text-overflow: ellipsis;
}

/* ---------- 创建面板 ---------- */
.composer {
  grid-column: 2 / -1;
  display: flex;
  flex-direction: column;
  min-height: 400px;
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  background: var(--bg);
  box-shadow: var(--shadow-xs);
  overflow: hidden;
}
.composer__head {
  display: flex;
  align-items: center;
  height: 52px;
  padding: 0 var(--card-pad) 0 12px;
  border-bottom: 1px solid var(--border);
}
.seg {
  display: inline-flex;
  gap: 2px;
  padding: 2px;
  border-radius: 8px;
  background: var(--bg-muted);
}
.seg__item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 12px;
  font: inherit;
  font-size: 12px;
  font-weight: 500;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--text-dim);
  cursor: pointer;
  transition:
    color var(--dur-fast) var(--ease),
    background var(--dur-fast) var(--ease);
}
.seg__item:hover:not(:disabled):not(.seg__item--on) {
  color: var(--text);
}
.seg__item--on {
  background: var(--bg);
  color: var(--text);
  box-shadow:
    0 0 0 1px var(--border),
    var(--shadow-xs);
}
.seg__item:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.composer__form {
  display: flex;
  flex: 1;
  flex-direction: column;
}
.composer__body {
  flex: 1;
  display: flex;
  flex-direction: column;
  padding: 20px var(--card-pad) 24px;
}
.composer__body--chat {
  display: flex;
  flex-direction: column;
}
.composer__body--chat :deep(.ob) {
  margin-top: 0;
}
.composer__title {
  display: block;
  width: 100%;
  height: 32px;
  padding: 0;
  font: inherit;
  font-size: 18px;
  font-weight: 500;
  letter-spacing: -0.01em;
  color: var(--text);
  border: none;
  background: transparent;
}
.composer__title::placeholder {
  color: var(--text-faint);
  font-weight: 400;
}
.composer__title:focus,
.composer__title:focus-visible {
  outline: none;
  box-shadow: none;
}

.fields {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 12px;
  margin-top: 20px;
  padding-top: 20px;
  border-top: 1px dashed var(--border);
}
.field {
  display: grid;
  grid-template-columns: 72px minmax(0, 1fr);
  align-items: center;
  min-height: 30px;
}
.field__label {
  font-size: 12px;
  color: var(--text-dim);
}
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.chip {
  display: inline-flex;
  align-items: center;
  height: 28px;
  padding: 0 12px;
  font: inherit;
  font-size: 12px;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: var(--bg);
  color: var(--text-secondary);
  cursor: pointer;
  transition:
    border-color var(--dur-fast) var(--ease),
    background var(--dur-fast) var(--ease),
    color var(--dur-fast) var(--ease);
}
.chip:hover:not(:disabled) {
  border-color: var(--border-strong);
  color: var(--text);
}
.chip--on,
.chip--on:hover:not(:disabled) {
  border-color: var(--primary-border);
  background: var(--primary-bg);
  color: var(--primary-strong);
  font-weight: 500;
}
.chip:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}
.field__input {
  width: 100%;
  height: 30px;
  padding: 0 10px;
  font: inherit;
  font-size: 12px;
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg);
  transition:
    border-color var(--dur-fast) var(--ease),
    box-shadow var(--dur-fast) var(--ease);
}
.field__input::placeholder {
  color: var(--text-faint);
}
.field__input:hover:not(:disabled) {
  border-color: var(--border-strong);
}
.field--area {
  flex: 1;
  align-items: stretch;
}
.field--area .field__label {
  align-self: start;
  padding-top: 8px;
}
.field__textarea {
  height: 100%;
  min-height: 96px;
  padding: 7px 10px;
  line-height: 1.65;
  resize: vertical;
}

.composer__foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  height: 56px;
  padding: 0 12px 0 var(--card-pad);
  border-top: 1px solid var(--border);
  background: var(--bg-subtle);
}
.composer__hint {
  margin: 0;
  min-width: 0;
  font-size: 12px;
  color: var(--text-faint);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.submit {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: 32px;
  padding: 0 8px 0 14px;
  font: inherit;
  font-size: 13px;
  font-weight: 500;
  white-space: nowrap;
  border: none;
  border-radius: 7px;
  background: var(--primary-btn);
  color: #fff;
  cursor: pointer;
  transition:
    background var(--dur-fast) var(--ease),
    opacity var(--dur-fast) var(--ease);
}
.submit:hover:not(:disabled) {
  background: var(--primary-btn-hover);
}
.submit:disabled {
  background: var(--bg-muted);
  color: var(--text-faint);
  box-shadow: inset 0 0 0 1px var(--border);
  cursor: not-allowed;
}
.submit:disabled .submit__kbd {
  background: var(--border);
}
.submit__kbd {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 18px;
  border-radius: 4px;
  background: rgb(255 255 255 / 18%);
  font: inherit;
}
.submit__kbd .lucide {
  vertical-align: 0;
}

.composer__status {
  padding: 12px var(--card-pad);
  border-top: 1px solid var(--border);
}
.progress {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
}
.progress__icon {
  flex: none;
  color: var(--text-dim);
}
.progress__stage {
  font-weight: 500;
  color: var(--text);
}
.progress__sub {
  margin-left: auto;
  color: var(--text-faint);
}
.composer__error {
  margin: 0;
  font-size: 12px;
  color: var(--mastery-red);
}
.progress + .composer__error {
  margin-top: 8px;
}

/* ---------- 方向列表 ---------- */
.topics__head {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 24px;
  margin-bottom: 16px;
}
.topics__head h2 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: var(--text);
}
.topics__count {
  display: inline-flex;
  align-items: center;
  height: 18px;
  padding: 0 6px;
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  color: var(--text-dim);
  border: 1px solid var(--border);
  border-radius: 5px;
}

.card--skeleton {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: var(--card-pad);
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  pointer-events: none;
}
.card__sk {
  height: 12px;
  border-radius: 4px;
}
.card__sk--title {
  height: 16px;
  width: 55%;
}
.card__sk--short {
  width: 35%;
}
.card__sk--block {
  height: 44px;
}

.topics__empty {
  grid-column: 1 / -1;
  padding: 56px 24px;
  text-align: center;
  border: 1px dashed var(--border);
  border-radius: var(--r-md);
}
.topics__empty-title {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--text);
}
.topics__empty-sub {
  margin: 6px 0 0;
  font-size: 13px;
  color: var(--text-dim);
}

/* ---------- 窄屏回退（仅桌面端，覆盖小窗口） ---------- */
@media (max-width: 1080px) {
  .page-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .hero {
    grid-template-columns: 1fr;
    gap: 40px;
    padding-top: 64px;
  }
  .hero__copy {
    padding-right: 0;
  }
  .composer {
    grid-column: auto;
  }
}
@media (max-width: 720px) {
  .page-grid {
    grid-template-columns: 1fr;
  }
}
</style>
