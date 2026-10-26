<script setup lang="ts">
import { ref } from 'vue'
import { platform, inAppBrowser, iosNonSafari, installed, canPrompt, promptInstall } from '../lib/install'

/** 安裝引導（公開頁）：桌機側欄 QR code 掃描後進入，依 Android / iOS 給不同步驟 */
const samsung = /SamsungBrowser/.test(navigator.userAgent)
const pageUrl = `${location.origin}/install`
const copied = ref(false)

async function copyUrl() {
  try { await navigator.clipboard.writeText(pageUrl); copied.value = true; setTimeout(() => (copied.value = false), 1500) }
  catch { window.prompt('請複製網址', pageUrl) }
}

async function install() {
  await promptInstall()
}
</script>

<template>
  <div class="min-h-dvh flex flex-col items-center justify-center p-6 bg-sunken safe-top">
    <div class="w-full max-w-sm bg-surface border border-hairline rounded-2xl p-6 space-y-5 shadow-xl">
      <div class="text-center">
        <img src="/icon-192.png" alt="" class="mx-auto w-16 h-16 rounded-2xl" />
        <h1 class="mt-3 text-2xl font-black text-fg">安裝 MedBase</h1>
        <p class="mt-1 text-sm text-fg-secondary">加入主畫面後像 App 一樣使用，可離線查看</p>
      </div>

      <!-- 已從主畫面開啟 -->
      <template v-if="installed">
        <p class="px-3 py-2 rounded-xl bg-success/10 text-success text-sm font-bold text-center">✓ 已安裝完成</p>
        <RouterLink to="/login" class="block w-full h-12 leading-[3rem] rounded-xl bg-accent text-white text-center font-bold">前往登入</RouterLink>
      </template>

      <!-- LINE / FB 等內建瀏覽器 -->
      <template v-else-if="inAppBrowser">
        <div class="px-3 py-3 rounded-xl bg-warning/10 text-sm space-y-1.5">
          <p class="font-bold text-warning">目前在 App 內建瀏覽器，無法安裝</p>
          <p v-if="platform === 'ios'" class="text-fg-secondary">點右下角「⋯」或分享鈕 →「以 Safari 開啟」</p>
          <p v-else class="text-fg-secondary">點右上角「⋮」→「以瀏覽器開啟」</p>
          <p class="text-fg-secondary">找不到的話，複製網址貼到{{ platform === 'ios' ? ' Safari' : ' Chrome' }}。</p>
        </div>
        <button @click="copyUrl" class="w-full h-12 rounded-xl border border-hairline text-fg font-bold">{{ copied ? '已複製' : '複製網址' }}</button>
      </template>

      <!-- iPhone / iPad -->
      <template v-else-if="platform === 'ios'">
        <div v-if="iosNonSafari" class="px-3 py-3 rounded-xl bg-warning/10 text-sm space-y-1.5">
          <p class="font-bold text-warning">請改用 Safari 開啟</p>
          <p class="text-fg-secondary">iPhone 只有 Safari 能穩定加入主畫面。複製網址後貼到 Safari。</p>
          <button @click="copyUrl" class="mt-1 w-full h-10 rounded-xl border border-hairline text-fg font-bold">{{ copied ? '已複製' : '複製網址' }}</button>
        </div>
        <ol class="space-y-3 text-sm text-fg">
          <li class="flex gap-3"><span class="step">1</span><span>點 Safari 下方的<b>分享</b>鈕 <svg class="inline w-4 h-4 -mt-1 text-accent" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-label="分享"><path d="M12 3v12M8 7l4-4 4 4M6 11H5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-1"/></svg>（看不到時先點網址列旁的「⋯」）</span></li>
          <li class="flex gap-3"><span class="step">2</span><span>往下滑，選<b>「加入主畫面」</b></span></li>
          <li class="flex gap-3"><span class="step">3</span><span>確認「以網頁 App 打開」開啟，點右上角<b>「新增」</b></span></li>
          <li class="flex gap-3"><span class="step">4</span><span>回主畫面點 <b>MedBase</b> 圖示，<b>在 App 裡登入</b></span></li>
        </ol>
        <p class="text-xs text-muted leading-relaxed">iPhone 的主畫面 App 與 Safari 登入狀態分開，請安裝後在 App 內登入。</p>
      </template>

      <!-- Android -->
      <template v-else-if="platform === 'android'">
        <button v-if="canPrompt" @click="install" class="w-full h-12 rounded-xl bg-accent text-white text-base font-bold">安裝 MedBase</button>
        <ol v-else-if="samsung" class="space-y-3 text-sm text-fg">
          <li class="flex gap-3"><span class="step">1</span><span>點下方選單 <span class="key">≡</span></span></li>
          <li class="flex gap-3"><span class="step">2</span><span>選<b>「新增頁面至」→「主畫面」</b></span></li>
          <li class="flex gap-3"><span class="step">3</span><span>點<b>「新增」</b>，回主畫面開啟 MedBase</span></li>
        </ol>
        <ol v-else class="space-y-3 text-sm text-fg">
          <li class="flex gap-3"><span class="step">1</span><span>點 Chrome 右上角 <span class="key">⋮</span></span></li>
          <li class="flex gap-3"><span class="step">2</span><span>選<b>「安裝應用程式」</b>或<b>「加到主畫面」</b></span></li>
          <li class="flex gap-3"><span class="step">3</span><span>點<b>「安裝」</b>，回主畫面開啟 MedBase</span></li>
        </ol>
        <p v-if="canPrompt" class="text-xs text-muted text-center">沒有跳出視窗時，點右上角「⋮」→「安裝應用程式」</p>
      </template>

      <!-- 桌機或其他 -->
      <template v-else>
        <p class="text-sm text-fg-secondary">請用手機掃描桌機 MedBase 側欄的 QR code，或在手機瀏覽器開啟：</p>
        <code class="block px-3 py-2 rounded-xl bg-sunken text-xs text-fg break-all">{{ pageUrl }}</code>
      </template>

      <RouterLink v-if="!installed" to="/login" class="block text-center text-sm text-muted">先不安裝，直接在瀏覽器使用 →</RouterLink>
    </div>
  </div>
</template>

<style scoped>
.step { flex: none; width: 1.5rem; height: 1.5rem; border-radius: 9999px; display: inline-flex; align-items: center; justify-content: center;
  font-size: .75rem; font-weight: 700; color: white; background: var(--color-accent); }
.key { display: inline-block; padding: 0 .35rem; border-radius: .375rem; border: 1px solid var(--color-hairline); font-weight: 700; }
</style>
