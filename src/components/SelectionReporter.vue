<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { submitReport } from '@/utils/report'

// 划词报错：在课程内容（.md-body）中选中文本后浮出"这里有错"按钮
const props = defineProps<{
  lessonId: string
  nodeId: string
  scopeSelector?: string
}>()

const popVisible = ref(false)
const formVisible = ref(false)
const quote = ref('')
const note = ref('')
const pos = ref({ x: 0, y: 0 })
const toast = ref<string | null>(null)
const submitting = ref(false)

function onMouseUp(e: MouseEvent) {
  setTimeout(() => {
    const sel = window.getSelection()
    const text = sel?.toString().trim() ?? ''
    const anchorEl =
      sel && sel.anchorNode
        ? sel.anchorNode instanceof HTMLElement
          ? sel.anchorNode
          : sel.anchorNode.parentElement
        : null
    const inScope = anchorEl?.closest(props.scopeSelector ?? '.md-body')
    if (!text || text.length < 4 || !inScope) {
      popVisible.value = false
      return
    }
    quote.value = text.slice(0, 300)
    pos.value = { x: e.clientX, y: e.clientY }
    popVisible.value = true
    formVisible.value = false
  }, 0)
}

onMounted(() => document.addEventListener('mouseup', onMouseUp))
onUnmounted(() => document.removeEventListener('mouseup', onMouseUp))

function openForm() {
  popVisible.value = false
  formVisible.value = true
}

async function submit() {
  if (submitting.value) return
  submitting.value = true
  try {
    await submitReport({
      lessonId: props.lessonId,
      nodeId: props.nodeId,
      quote: quote.value,
      note: note.value.trim() || undefined,
    })
    formVisible.value = false
    note.value = ''
    toast.value = '已记录，同知识点后续备课会避开这个坑'
    window.getSelection()?.removeAllRanges()
    setTimeout(() => (toast.value = null), 3000)
  } catch (err) {
    toast.value = err instanceof Error ? err.message : String(err)
    setTimeout(() => (toast.value = null), 4000)
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <Teleport to="body">
    <button
      v-if="popVisible"
      class="report-pop"
      :style="{ left: `${pos.x}px`, top: `${pos.y - 40}px` }"
      @click="openForm"
    >
      ⚠ 这里有错
    </button>

    <div
      v-if="formVisible"
      class="report-mask"
      @click.self="formVisible = false"
    >
      <div class="report-form">
        <h3>标记内容错误</h3>
        <blockquote>{{ quote }}</blockquote>
        <textarea
          v-model="note"
          rows="3"
          placeholder="备注（可选）：哪里错了？正确应该是什么？"
        />
        <div class="report-form__actions">
          <button
            class="btn"
            @click="formVisible = false"
          >
            取消
          </button>
          <button
            class="btn btn--primary"
            :disabled="submitting"
            @click="submit"
          >
            {{ submitting ? '提交中…' : '提交报错' }}
          </button>
        </div>
      </div>
    </div>

    <div
      v-if="toast"
      class="report-toast"
    >
      {{ toast }}
    </div>
  </Teleport>
</template>

<style scoped>
.report-pop {
  position: fixed;
  z-index: 100;
  transform: translateX(-50%);
  font: inherit;
  font-size: 12px;
  padding: 4px 10px;
  border-radius: 6px;
  border: 1px solid #f59e0b;
  background: #fffbeb;
  color: #b45309;
  cursor: pointer;
  box-shadow: 0 2px 8px rgb(0 0 0 / 15%);
}
.report-mask {
  position: fixed;
  inset: 0;
  z-index: 200;
  background: rgb(0 0 0 / 30%);
  display: flex;
  align-items: center;
  justify-content: center;
}
.report-form {
  width: 480px;
  background: #fff;
  border-radius: 12px;
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.report-form h3 {
  margin: 0;
  font-size: 16px;
}
.report-form blockquote {
  margin: 0;
  padding: 8px 12px;
  border-left: 3px solid #f59e0b;
  background: #fffbeb;
  font-size: 13px;
  color: var(--text-dim);
  max-height: 100px;
  overflow-y: auto;
}
.report-form textarea {
  font: inherit;
  font-size: 14px;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
}
.report-form__actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
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
.btn {
  font: inherit;
  font-size: 13px;
  padding: 6px 14px;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: #fff;
  cursor: pointer;
}
.btn--primary {
  background: #3b82f6;
  border-color: #3b82f6;
  color: #fff;
}
</style>
