<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'
import type { SessionUser, Config } from '../api'
import { gasApi } from '../api'
import ScheduleView from './ScheduleView.vue'
import BookingView from './BookingView.vue'

const props = defineProps<{ session: SessionUser }>()
const emit  = defineEmits<{ logout: [] }>()

type Tab = 'schedule' | 'booking'
const activeTab = ref<Tab>('schedule')
const config    = ref<Config>({})
const shifts    = ref<string[]>(['D', 'N', 'AM', 'Off'])
const toast     = ref('')
let toastTimer: ReturnType<typeof setTimeout> | null = null

function showToast(msg: string) {
  toast.value = msg
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => { toast.value = '' }, 2500)
}

async function fetchConfig() {
  const res = await gasApi<Record<string, string>>('getConfig')
  if (res.ok && res.data) config.value = res.data
}

onMounted(async () => {
  const [cfgRes, shiftRes] = await Promise.all([
    gasApi<Record<string, string>>('getConfig'),
    gasApi<string[]>('getShifts'),
  ])
  if (cfgRes.ok && cfgRes.data) config.value = cfgRes.data
  if (shiftRes.ok && shiftRes.data) shifts.value = shiftRes.data
})

// Re-fetch config every time user switches to booking tab
// so booking_open state is always fresh
watch(activeTab, (tab) => {
  if (tab === 'booking') fetchConfig()
})
</script>

<template>
  <div class="min-h-dvh bg-gray-950 flex flex-col text-gray-100">

    <!-- Top bar -->
    <header class="bg-gray-900 border-b border-gray-800 px-4 py-3 flex items-center justify-between flex-shrink-0">
      <div>
        <p class="text-sm font-semibold">排班系統</p>
        <p class="text-xs text-gray-500">{{ session.name }}</p>
      </div>
      <button @click="emit('logout')" class="text-xs px-3 py-1 bg-gray-800 border border-gray-700 rounded-lg text-gray-400 hover:text-gray-200 transition-colors">
        登出
      </button>
    </header>

    <!-- Booking status banner -->
    <div v-if="activeTab === 'booking'"
      class="text-xs py-1.5 flex-shrink-0 flex items-center justify-center gap-2"
      :class="config.booking_open === 'true' ? 'bg-emerald-900/50 text-emerald-400' : 'bg-gray-800/60 text-gray-500'">
      <span>
        <template v-if="config.booking_open === 'true'">
          預約開放中
          <span v-if="config.booking_from && config.booking_until">
            （{{ config.booking_from?.slice(5) }} — {{ config.booking_until?.slice(5) }}）
          </span>
        </template>
        <template v-else>預約視窗已關閉，班表排班中</template>
      </span>
      <button @click="fetchConfig" class="opacity-60 hover:opacity-100 transition-opacity" title="重新整理狀態">↺</button>
    </div>

    <!-- Content -->
    <main class="flex-1 overflow-y-auto">
      <ScheduleView v-if="activeTab === 'schedule'" :config="config" @toast="showToast" />
      <BookingView  v-else :session="session" :config="config" :shifts="shifts" @toast="showToast" />
    </main>

    <!-- Tab bar -->
    <nav class="bg-gray-900 border-t border-gray-800 flex flex-shrink-0">
      <button
        v-for="tab in ([['schedule','📅','班表'],['booking','📝','預約班別']] as const)"
        :key="tab[0]"
        @click="activeTab = tab[0]"
        class="flex-1 py-3 flex flex-col items-center gap-0.5 text-xs transition-colors"
        :class="activeTab === tab[0] ? 'text-blue-400' : 'text-gray-500'"
      >
        <span class="text-lg leading-none">{{ tab[1] }}</span>
        <span>{{ tab[2] }}</span>
      </button>
    </nav>

    <!-- Toast -->
    <Transition name="toast">
      <div v-if="toast" class="fixed bottom-20 left-1/2 -translate-x-1/2 bg-gray-700 text-gray-100 text-sm px-4 py-2 rounded-full shadow-lg pointer-events-none z-50 whitespace-nowrap">
        {{ toast }}
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.toast-enter-active, .toast-leave-active { transition: opacity .25s, transform .25s; }
.toast-enter-from, .toast-leave-to { opacity: 0; transform: translateX(-50%) translateY(8px); }
</style>
