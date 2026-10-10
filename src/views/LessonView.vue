<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowLeft, CircleCheckBig, MessageSquare, Pencil, Sparkles, X } from 'lucide-vue-next'
import { useLessonStore } from '@/stores/lesson'
import { useTopicStore } from '@/stores/topic'
import MarkdownRenderer from '@/components/MarkdownRenderer.vue'
import LessonBody from '@/components/LessonBody.vue'
import LessonChatPanel from '@/components/LessonChatPanel.vue'
import { replaceMermaidBlock } from '@shared/lesson-md'
import { LESSON_PHASES } from '@/stores/lesson'
import type { LessonQuote } from '@shared/lesson-chat'

const route = useRoute()
const router = useRouter()
const lessonStore = useLessonStore()
const topicStore = useTopicStore()

const stageList = ref<HTMLElement | null>(null)
const reviseOpen = ref(false)
const reviseInstruction = ref('')
const chatOpen = ref(false)
const quoteRequest = ref<(LessonQuote & { nonce: number }) | null>(null)
const opError = ref<string | null>(null)

// 正文「改本节」/划词引用 → 打开对话面板并带上引用
function onQuote(quote: LessonQuote) {
  chatOpen.value = true
  quoteRequest.value = { ...quote, nonce: Date.now() }
}

// ---------- Mermaid 图表编辑 ----------
const mermaidEdit = ref<{ code: string; draft: string } | null>(null)
const mermaidPreview = computed(() =>
  mermaidEdit.value ? `\`\`\`mermaid\n${mermaidEdit.value.draft}\n\`\`\`` : '',
)

function openMermaidEdit(code: string) {
  mermaidEdit.value = { code, draft: code }
}

async function saveMermaidEdit() {
  const edit = mermaidEdit.value
  const lesson = lessonStore.lesson
  if (!edit || !lesson) return
  opError.value = null
  if (!edit.draft.trim()) {
    opError.value = '图表代码不能为空'
    return
  }
  const next = replaceMermaidBlock(lesson.contentMd, edit.code, edit.draft)
  if (next == null) {
    opError.value = '未找到对应的图表代码块，请刷新页面后重试'
    return
  }
  try {
    await lessonStore.saveContent(next, '修改 Mermaid 图表')
    mermaidEdit.value = null
  } catch (err) {
    opError.value = err instanceof Error ? err.message : String(err)
  }
}

// ---------- 手动编辑正文（textarea + 实时预览） ----------
const editing = ref(false)
const draft = ref('')

function startEditing() {
  draft.value = lessonStore.lesson?.contentMd ?? ''
  editing.value = true
  opError.value = null
}

async function saveEditing() {
  opError.value = null
  try {
    await lessonStore.saveContent(draft.value, '手动编辑课件')
    editing.value = false
  } catch (err) {
    opError.value = err instanceof Error ? err.message : String(err)
  }
}

async function reloadLesson() {
  const lesson = lessonStore.lesson
  if (lesson) await lessonStore.load(lesson.id)
}

const isNew = computed(() => route.params.id === 'new')
const nodeName = computed(() => {
  const lesson = lessonStore.lesson
  if (!lesson || !topicStore.graph) return ''
  const node = topicStore.graph.nodes.find((n) => n.id === lesson.nodeIds[0])
  return node?.name ?? lesson.nodeIds[0]
})
const topicHome = computed(
  () => `/topic/${lessonStore.lesson?.topicId ?? topicStore.topic?.id ?? ''}`,
)

// 只有真正落盘完成、且有正文的课程才渲染正文；否则一律走进度/失败/中断分支
const isGenerated = computed(
  () => lessonStore.lesson?.status === 'generated' && lessonStore.lesson.contentMd.trim().length > 0,
)
// 记录存在但既未生成完成、又已不在生成中（例如服务重启把任务丢了）
const isInterrupted = computed(
  () =>
    !!lessonStore.lesson &&
    !lessonStore.generating &&
    lessonStore.lesson.status !== 'generated' &&
    lessonStore.lesson.status !== 'failed' &&
    !lessonStore.error,
)
// 占位原因（如「备课任务已创建…」）没有展示价值，仅在选题完成后才显示
const scheduleReason = computed(() => {
  const r = lessonStore.lesson?.scheduleReason?.trim() ?? ''
  return r && !r.endsWith('…') ? r : ''
})

// ---------- 进度视图 ----------
const phases = LESSON_PHASES
const progressPercent = computed(() =>
  Math.min(100, Math.round(((lessonStore.phase + 1) / phases.length) * 100)),
)
const currentPhaseLabel = computed(() => phases[Math.min(lessonStore.phase, phases.length - 1)])
// 生成中的课程名：优先后台选题阶段给出的知识点名，其次已加载课程
const generatingName = computed(() => {
  const picked = lessonStore.stages.find((s) => s.label.startsWith('已选题：'))
  if (picked) return picked.label.replace(/^已选题：/, '').split(' —— ')[0]
  return nodeName.value || topicStore.topic?.name || '这门课'
})
const nowTick = ref(Date.now())
let tickTimer: number | undefined
watch(
  () => lessonStore.generating,
  (on) => {
    window.clearInterval(tickTimer)
    if (on) tickTimer = window.setInterval(() => (nowTick.value = Date.now()), 1000)
  },
  { immediate: true },
)
const elapsedText = computed(() => {
  const start = lessonStore.startedAt
  if (!start) return ''
  const sec = Math.max(0, Math.floor((nowTick.value - start) / 1000))
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return m > 0 ? `${m} 分 ${s} 秒` : `${s} 秒`
})

// 备课进行中自动滚动进度列表
watch(
  () => lessonStore.stages.length,
  async () => {
    await nextTick()
    stageList.value?.scrollTo({ top: stageList.value.scrollHeight })
  },
)

// 用户可能在备课尚未结束时离开本页（返回图谱）；离开后不再用后台 promise 的 router.replace 把用户拽回课件
let disposed = false

async function startGeneration() {
  lessonStore.reset()
  // 优先用路由 query 指定的学习方向；直接刷新页面时回退到唯一课题
  let topicId = typeof route.query.topic === 'string' ? route.query.topic : ''
  if (!topicId && topicStore.topic) topicId = topicStore.topic.id
  if (!topicId) {
    await topicStore.fetchTopics()
    if (topicStore.topics.length === 1) topicId = topicStore.topics[0].id
  }
  if (!topicId) {
    lessonStore.error = '无法确定学习方向，请从图谱页点「开始下一课」'
    return
  }
  if (topicStore.topic?.id !== topicId || !topicStore.graph) await topicStore.loadTopic(topicId)
  const nodeId = typeof route.query.node === 'string' ? route.query.node : undefined
  const lessonId = await lessonStore.generate(topicId, nodeId)
  if (lessonId && !disposed) await router.replace(`/lesson/${lessonId}`)
}

onMounted(async () => {
  try {
    if (isNew.value) {
      await startGeneration()
    } else {
      // 直接进入已有课程：先清空上一课的残留状态（尤其是 error），否则旧错误会盖住新课页面
      lessonStore.reset()
      lessonStore.justCompleted = false
      await lessonStore.load(String(route.params.id))
      const lessonTopicId = lessonStore.lesson?.topicId
      if (lessonTopicId && topicStore.topic?.id !== lessonTopicId) {
        await topicStore.loadTopic(lessonTopicId)
      }
      // 在途/中断的备课：重新挂接进度流
      const status = lessonStore.lesson?.status
      if (status && status !== 'generated' && status !== 'failed') {
        await lessonStore.attach(String(route.params.id))
        await lessonStore.load(String(route.params.id))
      }
    }
  } catch (err) {
    lessonStore.error = err instanceof Error ? err.message : String(err)
  }
})

async function retry() {
  const lesson = lessonStore.lesson
  if (lesson) {
    const lessonId = await lessonStore.generate(lesson.topicId, lesson.nodeIds[0])
    if (lessonId && lessonId !== lesson.id && !disposed) await router.replace(`/lesson/${lessonId}`)
    return
  }
  await startGeneration()
}

async function startRevise() {
  const lesson = lessonStore.lesson
  if (!lesson) return
  reviseOpen.value = false
  await lessonStore.revise(lesson.id, reviseInstruction.value)
  reviseInstruction.value = ''
  await lessonStore.load(lesson.id)
}

// 离开备课页时断开进度流；备课任务在后台继续，可从图谱页再次进入回放
onUnmounted(() => {
  disposed = true
  window.clearInterval(tickTimer)
  lessonStore.detach()
})
</script>

<template>
  <div
    class="lesson-view"
    :class="{ 'lesson-view--chat': chatOpen && lessonStore.lesson }"
  >
    <!-- 备课中：阶段进度 + 流式正文 -->
    <div
      v-if="lessonStore.generating"
      class="progress"
    >
      <div class="progress__head">
        <div>
          <h1>{{ lessonStore.lesson?.status === 'revising' ? '正在优化课件…' : '正在备课…' }}</h1>
          <p class="progress__sub">
            《{{ generatingName }}》· AI 正在联网研究并撰写
          </p>
        </div>
        <RouterLink
          :to="topicHome"
          class="btn"
        >
          <ArrowLeft :size="14" />
          返回图谱
        </RouterLink>
      </div>

      <div class="progress__bar">
        <i
          class="progress__bar-fill"
          :style="{ width: `${progressPercent}%` }"
        />
      </div>
      <div class="progress__meta">
        <span class="progress__phase">{{ currentPhaseLabel }}</span>
        <span>{{ progressPercent }}% · 已用 {{ elapsedText }}</span>
      </div>

      <ol class="progress__steps">
        <li
          v-for="(p, i) in phases"
          :key="p"
          :class="{ 'is-done': i < lessonStore.phase, 'is-active': i === lessonStore.phase }"
        >
          <span class="progress__dot">{{ i < lessonStore.phase ? '✓' : '' }}</span>
          <span>{{ p }}</span>
        </li>
      </ol>

      <p class="progress__hint">
        全程约 2~5 分钟（研究笔记命中缓存约 1 分钟）。可先返回图谱，备课在后台继续，随时点顶部「课件生成中」再进来查看。
      </p>

      <details
        v-if="lessonStore.stages.length"
        class="progress__log"
      >
        <summary>展开实时日志（{{ lessonStore.stages.length }} 条）</summary>
        <ol
          ref="stageList"
          class="progress__log-list"
        >
          <li
            v-for="s in lessonStore.stages"
            :key="s.key"
          >
            {{ s.label }}
          </li>
        </ol>
      </details>

      <div
        v-if="lessonStore.streamingContent"
        class="progress__stream"
      >
        <div class="progress__stream-title">
          正文预览（实时）
        </div>
        <MarkdownRenderer :content="lessonStore.streamingContent" />
      </div>
    </div>

    <!-- 出错 / 历史失败 -->
    <div
      v-else-if="lessonStore.error || lessonStore.lesson?.status === 'failed'"
      class="state"
    >
      <h1>备课失败</h1>
      <p class="state__error">
        {{ lessonStore.error || '上次备课未成功完成' }}
      </p>
      <div class="state__actions">
        <button
          class="btn btn--primary"
          @click="retry"
        >
          重新备课
        </button>
        <RouterLink
          :to="topicHome"
          class="btn"
        >
          <ArrowLeft :size="14" />
          返回图谱
        </RouterLink>
      </div>
    </div>

    <!-- 记录存在但未生成完成（任务中断/丢失） -->
    <div
      v-else-if="isInterrupted"
      class="state"
    >
      <h1>课件尚未生成完成</h1>
      <p class="state__error">
        后台备课任务已中断（可能是服务重启导致）。当前进度：{{ lessonStore.lesson?.status }}
      </p>
      <div class="state__actions">
        <button
          class="btn btn--primary"
          @click="retry"
        >
          重新备课
        </button>
        <RouterLink
          :to="topicHome"
          class="btn"
        >
          <ArrowLeft :size="14" />
          返回图谱
        </RouterLink>
      </div>
    </div>

    <!-- 课程正文 -->
    <article
      v-else-if="lessonStore.lesson && isGenerated"
      class="lesson"
    >
      <div
        v-if="lessonStore.justCompleted"
        class="lesson__done-banner"
      >
        <span class="lesson__done-text">
          <CircleCheckBig :size="15" />
          课件已生成，可以开始学习了
        </span>
        <button
          class="lesson__done-close"
          title="关闭"
          @click="lessonStore.justCompleted = false"
        >
          <X :size="15" />
        </button>
      </div>
      <header class="lesson__header">
        <div class="lesson__crumb">
          <RouterLink :to="topicHome">
            <ArrowLeft :size="13" />
            知识图谱
          </RouterLink>
          <span>{{ lessonStore.topic?.name }}</span>
        </div>
        <h1>{{ nodeName }}</h1>
        <p
          v-if="scheduleReason"
          class="lesson__reason"
        >
          为什么这节课讲这个：{{ scheduleReason }}
        </p>
        <div class="lesson__actions">
          <button
            v-if="editing"
            class="btn btn--primary"
            @click="saveEditing"
          >
            保存修改
          </button>
          <button
            v-if="editing"
            class="btn"
            @click="editing = false"
          >
            取消
          </button>
          <button
            v-else
            class="btn"
            :disabled="lessonStore.generating"
            @click="startEditing"
          >
            <Pencil :size="13" />
            编辑正文
          </button>
          <button
            class="btn"
            :disabled="lessonStore.generating || editing"
            @click="chatOpen = !chatOpen"
          >
            <MessageSquare :size="13" />
            {{ chatOpen ? '收起 AI 对话' : 'AI 对话优化' }}
          </button>
          <button
            class="btn"
            :disabled="lessonStore.generating || editing"
            @click="reviseOpen = true"
          >
            <Sparkles :size="13" />
            AI 优化本课
          </button>
          <span
            v-if="lessonStore.lesson.revisedAt"
            class="lesson__revised"
          >
            已于 {{ new Date(lessonStore.lesson.revisedAt).toLocaleString('zh-CN') }} 优化
          </span>
        </div>
        <p
          v-if="opError"
          class="lesson__op-error"
        >
          {{ opError }}
        </p>
      </header>

      <!-- 手动编辑：左 markdown 右实时预览 -->
      <div
        v-if="editing"
        class="editor"
      >
        <textarea
          v-model="draft"
          class="editor__ta"
          spellcheck="false"
        />
        <div class="editor__preview">
          <MarkdownRenderer :content="draft" />
        </div>
      </div>

      <LessonBody
        v-else
        :content="lessonStore.lesson.contentMd"
        @quote="onQuote"
        @edit-mermaid="openMermaidEdit"
      />

      <section
        v-if="!editing && lessonStore.lesson.images?.length"
        class="lesson__sources"
      >
        <h2>图片来源</h2>
        <ol>
          <li
            v-for="(img, i) in lessonStore.lesson.images"
            :key="i"
          >
            <a
              v-if="img.pageUrl || img.originUrl"
              :href="img.pageUrl || img.originUrl"
              target="_blank"
              rel="noopener"
            >{{ img.alt || img.pageUrl || img.originUrl }}</a>
            <span v-else>{{ img.alt || `图片 ${i + 1}` }}</span>
          </li>
        </ol>
      </section>

      <section
        v-if="lessonStore.lesson.sources.length"
        class="lesson__sources"
      >
        <h2>参考来源</h2>
        <ol>
          <li
            v-for="s in lessonStore.lesson.sources"
            :key="s.idx"
          >
            <a
              :href="s.url"
              target="_blank"
              rel="noopener"
            >{{ s.title }}</a>
          </li>
        </ol>
      </section>

      <footer class="lesson__footer">
        <RouterLink
          :to="`/lesson/${lessonStore.lesson.id}/exercise`"
          class="btn btn--primary btn--lg"
        >
          去随堂练习（{{ lessonStore.questions.length }} 题）
        </RouterLink>
      </footer>
    </article>

    <div
      v-else
      class="state"
    >
      <p>加载中…</p>
    </div>

    <!-- AI 优化弹窗 -->
    <Teleport to="body">
      <div
        v-if="reviseOpen"
        class="mask"
        @click.self="reviseOpen = false"
      >
        <div class="revise-modal">
          <h3>AI 优化本课</h3>
          <p class="revise-modal__hint">
            告诉 AI 哪里不满意（讲得太深/例子不好/想多看推导/篇幅太长…），它会基于原研究笔记重写全文并重新出题；留空则自行检查改进。
          </p>
          <textarea
            v-model="reviseInstruction"
            rows="4"
            placeholder="如：公式推导跳步太多，请补全；把例子换成广告出价场景"
          />
          <div class="revise-modal__actions">
            <button
              class="btn"
              @click="reviseOpen = false"
            >
              取消
            </button>
            <button
              class="btn btn--primary"
              @click="startRevise"
            >
              开始优化
            </button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- Mermaid 图表编辑弹窗 -->
    <Teleport to="body">
      <div
        v-if="mermaidEdit"
        class="mask"
        @click.self="mermaidEdit = null"
      >
        <div class="mermaid-modal">
          <h3>编辑 Mermaid 图表</h3>
          <div class="mermaid-modal__panes">
            <textarea
              v-model="mermaidEdit.draft"
              class="mermaid-modal__ta"
              spellcheck="false"
            />
            <div class="mermaid-modal__preview">
              <MarkdownRenderer :content="mermaidPreview" />
            </div>
          </div>
          <div class="revise-modal__actions">
            <button
              class="btn"
              @click="mermaidEdit = null"
            >
              取消
            </button>
            <button
              class="btn btn--primary"
              @click="saveMermaidEdit"
            >
              保存
            </button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- AI 对话优化课件 -->
    <LessonChatPanel
      v-if="chatOpen && lessonStore.lesson"
      :lesson-id="lessonStore.lesson.id"
      :quote-request="quoteRequest"
      @updated="reloadLesson"
      @close="chatOpen = false"
    />
  </div>
</template>

<style scoped>
.lesson-view {
  max-width: 880px;
  margin: 0 auto;
  padding: 24px 32px 80px;
  transition:
    padding-right 0.2s,
    max-width 0.2s;
}
/* 对话面板打开时容器同步加宽，正文列保持原宽度（只加 padding 会把正文挤扁） */
.lesson-view--chat {
  max-width: 1340px;
  padding-right: 452px;
}
.progress__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}
.progress__head h1 {
  margin: 0;
  font-size: 22px;
}
.progress__sub {
  margin: 6px 0 0;
  font-size: 13px;
  color: var(--text-dim);
}
.progress__bar {
  margin-top: 20px;
  height: 8px;
  border-radius: var(--r-pill);
  background: var(--bg-muted);
  overflow: hidden;
}
.progress__bar-fill {
  display: block;
  height: 100%;
  border-radius: var(--r-pill);
  background: linear-gradient(90deg, var(--primary), var(--mastery-green));
  transition: width 0.4s ease;
}
.progress__meta {
  margin-top: 8px;
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  color: var(--text-dim);
}
.progress__phase {
  color: var(--primary-strong);
  font-weight: 600;
}
.progress__steps {
  list-style: none;
  margin: 18px 0 0;
  padding: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.progress__steps li {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-size: 12px;
  color: var(--text-dim);
  padding: 5px 12px 5px 6px;
  border: 1px solid var(--border);
  border-radius: var(--r-pill);
  background: #fff;
}
.progress__steps li.is-done {
  color: var(--green-hover);
  border-color: var(--green-border);
  background: var(--green-bg);
}
.progress__steps li.is-active {
  color: var(--primary-hover);
  border-color: var(--primary-soft);
  background: var(--primary-bg);
  font-weight: 600;
}
.progress__dot {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--border);
  color: #fff;
  font-size: 11px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
}
.progress__steps li.is-done .progress__dot {
  background: var(--mastery-green);
}
.progress__steps li.is-active .progress__dot {
  background: var(--primary);
  animation: progress-pulse 1.1s ease-in-out infinite;
}
@keyframes progress-pulse {
  0%,
  100% {
    opacity: 1;
    transform: scale(1);
  }
  50% {
    opacity: 0.5;
    transform: scale(0.78);
  }
}
.progress__hint {
  margin-top: 16px;
  color: var(--text-dim);
  font-size: 13px;
  line-height: 1.7;
}
.progress__log {
  margin-top: 14px;
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  background: var(--bg-subtle);
  font-size: 13px;
}
.progress__log summary {
  cursor: pointer;
  padding: 9px 14px;
  color: var(--text-dim);
  user-select: none;
}
.progress__log-list {
  margin: 0;
  padding: 0 16px 12px 36px;
  line-height: 1.9;
  max-height: 200px;
  overflow-y: auto;
  color: var(--text-dim);
}
.progress__stream {
  margin-top: 22px;
  border-top: 1px dashed var(--border);
  padding-top: 16px;
  opacity: 0.92;
}
.progress__stream-title {
  font-size: 12px;
  color: var(--text-dim);
  margin-bottom: 8px;
}
.lesson__done-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 16px;
  padding: 12px 16px;
  border-radius: var(--r-md);
  background: var(--green-bg);
  border: 1px solid var(--green-border);
  color: var(--green-hover);
  font-size: 14px;
  font-weight: 600;
}
.lesson__done-text {
  display: inline-flex;
  align-items: center;
  gap: 7px;
}
.lesson__done-close {
  display: inline-flex;
  align-items: center;
  border: none;
  background: none;
  color: var(--green-hover);
  cursor: pointer;
  padding: 2px;
  border-radius: var(--r-sm);
}
.lesson__done-close:hover {
  background: var(--green-border);
}
.lesson__crumb {
  display: flex;
  gap: 10px;
  font-size: 13px;
  color: var(--text-dim);
  margin-bottom: 8px;
}
.lesson__crumb a {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  color: var(--primary-strong);
  text-decoration: none;
}
.lesson__reason {
  font-size: 13px;
  color: var(--text-secondary);
  background: var(--primary-bg);
  border-left: 3px solid var(--primary);
  padding: 10px 14px;
  border-radius: 0 var(--r-sm) var(--r-sm) 0;
}
.lesson__actions {
  margin-top: 12px;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
}
.lesson__revised {
  font-size: 12px;
  color: var(--text-dim);
}
.lesson__op-error {
  margin: 8px 0 0;
  font-size: 13px;
  color: var(--mastery-red);
}
.editor {
  display: flex;
  gap: 16px;
  align-items: stretch;
}
.editor__ta {
  flex: 1;
  min-height: 70vh;
  font-family: 'SF Mono', Menlo, monospace;
  font-size: 13px;
  line-height: 1.7;
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  resize: vertical;
  tab-size: 2;
}
.editor__preview {
  flex: 1;
  min-width: 0;
  padding: 0 12px;
  border-left: 1px solid var(--border);
  overflow-x: hidden;
}
.mermaid-modal {
  width: min(920px, 92vw);
  background: var(--bg);
  border-radius: var(--r-lg);
  padding: 22px 24px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  box-shadow: var(--shadow-xl);
}
.mermaid-modal h3 {
  margin: 0;
  font-size: 16px;
}
.mermaid-modal__panes {
  display: flex;
  gap: 14px;
}
.mermaid-modal__ta {
  flex: 1;
  min-height: 320px;
  font-family: 'SF Mono', Menlo, monospace;
  font-size: 13px;
  line-height: 1.7;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  resize: vertical;
}
.mermaid-modal__preview {
  flex: 1;
  min-width: 0;
  max-height: 320px;
  overflow: auto;
  padding: 10px;
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  background: var(--bg-subtle);
}
.revise-modal {
  width: 520px;
  background: var(--bg);
  border-radius: var(--r-lg);
  padding: 22px 24px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  box-shadow: var(--shadow-xl);
}
.revise-modal h3 {
  margin: 0;
  font-size: 16px;
}
.revise-modal__hint {
  margin: 0;
  font-size: 13px;
  color: var(--text-dim);
  line-height: 1.7;
}
.revise-modal textarea {
  font: inherit;
  font-size: 14px;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  resize: vertical;
}
.revise-modal__actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
.lesson__sources {
  margin-top: 40px;
  padding-top: 16px;
  border-top: 1px solid var(--border);
  font-size: 13px;
}
.lesson__sources h2 {
  font-size: 15px;
}
.lesson__sources li {
  margin: 4px 0;
  color: var(--text-dim);
}
.lesson__sources a {
  color: var(--primary-strong);
}
.lesson__footer {
  margin-top: 32px;
  text-align: center;
}
.state {
  text-align: center;
  padding: 60px 0;
}
.state__error {
  color: var(--mastery-red);
}
.state__actions {
  margin-top: 16px;
  display: flex;
  justify-content: center;
  gap: 10px;
}
</style>
