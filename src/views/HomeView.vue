<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useTopicStore } from '@/stores/topic'

const store = useTopicStore()
const router = useRouter()

const topicName = ref('')
const creating = ref(false)

onMounted(async () => {
  await store.fetchTopics()
})

async function createTopic() {
  const name = topicName.value.trim()
  if (!name || creating.value) return
  creating.value = true
  try {
    const topic = await store.createTopic(name)
    if (topic) await router.push(`/topic/${topic.id}`)
  } finally {
    creating.value = false
  }
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('zh-CN')
}
</script>

<template>
  <div class="home">
    <section class="home__create">
      <h1>我的学习方向</h1>
      <form
        class="create-form"
        @submit.prevent="createTopic"
      >
        <input
          v-model="topicName"
          type="text"
          placeholder="输入新学习方向，如：CTR/CVR 预估模型"
          :disabled="creating"
        >
        <button
          class="btn btn--primary"
          type="submit"
          :disabled="creating || !topicName.trim()"
        >
          {{ creating ? 'AI 调研生成中…' : '开启新方向' }}
        </button>
      </form>
      <p
        v-if="store.stageText"
        class="create-form__stage"
      >
        {{ store.stageText }}
      </p>
      <p
        v-if="store.error"
        class="create-form__error"
      >
        {{ store.error }}
      </p>
    </section>

    <section class="home__list">
      <RouterLink
        v-for="t in store.topics"
        :key="t.id"
        :to="`/topic/${t.id}`"
        class="topic-card"
      >
        <div class="topic-card__name">
          {{ t.name }}
        </div>
        <div class="topic-card__meta">
          创建于 {{ fmtDate(t.createdAt) }}
        </div>
      </RouterLink>
      <p
        v-if="!store.loading && store.topics.length === 0"
        class="home__empty"
      >
        还没有学习方向，先开启第一个吧
      </p>
    </section>
  </div>
</template>

<style scoped>
.home {
  max-width: 720px;
  margin: 0 auto;
  padding: 40px 24px;
}
.home__create h1 {
  font-size: 22px;
}
.create-form {
  display: flex;
  gap: 8px;
  margin-top: 16px;
}
.create-form input {
  flex: 1;
  font: inherit;
  padding: 9px 14px;
  border: 1px solid var(--border);
  border-radius: 8px;
}
.create-form__stage {
  margin-top: 10px;
  color: #3b82f6;
  font-size: 14px;
}
.create-form__error {
  margin-top: 10px;
  color: var(--mastery-red);
  font-size: 14px;
}
.home__list {
  margin-top: 32px;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 12px;
}
.topic-card {
  display: block;
  padding: 16px 18px;
  border: 1px solid var(--border);
  border-radius: 12px;
  text-decoration: none;
  transition:
    border-color 0.15s,
    box-shadow 0.15s;
}
.topic-card:hover {
  border-color: #3b82f6;
  box-shadow: 0 2px 10px rgb(59 130 246 / 12%);
}
.topic-card__name {
  font-size: 15px;
  font-weight: 600;
  color: var(--text);
}
.topic-card__meta {
  margin-top: 6px;
  font-size: 12px;
  color: var(--text-dim);
}
.home__empty {
  color: var(--text-dim);
  font-size: 14px;
}
.btn {
  font: inherit;
  padding: 8px 18px;
  border-radius: 8px;
  border: 1px solid var(--border);
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
