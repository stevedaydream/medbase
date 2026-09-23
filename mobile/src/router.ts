import { createRouter, createWebHistory } from 'vue-router'
import { session } from './lib/session'

const router = createRouter({
  history: createWebHistory(),
  scrollBehavior: () => ({ top: 0 }),
  routes: [
    { path: '/login',    component: () => import('./views/LoginView.vue'), meta: { public: true } },
    { path: '/',         component: () => import('./views/HomeView.vue') },
    { path: '/sets',     component: () => import('./views/SetsView.vue') },
    { path: '/sets/:kind/:id', component: () => import('./views/SetDetailView.vue') },
    { path: '/contacts', component: () => import('./views/ContactsView.vue') },
    { path: '/schedule', component: () => import('./views/ScheduleView.vue') },
    { path: '/more',     component: () => import('./views/MoreView.vue') },
    { path: '/items',    component: () => import('./views/ItemsView.vue') },
    { path: '/memos',    component: () => import('./views/MemosView.vue') },
    { path: '/memos/:id', component: () => import('./views/MemoDetailView.vue') },
    { path: '/tools',    component: () => import('./views/ToolsView.vue') },
    { path: '/docs',     component: () => import('./views/DocsView.vue') },
    { path: '/research', component: () => import('./views/ResearchView.vue') },
    { path: '/research/:id', component: () => import('./views/ResearchProjectView.vue') },
    { path: '/settings', component: () => import('./views/SettingsView.vue') },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
})

router.beforeEach(to => {
  if (!to.meta.public && !session.user) return { path: '/login', query: to.fullPath !== '/' ? { next: to.fullPath } : {} }
  if (to.path === '/login' && session.user) return '/'
})

export default router
