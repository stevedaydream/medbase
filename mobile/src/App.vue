<script setup lang="ts">
import { ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import TabBar from './components/TabBar.vue'
import { session, unlock, logout } from './lib/session'
import { loadCache, refresh } from './lib/data'
import { toastMsg } from './lib/ui'

const route = useRoute()
const router = useRouter()

// 登入後：先顯示手機快取，再背景更新（ADR-013）
watch(() => session.user, (u) => {
  if (u) { loadCache().then(() => refresh()) }
  else if (route.path !== '/login') router.replace('/login')
}, { immediate: true })

// 閒置上鎖：只要輸入密碼（本機比對，離線也可）
const pw = ref('')
const unlockError = ref('')
async function doUnlock() {
  unlockError.value = ''
  if (await unlock(pw.value)) { pw.value = ''; refresh() }
  else unlockError.value = '密碼錯誤'
}
</script>

<template>
  <div class="accent-cyan min-h-full bg-sunken text-fg">
    <RouterView />
    <TabBar v-if="session.user && route.path !== '/login'" />

    <!-- 閒置上鎖 -->
    <div v-if="session.user && session.locked" class="fixed inset-0 z-[100] bg-sunken flex items-center justify-center p-6">
      <form @submit.prevent="doUnlock" class="w-full max-w-xs bg-surface border border-hairline rounded-2xl p-6 space-y-4 shadow-xl">
        <div class="text-center">
          <div class="text-3xl">🔒</div>
          <p class="mt-2 font-bold text-fg">{{ session.user.name }}</p>
          <p class="text-xs text-muted font-mono">HIS {{ session.user.his }}</p>
          <p class="mt-2 text-sm text-fg-secondary">閒置超過 15 分鐘，請輸入 HIS 密碼解鎖</p>
        </div>
        <input v-model="pw" type="password" autocomplete="current-password" autofocus
          class="w-full h-12 px-4 rounded-xl bg-sunken border border-hairline text-base text-fg outline-none focus:border-accent/60" />
        <p v-if="unlockError" class="text-sm text-danger font-bold">{{ unlockError }}</p>
        <button type="submit" :disabled="!pw" class="w-full h-12 rounded-xl bg-accent text-white font-bold disabled:opacity-40">解鎖</button>
        <button type="button" @click="logout()" class="w-full text-sm text-muted">改用其他帳號登入</button>
      </form>
    </div>

    <!-- 提示 -->
    <Transition name="toast">
      <div v-if="toastMsg" class="fixed left-1/2 -translate-x-1/2 z-[110] max-w-[90vw] px-4 py-2.5 rounded-xl bg-fg text-sunken text-sm font-bold shadow-xl"
        :style="{ bottom: 'calc(var(--tabbar-h) + var(--search-h) + var(--safe-b) + 1rem)' }">
        {{ toastMsg }}
      </div>
    </Transition>
  </div>
</template>

<style>
.toast-enter-active, .toast-leave-active { transition: opacity .2s, transform .2s; }
.toast-enter-from, .toast-leave-to { opacity: 0; transform: translate(-50%, 8px); }
</style>
