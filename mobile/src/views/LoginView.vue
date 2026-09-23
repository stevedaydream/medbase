<script setup lang="ts">
import { ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { apiLogin, ApiError } from '../lib/api'
import { session, setLoggedIn } from '../lib/session'

/** 以通訊錄的 HIS 帳號＋HIS 密碼登入（ADR-013） */
const route = useRoute()
const router = useRouter()
const his = ref('')
const password = ref('')
const loading = ref(false)
const error = ref('')

async function submit() {
  if (!his.value.trim() || !password.value || loading.value) return
  loading.value = true
  error.value = ''
  try {
    const { token, user } = await apiLogin(his.value.trim(), password.value)
    await setLoggedIn(token, user, password.value)
    password.value = ''
    router.replace(typeof route.query.next === 'string' ? route.query.next : '/')
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : '登入失敗'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="min-h-dvh flex flex-col items-center justify-center p-6 bg-sunken safe-top">
    <form @submit.prevent="submit" class="w-full max-w-sm bg-surface border border-hairline rounded-2xl p-6 space-y-4 shadow-xl">
      <div class="text-center">
        <h1 class="text-2xl font-black text-fg">MedBase</h1>
        <p class="mt-1 text-sm text-fg-secondary">以 HIS 帳號與密碼登入</p>
      </div>
      <p v-if="session.notice" class="px-3 py-2 rounded-xl bg-warning/10 text-warning text-sm font-bold">{{ session.notice }}</p>
      <div>
        <label class="block text-xs font-bold text-muted mb-1.5">HIS 帳號（員工編號）</label>
        <input v-model="his" inputmode="numeric" autocomplete="username" autocapitalize="off" autocorrect="off"
          class="w-full h-12 px-4 rounded-xl bg-sunken border border-hairline text-base text-fg font-mono outline-none focus:border-accent/60" />
      </div>
      <div>
        <label class="block text-xs font-bold text-muted mb-1.5">HIS 密碼</label>
        <input v-model="password" type="password" autocomplete="current-password"
          class="w-full h-12 px-4 rounded-xl bg-sunken border border-hairline text-base text-fg outline-none focus:border-accent/60" />
      </div>
      <p v-if="error" class="text-sm text-danger font-bold">{{ error }}</p>
      <button type="submit" :disabled="loading || !his.trim() || !password"
        class="w-full h-12 rounded-xl bg-accent text-white text-base font-bold disabled:opacity-40">
        {{ loading ? '登入中…' : '登入' }}
      </button>
      <p class="text-xs text-muted leading-relaxed">
        帳密與院內 HIS 相同，須已登錄於 MedBase 通訊錄。醫院變更密碼後，請同步更新通訊錄。
      </p>
    </form>
  </div>
</template>
