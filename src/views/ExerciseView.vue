<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { useLessonStore } from '@/stores/lesson'
import MarkdownRenderer from '@/components/MarkdownRenderer.vue'
import { submitReport } from '@/utils/report'
import { MASTERY_UNLOCK_THRESHOLD } from '@shared/types'
import type { AnswerRecord, Attempt, Question } from '@shared/types'

const route = useRoute()
const lessonStore = useLessonStore()
const lessonId = computed(() => String(route.params.id))

const mode = ref<'answer' | 'review'>('answer')
const activeIdx = ref(0)
const answers = ref<Record<string, string>>({})
const submitting = ref(false)
const regenerating = ref(false)
const error = ref<string | null>(null)

const questions = computed(() => lessonStore.questions)
const attempts = computed(() => lessonStore.attempts)
const activeAttempt = computed<Attempt | null>(() => attempts.value[activeIdx.value] ?? null)
const notReady = computed(
  () => !!lessonStore.lesson && lessonStore.lesson.status !== 'generated',
)

const allAnswered = computed(
  () => questions.value.length > 0 && questions.value.every((q) => (answers.value[q.id] ?? '').trim() !== ''),
)

// 回看条目：题目快照（含答案讲解）+ 当次作答记录；无快照时只能用判分记录降级展示
interface ReviewItem {
  q: Question
  record?: AnswerRecord
}
const hasSnapshot = computed(() => (activeAttempt.value?.questions.length ?? 0) > 0)
const reviewItems = computed<ReviewItem[]>(() => {
  const a = activeAttempt.value
  if (!a) return []
  return a.questions.map((q) => ({ q, record: a.records.find((r) => r.questionId === q.id) }))
})

onMounted(async () => {
  await lessonStore.load(lessonId.value)
  await lessonStore.loadAttempts(lessonId.value)
  if (attempts.value.length > 0) {
    activeIdx.value = attempts.value.length - 1
    mode.value = 'review'
  }
})

function typeLabel(q: Question): string {
  return q.type === 'single' ? '单选' : q.type === 'judge' ? '判断' : '简答'
}

// LLM 有时会在选项文本里自带「A. 」前缀，与字母标注重复，渲染时剥离
function optText(opt: string, letter: string): string {
  return opt.replace(new RegExp(`^${letter}[.、．:：]\\s*`), '')
}

function pick(q: Question, value: string) {
  answers.value = { ...answers.value, [q.id]: value }
}

function onShortInput(q: Question, e: Event) {
  pick(q, (e.target as HTMLTextAreaElement).value)
}

function recordPassed(r?: AnswerRecord): boolean {
  if (!r?.result) return false
  return r.result.correct === true || (r.result.score ?? 0) >= 0.6
}

// 无题目快照的降级记录视图用：从判分结果推断题型展示
function recordVerdict(r: AnswerRecord): string {
  if (r.result?.score !== undefined) return `得分 ${(r.result.score * 10).toFixed(0)}/10`
  return r.result?.correct ? '✓ 答对' : '✗ 答错'
}

// 回看时高亮正确选项（绿色）：单选归一化到字母
function isRightOption(q: Question, value: string): boolean {
  if (!q.answer) return false
  if (q.type === 'single') return q.answer.trim().toUpperCase().startsWith(value)
  return q.answer.trim() === value
}

function fmtTime(iso: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getMonth() + 1}月${d.getDate()}日 ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function attemptSummary(a: Attempt): string {
  const passed = a.records.filter((r) => recordPassed(r)).length
  return `达标 ${passed}/${a.records.length}`
}

// 未解锁知识点的差距提示：让用户知道还差多少、怎么补
const unlockHints = computed(() =>
  (activeAttempt.value?.masteryChanges ?? [])
    .filter((c) => c.after < MASTERY_UNLOCK_THRESHOLD)
    .map((c) => ({ nodeName: c.nodeName, gap: MASTERY_UNLOCK_THRESHOLD - c.after })),
)

async function retake() {
  if (regenerating.value) return
  regenerating.value = true
  error.value = null
  try {
    const ok = await lessonStore.regenerate(lessonId.value)
    if (!ok) {
      error.value = lessonStore.error ?? '出题失败，请重试'
      return
    }
    answers.value = {}
    mode.value = 'answer'
  } finally {
    regenerating.value = false
  }
}

function backToReview() {
  activeIdx.value = attempts.value.length - 1
  mode.value = 'review'
}

async function submit() {
  if (!allAnswered.value || submitting.value) return
  submitting.value = true
  error.value = null
  try {
    const res = await fetch(`/api/lessons/${lessonId.value}/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        answers: questions.value.map((q) => ({ questionId: q.id, userAnswer: answers.value[q.id] ?? '' })),
        generatedAt: lessonStore.questionsGeneratedAt,
      }),
    })
    const data = (await res.json()) as { error?: string }
    if (!res.ok) throw new Error(data.error ?? `交卷失败：${res.status}`)
    await lessonStore.loadAttempts(lessonId.value)
    activeIdx.value = attempts.value.length - 1
    mode.value = 'review'
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    submitting.value = false
  }
}

// 题目报错："这里有错"入口
const reportingQid = ref<string | null>(null)
const reportNote = ref('')
const reportToast = ref<string | null>(null)

function toggleReport(qid: string) {
  reportingQid.value = reportingQid.value === qid ? null : qid
  reportNote.value = ''
}

async function submitQuestionReport(q: Question) {
  try {
    await submitReport({
      lessonId: lessonId.value,
      questionId: q.id,
      nodeId: q.nodeId,
      quote: q.prompt.replace(/\s+/g, ' ').slice(0, 300),
      note: reportNote.value.trim() || undefined,
    })
    reportingQid.value = null
    reportNote.value = ''
    reportToast.value = '已记录，同知识点后续出题会避开这个坑'
    setTimeout(() => (reportToast.value = null), 3000)
  } catch (err) {
    reportToast.value = err instanceof Error ? err.message : String(err)
    setTimeout(() => (reportToast.value = null), 4000)
  }
}
</script>

<template>
  <div class="exercise-view">
    <div class="crumb">
      <RouterLink :to="lessonStore.lesson?.topicId ? `/topic/${lessonStore.lesson.topicId}` : '/'">
        ← 知识图谱
      </RouterLink>
      <RouterLink :to="`/lesson/${lessonId}`">
        返回课程
      </RouterLink>
    </div>
    <h1>随堂练习</h1>

    <div
      v-if="notReady"
      class="not-ready"
    >
      课程尚未生成完成（{{ lessonStore.lesson?.status === 'failed' ? '上次备课失败' : '正在备课中' }}），
      <RouterLink :to="`/lesson/${lessonId}`">
        返回课程页查看
      </RouterLink>
    </div>

    <template v-else>
      <!-- 答题记录模式 -->
      <template v-if="mode === 'review' && activeAttempt">
        <div class="attempts-bar">
          <button
            v-for="(a, i) in attempts"
            :key="a.id"
            class="attempt-pill"
            :class="{ 'attempt-pill--on': i === activeIdx }"
            @click="activeIdx = i"
          >
            第 {{ i + 1 }} 次 · {{ attemptSummary(a) }}
            <span class="attempt-pill__time">{{ fmtTime(a.createdAt) }}</span>
          </button>
        </div>
        <p
          v-if="hasSnapshot"
          class="hint"
        >
          蓝色为你的选择，绿色为正确答案
        </p>

        <!-- 无题目快照（旧记录且题集已换新）：降级为判分记录列表 -->
        <template v-if="!hasSnapshot">
          <p class="hint">
            该次测验的题目已被「再次测验」换新，原题无法回看，仅保留作答与判分记录。
          </p>
          <div
            v-for="(r, ri) in activeAttempt.records"
            :key="r.questionId"
            class="question"
          >
            <div class="question__head">
              <span class="question__no">第 {{ ri + 1 }} 题</span>
              <span
                class="question__verdict"
                :class="recordPassed(r) ? 'question__verdict--ok' : 'question__verdict--bad'"
              >
                {{ recordVerdict(r) }}
              </span>
            </div>
            <p class="legacy-answer">
              <strong>我的作答：</strong>
            </p>
            <p class="legacy-answer__text">
              {{ r.userAnswer }}
            </p>
            <div
              v-if="r.result?.feedback"
              class="feedback"
            >
              <p class="feedback__comment">
                <strong>批改评语：</strong>{{ r.result.feedback }}
              </p>
            </div>
          </div>
        </template>

        <template v-else>
          <div
            v-for="(item, qi) in reviewItems"
            :key="item.q.id"
            class="question"
          >
            <div class="question__head">
              <span class="question__no">第 {{ qi + 1 }} 题</span>
              <span class="question__type">{{ typeLabel(item.q) }}</span>
              <span
                class="question__verdict"
                :class="recordPassed(item.record) ? 'question__verdict--ok' : 'question__verdict--bad'"
              >
                <template v-if="item.q.type === 'short'">得分 {{ ((item.record?.result?.score ?? 0) * 10).toFixed(0) }}/10</template>
                <template v-else>{{ item.record?.result?.correct ? '✓ 答对' : '✗ 答错' }}</template>
              </span>
              <button
                class="question__report"
                @click="toggleReport(item.q.id)"
              >
                ⚠ 这里有错
              </button>
            </div>

            <div
              v-if="reportingQid === item.q.id"
              class="report-inline"
            >
              <textarea
                v-model="reportNote"
                rows="2"
                placeholder="备注（可选）：题目哪里有问题？"
              />
              <button
                class="btn btn--small"
                @click="submitQuestionReport(item.q)"
              >
                提交报错
              </button>
            </div>

            <MarkdownRenderer :content="item.q.prompt" />

            <!-- 单选（只读回看） -->
            <div
              v-if="item.q.type === 'single' && item.q.options"
              class="options"
            >
              <label
                v-for="(opt, oi) in item.q.options"
                :key="oi"
                class="option"
                :class="{
                  'option--on': item.record?.userAnswer === 'ABCD'[oi],
                  'option--right': isRightOption(item.q, 'ABCD'[oi]),
                }"
              >
                <input
                  type="radio"
                  :name="`review-${activeAttempt.id}-${item.q.id}`"
                  :checked="item.record?.userAnswer === 'ABCD'[oi]"
                  disabled
                >
                <span class="option__letter">{{ 'ABCD'[oi] }}</span>
                <MarkdownRenderer :content="optText(opt, 'ABCD'[oi])" />
              </label>
            </div>

            <!-- 判断（只读回看） -->
            <div
              v-else-if="item.q.type === 'judge'"
              class="options"
            >
              <label
                v-for="v in ['对', '错']"
                :key="v"
                class="option"
                :class="{
                  'option--on': item.record?.userAnswer === v,
                  'option--right': isRightOption(item.q, v),
                }"
              >
                <input
                  type="radio"
                  :name="`review-${activeAttempt.id}-${item.q.id}`"
                  :checked="item.record?.userAnswer === v"
                  disabled
                >
                {{ v }}
              </label>
            </div>

            <!-- 简答（只读回看） -->
            <textarea
              v-else
              class="short-input"
              rows="5"
              :value="item.record?.userAnswer ?? ''"
              disabled
            />

            <div class="feedback">
              <p
                v-if="item.record?.result?.feedback"
                class="feedback__comment"
              >
                <strong>批改评语：</strong>{{ item.record.result.feedback }}
              </p>
              <p v-if="item.q.answer">
                <strong>正确答案：</strong>{{ item.q.answer }}
              </p>
              <div v-if="item.q.referenceAnswer">
                <strong>参考答案：</strong>
                <MarkdownRenderer :content="item.q.referenceAnswer" />
              </div>
              <div v-if="item.q.explanation">
                <strong>讲解：</strong>
                <MarkdownRenderer :content="item.q.explanation" />
              </div>
            </div>
          </div>
        </template>

        <section
          v-if="activeAttempt.masteryChanges.length > 0"
          class="mastery"
        >
          <h2>本次掌握分变化</h2>
          <ul>
            <li
              v-for="c in activeAttempt.masteryChanges"
              :key="c.nodeId"
            >
              <strong>{{ c.nodeName }}</strong>
              {{ c.before }} → {{ c.after }}
              <span
                class="mastery__delta"
                :class="c.delta >= 0 ? 'mastery__delta--up' : 'mastery__delta--down'"
              >
                ({{ c.delta >= 0 ? '+' : '' }}{{ c.delta }})
              </span>
              <span class="mastery__reason">因 {{ c.reason }}</span>
            </li>
          </ul>
          <p
            v-for="h in unlockHints"
            :key="h.nodeName"
            class="mastery__hint"
          >
            「{{ h.nodeName }}」距解锁（{{ MASTERY_UNLOCK_THRESHOLD }} 分）还差 {{ h.gap }} 分，可点下方「再次测验」继续提分
          </p>
        </section>

        <footer class="submit-bar">
          <p
            v-if="error"
            class="submit-bar__error"
          >
            {{ error }}
          </p>
          <div class="mastery__actions">
            <button
              class="btn btn--primary"
              :disabled="regenerating"
              @click="retake"
            >
              {{ regenerating ? 'AI 出题中…' : '再次测验（生成新题）' }}
            </button>
            <RouterLink
              to="/"
              class="btn"
            >
              查看图谱变化
            </RouterLink>
            <RouterLink
              to="/lesson/new"
              class="btn"
            >
              开始下一课 →
            </RouterLink>
          </div>
        </footer>
      </template>

      <!-- 作答模式 -->
      <template v-else>
        <p class="hint">
          共 {{ questions.length }} 题：客观题提交即判，简答题由 AI 批改（约 20 秒）。全部作答后交卷。
          <a
            v-if="attempts.length > 0"
            class="hint__history"
            href="javascript:void 0"
            @click="backToReview"
          >查看历史答题记录（{{ attempts.length }} 次）→</a>
        </p>

        <div
          v-for="(q, qi) in questions"
          :key="q.id"
          class="question"
        >
          <div class="question__head">
            <span class="question__no">第 {{ qi + 1 }} 题</span>
            <span class="question__type">{{ typeLabel(q) }}</span>
            <button
              class="question__report"
              @click="toggleReport(q.id)"
            >
              ⚠ 这里有错
            </button>
          </div>

          <div
            v-if="reportingQid === q.id"
            class="report-inline"
          >
            <textarea
              v-model="reportNote"
              rows="2"
              placeholder="备注（可选）：题目哪里有问题？"
            />
            <button
              class="btn btn--small"
              @click="submitQuestionReport(q)"
            >
              提交报错
            </button>
          </div>

          <MarkdownRenderer :content="q.prompt" />

          <!-- 单选 -->
          <div
            v-if="q.type === 'single' && q.options"
            class="options"
          >
            <label
              v-for="(opt, oi) in q.options"
              :key="oi"
              class="option"
              :class="{ 'option--on': answers[q.id] === 'ABCD'[oi] }"
            >
              <input
                type="radio"
                :name="q.id"
                :value="'ABCD'[oi]"
                :checked="answers[q.id] === 'ABCD'[oi]"
                @change="pick(q, 'ABCD'[oi])"
              >
              <span class="option__letter">{{ 'ABCD'[oi] }}</span>
              <MarkdownRenderer :content="optText(opt, 'ABCD'[oi])" />
            </label>
          </div>

          <!-- 判断 -->
          <div
            v-else-if="q.type === 'judge'"
            class="options"
          >
            <label
              v-for="v in ['对', '错']"
              :key="v"
              class="option"
              :class="{ 'option--on': answers[q.id] === v }"
            >
              <input
                type="radio"
                :name="q.id"
                :value="v"
                :checked="answers[q.id] === v"
                @change="pick(q, v)"
              >
              {{ v }}
            </label>
          </div>

          <!-- 简答 -->
          <textarea
            v-else
            class="short-input"
            rows="5"
            placeholder="写出你的推导/思路…"
            :value="answers[q.id] ?? ''"
            @input="onShortInput(q, $event)"
          />
        </div>

        <footer class="submit-bar">
          <p
            v-if="error"
            class="submit-bar__error"
          >
            {{ error }}
          </p>
          <button
            class="btn btn--primary"
            :disabled="!allAnswered || submitting"
            @click="submit"
          >
            {{ submitting ? '批改中…（简答题约 20 秒）' : '交卷' }}
          </button>
        </footer>
      </template>
    </template>

    <Teleport to="body">
      <div
        v-if="reportToast"
        class="report-toast"
      >
        {{ reportToast }}
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.exercise-view {
  max-width: 780px;
  margin: 0 auto;
  padding: 24px 32px 80px;
}
.crumb {
  display: flex;
  gap: 14px;
  font-size: 13px;
  margin-bottom: 8px;
}
.crumb a {
  color: #2563eb;
  text-decoration: none;
}
.hint {
  color: var(--text-dim);
  font-size: 13px;
}
.hint__history {
  color: #2563eb;
  text-decoration: none;
  margin-left: 8px;
}
.not-ready {
  padding: 14px 16px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: #fffbeb;
  color: #b45309;
  font-size: 14px;
}
.not-ready a {
  color: #1d4ed8;
}
.attempts-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin: 12px 0 4px;
}
.attempt-pill {
  font: inherit;
  font-size: 13px;
  padding: 6px 12px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: #fff;
  color: var(--text);
  cursor: pointer;
}
.attempt-pill--on {
  border-color: #3b82f6;
  background: #eff6ff;
}
.attempt-pill__time {
  color: var(--text-dim);
  margin-left: 4px;
  font-size: 12px;
}
.question {
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 18px 20px;
  margin: 16px 0;
}
.question__head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
}
.question__no {
  font-weight: 600;
}
.question__type {
  font-size: 12px;
  color: var(--text-dim);
  border: 1px solid var(--border);
  padding: 1px 8px;
  border-radius: 999px;
}
.question__verdict {
  margin-left: auto;
  font-weight: 600;
  font-size: 14px;
}
.question__verdict--ok {
  color: var(--mastery-green);
}
.question__verdict--bad {
  color: var(--mastery-red);
}
.question__report {
  margin-left: auto;
  font: inherit;
  font-size: 12px;
  color: #b45309;
  background: none;
  border: none;
  cursor: pointer;
  text-decoration: underline dotted;
}
.question__verdict + .question__report {
  margin-left: 12px;
}
.report-inline {
  display: flex;
  gap: 8px;
  align-items: flex-start;
  margin: 8px 0;
}
.report-inline textarea {
  flex: 1;
  font: inherit;
  font-size: 13px;
  padding: 6px 10px;
  border: 1px solid #f59e0b;
  border-radius: 8px;
  background: #fffbeb;
}
.btn--small {
  font-size: 12px;
  padding: 6px 10px;
}
.report-toast {
  position: fixed;
  bottom: 32px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 300;
  background: #1f2328;
  color: #fff;
  font-size: 13px;
  padding: 8px 16px;
  border-radius: 8px;
}
.options {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 10px;
}
.option {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 8px 12px;
  cursor: pointer;
  font-size: 14px;
}
.option:has(input:disabled) {
  cursor: default;
}
.option--on {
  border-color: #3b82f6;
  background: #eff6ff;
}
.option--right {
  border-color: var(--mastery-green);
  background: #f0fdf4;
}
.legacy-answer {
  margin: 4px 0 0;
  font-size: 14px;
}
.legacy-answer__text {
  margin: 4px 0 0;
  font-size: 14px;
  white-space: pre-wrap;
  color: var(--text-dim);
}
.option__letter {
  font-weight: 600;
}
.short-input {
  width: 100%;
  margin-top: 10px;
  font: inherit;
  font-size: 14px;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  resize: vertical;
}
.short-input:disabled {
  background: #f8fafc;
  color: var(--text);
}
.feedback {
  margin-top: 14px;
  padding: 12px 14px;
  background: #f8fafc;
  border-radius: 8px;
  font-size: 14px;
}
.feedback__comment {
  margin-top: 0;
}
.mastery {
  margin-top: 24px;
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 16px 20px;
}
.mastery h2 {
  font-size: 16px;
}
.mastery li {
  margin: 6px 0;
  font-size: 14px;
}
.mastery__delta--up {
  color: var(--mastery-green);
}
.mastery__delta--down {
  color: var(--mastery-red);
}
.mastery__reason {
  color: var(--text-dim);
  font-size: 13px;
  margin-left: 6px;
}
.mastery__hint {
  margin: 10px 0 0;
  font-size: 13px;
  color: #b45309;
}
.mastery__actions {
  margin-top: 14px;
  display: flex;
  gap: 10px;
  justify-content: center;
}
.submit-bar {
  margin-top: 20px;
  text-align: center;
}
.submit-bar__error {
  color: var(--mastery-red);
  font-size: 13px;
}
.btn {
  display: inline-block;
  font: inherit;
  padding: 8px 22px;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: #fff;
  color: var(--text);
  text-decoration: none;
  cursor: pointer;
}
.btn--primary {
  background: #3b82f6;
  border-color: #3b82f6;
  color: #fff;
}
.btn--primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
