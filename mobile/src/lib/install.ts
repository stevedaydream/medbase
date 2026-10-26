import { ref } from 'vue'

/** PWA 安裝引導：偵測平台與瀏覽器，Android Chrome 攔下安裝提示供按鈕觸發 */

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

export type Platform = 'ios' | 'android' | 'other'

const ua = navigator.userAgent
// iPadOS 13+ 會偽裝成 Mac，用觸控點判斷
const isIOS = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)

export const platform: Platform = isIOS ? 'ios' : /Android/.test(ua) ? 'android' : 'other'

/** LINE / Facebook / Instagram 等 App 內建瀏覽器，無法安裝 PWA */
export const inAppBrowser = /Line\/|FBAN|FBAV|Instagram|MicroMessenger/i.test(ua)

/** iOS 只有 Safari 能加入主畫面（Chrome / Edge 等在 iOS 16.4 前不行，統一引導用 Safari） */
export const iosNonSafari = isIOS && /CriOS|FxiOS|EdgiOS|OPiOS/.test(ua)

export const isStandalone = () =>
  window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true

export const canPrompt = ref(false)
export const installed = ref(isStandalone())
let deferred: BeforeInstallPromptEvent | null = null

/** 須在 App 啟動時呼叫：beforeinstallprompt 可能在進入安裝頁之前就觸發 */
export function installPromptWatch() {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()
    deferred = e as BeforeInstallPromptEvent
    canPrompt.value = true
  })
  window.addEventListener('appinstalled', () => {
    installed.value = true
    canPrompt.value = false
    deferred = null
  })
}

export async function promptInstall() {
  if (!deferred) return false
  await deferred.prompt()
  const { outcome } = await deferred.userChoice
  deferred = null
  canPrompt.value = false
  return outcome === 'accepted'
}
