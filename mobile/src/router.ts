import { createRouter, createWebHistory } from 'vue-router'
import { session } from './lib/session'
import { routeAllowed } from './lib/access'

const router = createRouter({
  history: createWebHistory(),
  scrollBehavior: () => ({ top: 0 }),
  routes: [
    { path: '/login',    component: () => import('./views/LoginView.vue'), meta: { public: true } },
    { path: '/install',  component: () => import('./views/InstallView.vue'), meta: { public: true } },
    { path: '/',         component: () => import('./views/HomeView.vue') },
    { path: '/sets',     component: () => import('./views/SetsView.vue') },
    { path: '/sets/:kind/:id', component: () => import('./views/SetDetailView.vue') },
    { path: '/contacts', component: () => import('./views/ContactsView.vue') },
    { path: '/schedule', component: () => import('./views/ScheduleView.vue') },
    { path: '/care',      component: () => import('./views/CareView.vue') },
    { path: '/care/s/:uid', component: () => import('./views/SymptomView.vue') },
    { path: '/tool/:id',  component: () => import('./views/ToolView.vue') },
    { path: '/emergency', component: () => import('./views/EmergencyView.vue') },
    { path: '/handbook', component: () => import('./views/HandbookView.vue') },
    { path: '/more',     component: () => import('./views/MoreView.vue') },
    { path: '/items',    component: () => import('./views/ItemsView.vue') },
    { path: '/memos',    component: () => import('./views/MemosView.vue') },
    { path: '/memos/:id', component: () => import('./views/MemoDetailView.vue') },
    { path: '/tools',    component: () => import('./views/ToolsView.vue') },
    { path: '/docs',     component: () => import('./views/DocsView.vue') },
    { path: '/markdown', component: () => import('./views/MarkdownView.vue') },
    { path: '/research', component: () => import('./views/ResearchView.vue') },
    { path: '/research/:id', component: () => import('./views/ResearchProjectView.vue') },
    { path: '/settings', component: () => import('./views/SettingsView.vue') },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
})

router.beforeEach(to => {
  if (!to.meta.public && !session.user) return { path: '/login', query: to.fullPath !== '/' ? { next: to.fullPath } : {} }
  if (to.path === '/login' && session.user) return '/'
  // 沒有權限的功能（ADR-026）：導回首頁
  if (session.user && !routeAllowed(to.path)) return '/'
})

/**
 * 部署新版後，還開著的舊版 App 去載入舊檔名的頁面程式會失敗（Vercel 把不存在的檔案改回 index.html），
 * 點了沒反應、停在原畫面。遇到時整頁重新載入到目標頁，就會拿到新版。用 sessionStorage 防止無限重載
 */
const RELOAD_KEY = 'mb_chunk_reload'
function isChunkError(e: unknown): boolean {
  const msg = String((e as Error)?.message ?? e)
  return /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|MIME type/i.test(msg)
}
function reloadTo(path: string) {
  if (sessionStorage.getItem(RELOAD_KEY) === path) return // 已重載過仍失敗，不再重試
  sessionStorage.setItem(RELOAD_KEY, path)
  window.location.assign(path)
}
router.onError((e, to) => { if (isChunkError(e)) reloadTo(to.fullPath) })
router.afterEach(() => sessionStorage.removeItem(RELOAD_KEY))

export default router
