import { createRouter, createWebHistory } from 'vue-router'

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'graph', component: () => import('./views/GraphView.vue') },
    { path: '/lesson/:id', name: 'lesson', component: () => import('./views/LessonView.vue') },
    {
      path: '/lesson/:id/exercise',
      name: 'exercise',
      component: () => import('./views/ExerciseView.vue'),
    },
  ],
})
