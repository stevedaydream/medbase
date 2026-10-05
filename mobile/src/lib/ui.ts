import { ref, onMounted, onUnmounted } from 'vue'

// ── 提示訊息 ─────────────────────────────────────────────────────
export const toastMsg = ref('')
let toastTimer: ReturnType<typeof setTimeout> | null = null
export function toast(msg: string, ms = 2200) {
  toastMsg.value = msg
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => { toastMsg.value = '' }, ms)
}

// ── 撥號 ─────────────────────────────────────────────────────────
/**
 * 分機轉成 tel: 連結（點了開啟手機撥號程式並填入號碼）。
 * 只留撥號字元；寫成「1234／5678」等多支時取第一支；沒有數字時回傳空字串。
 */
export function telHref(ext: string | undefined): string {
  const first = (ext ?? '').split(/[\/／、,，;；]|\s{2,}|或/)[0] ?? ''
  const num = first.replace(/[^\d*#+]/g, '')
  return /\d/.test(num) ? `tel:${num.replace(/#/g, '%23')}` : ''
}

// ── 複製 ─────────────────────────────────────────────────────────
let clearTimer: ReturnType<typeof setTimeout> | null = null

/** 點一下複製；sensitive（密碼）約 60 秒後嘗試清空剪貼簿，瀏覽器不允許時改為提醒 */
export async function copy(text: string, label = '', sensitive = false) {
  if (!text) return
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    // 舊瀏覽器後備
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.cssText = 'position:fixed;opacity:0'
    document.body.appendChild(ta)
    ta.select()
    try { document.execCommand('copy') } catch { /* ignore */ }
    ta.remove()
  }
  if (!sensitive) { toast(`已複製${label ? ` ${label}` : ''}`); return }
  toast(`已複製${label ? ` ${label}` : ''}，約 60 秒後清除剪貼簿`)
  if (clearTimer) clearTimeout(clearTimer)
  clearTimer = setTimeout(async () => {
    try {
      // 只在剪貼簿仍是這組密碼時清空；多數手機瀏覽器不允許讀取，會直接失敗
      if ((await navigator.clipboard.readText()) === text) await navigator.clipboard.writeText('')
    } catch {
      try { await navigator.clipboard.writeText('') } catch { toast('提醒：剪貼簿裡仍有密碼，貼上後請自行覆蓋') }
    }
  }, 60_000)
}

// ── 鍵盤高度：讓底部搜尋列貼在鍵盤上方 ──────────────────────────
export const keyboardOpen = ref(false)
let kbInstalled = false
export function installKeyboardWatch() {
  if (kbInstalled || !window.visualViewport) return
  kbInstalled = true
  const vv = window.visualViewport
  const update = () => {
    const kb = Math.max(0, window.innerHeight - vv.height - vv.offsetTop)
    document.documentElement.style.setProperty('--kb', `${kb}px`)
    keyboardOpen.value = kb > 80
  }
  vv.addEventListener('resize', update)
  vv.addEventListener('scroll', update)
  update()
}

// ── 主題：跟隨系統／淺色／深色 ──────────────────────────────────
export type ThemeMode = 'system' | 'light' | 'dark'
export const themeMode = ref<ThemeMode>((localStorage.getItem('mb_theme') as ThemeMode) || 'system')
export function applyTheme(mode: ThemeMode = themeMode.value) {
  themeMode.value = mode
  localStorage.setItem('mb_theme', mode)
  const root = document.documentElement
  if (mode === 'system') root.removeAttribute('data-theme')
  else root.setAttribute('data-theme', mode)
}

// ── 小工具 ───────────────────────────────────────────────────────
export function fmtTime(iso: string): string {
  if (!iso) return '尚未更新'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso
  const sameDay = d.toDateString() === new Date().toDateString()
  return d.toLocaleString('zh-TW', sameDay
    ? { hour: '2-digit', minute: '2-digit' }
    : { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

/** 空白分隔的多關鍵字，全部符合 */
export function matchTerms(haystack: string, query: string): boolean {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (!terms.length) return true
  const h = haystack.toLowerCase()
  return terms.every(t => h.includes(t))
}

/** 每分鐘更新的現在時間（值班「在班」標示用） */
export function useNow() {
  const now = ref(new Date())
  let t: ReturnType<typeof setInterval> | null = null
  onMounted(() => { t = setInterval(() => { now.value = new Date() }, 60_000) })
  onUnmounted(() => { if (t) clearInterval(t) })
  return now
}

// ── 長按看全文 ───────────────────────────────────────────────────
/**
 * 長按被截斷（truncate）的文字約 0.5 秒，以提示框顯示全文；
 * 手指移動（捲動）就取消，長按後放開不觸發點擊。
 */
export function installLongPressFullText() {
  let timer: ReturnType<typeof setTimeout> | null = null
  let x = 0, y = 0
  let fired = false
  const cancel = () => { if (timer) clearTimeout(timer); timer = null }
  document.addEventListener('pointerdown', e => {
    cancel()
    fired = false
    const el = (e.target as HTMLElement | null)?.closest<HTMLElement>('.truncate')
    if (!el || el.scrollWidth <= el.clientWidth) return
    x = e.clientX; y = e.clientY
    timer = setTimeout(() => {
      fired = true
      toast(el.textContent?.trim() ?? '', 4000)
    }, 500)
  }, { passive: true })
  document.addEventListener('pointermove', e => { if (timer && Math.hypot(e.clientX - x, e.clientY - y) > 10) cancel() }, { passive: true })
  document.addEventListener('pointerup', cancel, { passive: true })
  document.addEventListener('pointercancel', cancel, { passive: true })
  document.addEventListener('click', e => { if (fired) { fired = false; e.preventDefault(); e.stopPropagation() } }, true)
  // 長按時不跳出系統選單（複製、分享）
  document.addEventListener('contextmenu', e => { if (fired || timer) e.preventDefault() })
}
