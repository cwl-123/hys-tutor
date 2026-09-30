<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useLessonStore } from '@/stores/lesson'
import { useTopicStore } from '@/stores/topic'
import MarkdownRenderer from '@/components/MarkdownRenderer.vue'
import SelectionReporter from '@/components/SelectionReporter.vue'

const route = useRoute()
const router = useRouter()
const lessonStore = useLessonStore()
const topicStore = useTopicStore()

const stageList = ref<HTMLElement | null>(null)
const reviseOpen = ref(false)
const reviseInstruction = ref('')

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

// 备课进行中自动滚动进度列表
watch(
  () => lessonStore.stages.length,
  async () => {
    await nextTick()
    stageList.value?.scrollTo({ top: stageList.value.scrollHeight })
  },
)

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
  if (lessonId) await router.replace(`/lesson/${lessonId}`)
}

onMounted(async () => {
  try {
    if (isNew.value) {
      await startGeneration()
    } else {
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
    if (lessonId && lessonId !== lesson.id) await router.replace(`/lesson/${lessonId}`)
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
</script>

<template>
  <div class="lesson-view">
    <!-- 备课中：阶段进度 + 流式正文 -->
    <div
      v-if="lessonStore.generating"
      class="progress"
    >
      <h1>正在备课…</h1>
      <p class="progress__hint">
        Agent 正在联网研究并撰写课程，全程约 2~5 分钟（缓存命中约 1 分钟）
      </p>
      <ol
        ref="stageList"
        class="progress__stages"
      >
        <li
          v-for="s in lessonStore.stages"
          :key="s.key"
        >
          {{ s.label }}
        </li>
      </ol>
      <div
        v-if="lessonStore.streamingContent"
        class="progress__stream"
      >
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
          返回图谱
        </RouterLink>
      </div>
    </div>

    <!-- 课程正文 -->
    <article
      v-else-if="lessonStore.lesson"
      class="lesson"
    >
      <header class="lesson__header">
        <div class="lesson__crumb">
          <RouterLink :to="topicHome">
            ← 知识图谱
          </RouterLink>
          <span>{{ lessonStore.topic?.name }}</span>
        </div>
        <h1>{{ nodeName }}</h1>
        <p class="lesson__reason">
          为什么这节课讲这个：{{ lessonStore.lesson.scheduleReason }}
        </p>
        <div class="lesson__actions">
          <button
            class="btn"
            :disabled="lessonStore.generating"
            @click="reviseOpen = true"
          >
            ✨ AI 优化本课
          </button>
          <span
            v-if="lessonStore.lesson.revisedAt"
            class="lesson__revised"
          >
            已于 {{ new Date(lessonStore.lesson.revisedAt).toLocaleString('zh-CN') }} 优化
          </span>
        </div>
      </header>

      <MarkdownRenderer :content="lessonStore.lesson.contentMd" />

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
          class="btn btn--primary"
        >
          去随堂练习（{{ lessonStore.questions.length }} 题）
        </RouterLink>
      </footer>

      <SelectionReporter
        :lesson-id="lessonStore.lesson.id"
        :node-id="lessonStore.lesson.nodeIds[0]"
      />
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
        class="revise-mask"
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
  </div>
</template>

<style scoped>
.lesson-view {
  max-width: 880px;
  margin: 0 auto;
  padding: 24px 32px 80px;
}
.progress__hint {
  color: var(--text-dim);
  font-size: 13px;
}
.progress__stages {
  margin: 16px 0;
  padding: 12px 16px 12px 36px;
  background: #f8fafc;
  border: 1px solid var(--border);
  border-radius: 10px;
  font-size: 13px;
  line-height: 1.9;
  max-height: 220px;
  overflow-y: auto;
}
.progress__stream {
  border-top: 1px dashed var(--border);
  padding-top: 16px;
  opacity: 0.9;
}
.lesson__crumb {
  display: flex;
  gap: 10px;
  font-size: 13px;
  color: var(--text-dim);
  margin-bottom: 8px;
}
.lesson__crumb a {
  color: #2563eb;
  text-decoration: none;
}
.lesson__reason {
  font-size: 13px;
  color: var(--text-dim);
  background: #f8fafc;
  border-left: 3px solid #3b82f6;
  padding: 8px 12px;
  border-radius: 0 6px 6px 0;
}
.lesson__actions {
  margin-top: 12px;
  display: flex;
  align-items: center;
  gap: 12px;
}
.lesson__revised {
  font-size: 12px;
  color: var(--text-dim);
}
.revise-mask {
  position: fixed;
  inset: 0;
  z-index: 200;
  background: rgb(15 23 42 / 35%);
  display: flex;
  align-items: center;
  justify-content: center;
}
.revise-modal {
  width: 520px;
  background: #fff;
  border-radius: 14px;
  padding: 22px 24px;
  display: flex;
  flex-direction: column;
  gap: 12px;
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
  border-radius: 8px;
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
  color: #2563eb;
}
.lesson__footer {
  margin-top: 32px;
  text-align: center;
}
.btn {
  display: inline-block;
  font: inherit;
  padding: 8px 20px;
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
