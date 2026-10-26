import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from './stores/auth'

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/login',
      name: 'login',
      component: () => import('./views/LoginView.vue'),
      meta: { public: true },
    },
    {
      path: '/register',
      name: 'register',
      component: () => import('./views/RegisterView.vue'),
      meta: { public: true },
    },
    {
      path: '/change-password',
      name: 'change-password',
      component: () => import('./views/ChangePasswordView.vue'),
    },
    {
      path: '/terms',
      name: 'terms',
      component: () => import('./views/LegalView.vue'),
      props: { kind: 'terms' },
      meta: { public: true },
    },
    {
      path: '/privacy',
      name: 'privacy',
      component: () => import('./views/LegalView.vue'),
      props: { kind: 'privacy' },
      meta: { public: true },
    },
    {
      path: '/admin',
      name: 'admin',
      component: () => import('./views/AdminView.vue'),
      meta: { admin: true },
    },
    { path: '/', name: 'home', component: () => import('./views/HomeView.vue') },
    {
      path: '/preferences',
      name: 'preferences',
      component: () => import('./views/PreferencesView.vue'),
    },
    { path: '/topic/:id', name: 'graph', component: () => import('./views/GraphView.vue') },
    { path: '/lesson/:id', name: 'lesson', component: () => import('./views/LessonView.vue') },
    {
      path: '/lesson/:id/exercise',
      name: 'exercise',
      component: () => import('./views/ExerciseView.vue'),
    },
  ],
})

router.beforeEach(async (to) => {
  const auth = useAuthStore()
  if (!auth.loaded) await auth.load()

  if (to.meta.public === true) {
    if (auth.user && (to.name === 'login' || to.name === 'register')) return { path: '/' }
    return true
  }
  if (!auth.user) {
    return { path: '/login', query: { next: to.fullPath } }
  }
  if (auth.user.mustChangePassword && to.name !== 'change-password') {
    return { path: '/change-password' }
  }
  if (to.meta.admin === true && auth.user.role !== 'admin') {
    return { path: '/' }
  }
  return true
})