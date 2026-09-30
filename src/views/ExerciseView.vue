<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { useLessonStore } from '@/stores/lesson'
import MarkdownRenderer from '@/components/MarkdownRenderer.vue'
import { submitReport } from '@/utils/report'
import type { SubmitResult } from '@shared/api'
import type { Question } from '@shared/types'

const route = useRoute()
const lessonStore = useLessonStore()
const lessonId = computed(() => String(route.params.id))

const answers = ref<Record<string, string>>({})
const submitting = ref(false)
const result = ref<SubmitResult | null>(null)
const error = ref<string | null>(null)

const questions = computed(() => lessonStore.questions)
const graded = computed(() => result.value !== null)

const allAnswered = computed(
  () => questions.value.length > 0 && questions.value.every((q) => (answers.value[q.id] ?? '').trim() !== ''),
)

onMounted(async () => {
  await lessonStore.load(lessonId.value)
})

function typeLabel(q: Question): string {
  return q.type === 'single' ? '单选' : q.type === 'judge' ? '判断' : '简答'
}

function pick(q: Question, value: string) {
  if (graded.value) return
  answers.value = { ...answers.value, [q.id]: value }
}

function resultOf(qid: string) {
  return result.value?.results[qid]
}

// 题目报错："这里有错"入口
const reportingQid = ref<string | null>(null)
const reportNote = ref('')
const reportToast = ref<string | null>(null)

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
      }),
    })
    const data = (await res.json()) as SubmitResult & { error?: string }
    if (!res.ok) throw new Error(data.error ?? `交卷失败：${res.status}`)
    result.value = data
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="exercise-view">
    <div class="crumb">
      <RouterLink to="/">
        ← 知识图谱
      </RouterLink>
      <RouterLink :to="`/lesson/${lessonId}`">
        返回课程
      </RouterLink>
    </div>
    <h1>随堂练习</h1>
    <p
      v-if="!graded"
      class="hint"
    >
      共 {{ questions.length }} 题：客观题提交即判，简答题由 AI 批改（约 20 秒）。全部作答后交卷。
    </p>

    <div
      v-for="(q, qi) in questions"
      :key="q.id"
      class="question"
    >
      <div class="question__head">
        <span class="question__no">第 {{ qi + 1 }} 题</span>
        <span class="question__type">{{ typeLabel(q) }}</span>
        <span
          v-if="graded"
          class="question__verdict"
          :class="
            resultOf(q.id)?.correct === true || (resultOf(q.id)?.score ?? 0) >= 0.6
              ? 'question__verdict--ok'
              : 'question__verdict--bad'
          "
        >
          <template v-if="q.type === 'short'">得分 {{ ((resultOf(q.id)?.score ?? 0) * 10).toFixed(0) }}/10</template>
          <template v-else>{{ resultOf(q.id)?.correct ? '✓ 答对' : '✗ 答错' }}</template>
        </span>
        <button
          class="question__report"
          @click="
            reportingQid = reportingQid === q.id ? null : q.id
            reportNote = ''
          "
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
            :disabled="graded"
            @change="pick(q, 'ABCD'[oi])"
          >
          <span class="option__letter">{{ 'ABCD'[oi] }}</span>
          <MarkdownRenderer :content="opt" />
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
            :disabled="graded"
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
        :disabled="graded"
        @input="pick(q, ($event.target as HTMLTextAreaElement).value)"
      />

      <!-- 批改反馈 -->
      <div
        v-if="graded && result"
        class="feedback"
      >
        <p
          v-if="resultOf(q.id)?.feedback"
          class="feedback__comment"
        >
          <strong>批改评语：</strong>{{ resultOf(q.id)?.feedback }}
        </p>
        <p v-if="result.revealed[q.id]?.answer">
          <strong>正确答案：</strong>{{ result.revealed[q.id]?.answer }}
        </p>
        <div v-if="result.revealed[q.id]?.referenceAnswer">
          <strong>参考答案：</strong>
          <MarkdownRenderer :content="result.revealed[q.id].referenceAnswer!" />
        </div>
        <div v-if="result.revealed[q.id]?.explanation">
          <strong>讲解：</strong>
          <MarkdownRenderer :content="result.revealed[q.id].explanation!" />
        </div>
      </div>
    </div>

    <!-- 掌握分变化 -->
    <section
      v-if="graded && result"
      class="mastery"
    >
      <h2>掌握分变化</h2>
      <ul>
        <li
          v-for="c in result.masteryChanges"
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
      <div class="mastery__actions">
        <RouterLink
          to="/"
          class="btn"
        >
          查看图谱变化
        </RouterLink>
        <RouterLink
          to="/lesson/new"
          class="btn btn--primary"
        >
          开始下一课 →
        </RouterLink>
      </div>
    </section>

    <footer
      v-if="!graded"
      class="submit-bar"
    >
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
.option--on {
  border-color: #3b82f6;
  background: #eff6ff;
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
