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

const isNew = computed(() => route.params.id === 'new')
const nodeName = computed(() => {
  const lesson = lessonStore.lesson
  if (!lesson || !topicStore.graph) return ''
  const node = topicStore.graph.nodes.find((n) => n.id === lesson.nodeIds[0])
  return node?.name ?? lesson.nodeIds[0]
})

// 备课进行中自动滚动进度列表
watch(
  () => lessonStore.stages.length,
  async () => {
    await nextTick()
    stageList.value?.scrollTo({ top: stageList.value.scrollHeight })
  },
)

onMounted(async () => {
  if (isNew.value) {
    lessonStore.reset()
    if (!topicStore.topic) await topicStore.loadFirstTopic()
    if (!topicStore.topic) {
      lessonStore.error = '还没有课题，请先在图谱页创建'
      return
    }
    await lessonStore.generate(topicStore.topic.id)
    if (lessonStore.lesson) {
      await router.replace(`/lesson/${lessonStore.lesson.id}`)
    }
  } else {
    await lessonStore.load(String(route.params.id))
    if (!topicStore.graph) await topicStore.loadFirstTopic()
  }
})
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

    <!-- 出错 -->
    <div
      v-else-if="lessonStore.error"
      class="state"
    >
      <h1>备课失败</h1>
      <p class="state__error">
        {{ lessonStore.error }}
      </p>
      <RouterLink
        to="/"
        class="btn"
      >
        返回图谱
      </RouterLink>
    </div>

    <!-- 课程正文 -->
    <article
      v-else-if="lessonStore.lesson"
      class="lesson"
    >
      <header class="lesson__header">
        <div class="lesson__crumb">
          <RouterLink to="/">
            ← 知识图谱
          </RouterLink>
          <span>{{ lessonStore.topic?.name }}</span>
        </div>
        <h1>{{ nodeName }}</h1>
        <p class="lesson__reason">
          为什么这节课讲这个：{{ lessonStore.lesson.scheduleReason }}
        </p>
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
</style>
