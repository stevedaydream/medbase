<script setup lang="ts">
import { ref } from 'vue'
import { gasApi } from '../api'
import type { SessionUser } from '../api'
import { sha256 } from '../utils/sha256'

const emit = defineEmits<{ login: [user: SessionUser] }>()

const code    = ref('')
const pw      = ref('')
const errMsg  = ref('')
const loading = ref(false)

async function doLogin() {
  if (!code.value.trim() || !pw.value) { errMsg.value = '請輸入代號與密碼'; return }
  loading.value = true
  errMsg.value  = ''
  const hash = await sha256(pw.value)
  const r = await gasApi<SessionUser>('login', { code: code.value.trim(), pwHash: hash })
  loading.value = false
  if (!r.ok || !r.data) { errMsg.value = r.error ?? '代號或密碼錯誤'; return }
  emit('login', r.data)
}
</script>

<template>
  <div class="min-h-dvh bg-gray-950 flex flex-col items-center justify-center p-6">
    <div class="w-full max-w-xs bg-gray-900 border border-gray-800 rounded-2xl p-8 shadow-xl">
      <h1 class="text-xl font-bold text-center text-gray-100 mb-1">排班系統</h1>
      <p class="text-xs text-gray-500 text-center mb-7">員工登入</p>

      <div class="space-y-4">
        <div>
          <label class="block text-xs text-gray-500 mb-1.5">員工代號</label>
          <input
            v-model="code"
            @keyup.enter="doLogin"
            type="text"
            autocomplete="username"
            autocorrect="off"
            autocapitalize="none"
            class="w-full px-3 py-2.5 bg-gray-800 border border-gray-700 rounded-lg text-gray-100 text-sm outline-none focus:border-blue-500 transition-colors"
          />
        </div>
        <div>
          <label class="block text-xs text-gray-500 mb-1.5">密碼</label>
          <input
            v-model="pw"
            @keyup.enter="doLogin"
            type="password"
            autocomplete="current-password"
            class="w-full px-3 py-2.5 bg-gray-800 border border-gray-700 rounded-lg text-gray-100 text-sm outline-none focus:border-blue-500 transition-colors"
          />
        </div>
      </div>

      <p class="text-red-400 text-xs text-center min-h-4 mt-3">{{ errMsg }}</p>

      <button
        @click="doLogin"
        :disabled="loading"
        class="mt-2 w-full py-2.5 bg-blue-700 hover:bg-blue-600 disabled:opacity-50 text-white text-sm font-semibold rounded-lg transition-colors"
      >
        {{ loading ? '驗證中…' : '登入' }}
      </button>
    </div>
  </div>
</template>
