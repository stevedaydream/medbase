import { ref, onMounted, onUnmounted } from 'vue'
import { toast } from './ui'

/**
 * 下拉更新：各頁以 usePullRefresh 註冊自己的更新函式，只更新該頁用到的資料；
 * 設定頁註冊全部更新。頁面在最頂端時往下拉超過門檻、放手即觸發。
 */
type Handler = () => Promise<string | void>

let handler: Handler | null = null
/** 目前下拉距離（px，已做阻尼） */
export const pullDistance = ref(0)
export const pulling = ref(false)
export const PULL_THRESHOLD = 64

export function usePullRefresh(fn: Handler) {
  onMounted(() => { handler = fn })
  onUnmounted(() => { if (handler === fn) handler = null })
}

let startY = 0, startX = 0, tracking = false

/** 觸控起點若在可捲動且未捲到頂的區塊內（抽屜、內部清單），不觸發 */
function blocked(target: EventTarget | null): boolean {
  let el = target instanceof Element ? target : null
  while (el && el !== document.body) {
    if ((el as HTMLElement).dataset?.noPull !== undefined) return true
    if (el.scrollTop > 0) return true
    el = el.parentElement
  }
  return false
}

function onStart(e: TouchEvent) {
  tracking = false
  if (!handler || pulling.value || e.touches.length !== 1 || window.scrollY > 0 || blocked(e.target)) return
  startY = e.touches[0].clientY
  startX = e.touches[0].clientX
  tracking = true
}

function onMove(e: TouchEvent) {
  if (!tracking) return
  const dy = e.touches[0].clientY - startY
  const dx = e.touches[0].clientX - startX
  // 橫向滑動（班表左右捲）或往上捲就放棄
  if (dy <= 0 || Math.abs(dx) > dy || window.scrollY > 0) {
    if (dy < 0 || Math.abs(dx) > 12) { tracking = false; pullDistance.value = 0 }
    return
  }
  pullDistance.value = Math.min(dy * 0.5, PULL_THRESHOLD * 1.6)
}

async function onEnd() {
  if (!tracking) return
  tracking = false
  const go = pullDistance.value >= PULL_THRESHOLD && handler
  if (!go) { pullDistance.value = 0; return }
  const fn = handler!
  pulling.value = true
  pullDistance.value = PULL_THRESHOLD
  try {
    const msg = await fn()
    if (msg) toast(msg)
  } catch (e) {
    toast((e as Error).message || '更新失敗')
  } finally {
    pulling.value = false
    pullDistance.value = 0
  }
}

/** App 掛載一次 */
export function installPullRefresh() {
  window.addEventListener('touchstart', onStart, { passive: true })
  window.addEventListener('touchmove', onMove, { passive: true })
  window.addEventListener('touchend', onEnd, { passive: true })
  window.addEventListener('touchcancel', () => { tracking = false; if (!pulling.value) pullDistance.value = 0 }, { passive: true })
}
