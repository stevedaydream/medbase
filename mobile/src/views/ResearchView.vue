<script setup lang="ts">
import { ref, computed } from 'vue'
import PageHeader from '../components/PageHeader.vue'
import { research, unlockResearch, listDays, loadDay, table } from '../lib/research'
import { ApiError } from '../lib/api'
import { fmtTime } from '../lib/ui'
import { stageMeta, studyTypeLabel } from '@shared/researchMeta'

/** 論文專案（唯讀）：輸入論文 PIN 後讀取個人雲端備份 */
const pin = ref('')
const busy = ref(false)
const error = ref('')

async function submit() {
  if (!/^\d{4,6}$/.test(pin.value)) { error.value = 'PIN 為 4～6 碼數字'; return }
  busy.value = true
  error.value = ''
  try {
    await unlockResearch(pin.value)
    pin.value = ''
  } catch (e) {
    const err = e as ApiError
    error.value = err.code === 'BAD_PIN' ? `PIN 錯誤${err.data?.remaining != null ? `，再錯 ${err.data.remaining} 次將鎖定 15 分鐘` : ''}`
      : err.code === 'LOCKED' ? '錯誤次數過多，已暫時鎖定，請稍後再試'
      : err.code === 'NOT_FOUND' ? '尚未設定論文 PIN：請先在桌機 MedBase 的論文專案設定'
      : err.code === 'OFFLINE' ? '目前離線，論文資料只能連線讀取'
      : err.message
  } finally { busy.value = false }
}

const showArchived = ref(false)
const projects = computed(() => table('research_projects')
  .filter(p => Boolean(Number(p.archived)) === showArchived.value)
  .sort((a, b) => String(b.updated_at ?? '').localeCompare(String(a.updated_at ?? ''))))

// 切換備份日期
const days = ref<{ day: string; updated_at: string }[]>([])
const dayOpen = ref(false)
async function openDays() {
  dayOpen.value = !dayOpen.value
  if (dayOpen.value) { try { days.value = await listDays() } catch (e) { error.value = (e as Error).message } }
}
async function pickDay(d: string) {
  dayOpen.value = false
  try { await loadDay(d) } catch (e) { error.value = (e as Error).message }
}

const TONE: Record<string, string> = { neutral: 'bg-sunken text-fg-secondary', warn: 'bg-warning/15 text-warning', success: 'bg-success/15 text-success' }
</script>

<template>
  <div class="accent-fuchsia pad-tabbar">
    <PageHeader title="論文專案" back />

    <!-- PIN -->
    <form v-if="!research.snapshot" @submit.prevent="submit" class="m-4 p-5 rounded-2xl bg-surface border border-hairline space-y-4">
      <div class="text-center">
        <div class="text-3xl">🎓</div>
        <p class="mt-1 text-sm text-fg-secondary">輸入論文專案的 PIN（與桌機相同）</p>
      </div>
      <input v-model="pin" type="password" inputmode="numeric" maxlength="6" autocomplete="off"
        class="w-full h-12 px-4 rounded-xl bg-sunken border border-hairline text-center text-2xl tracking-[0.5em] font-mono outline-none focus:border-accent/60" />
      <p v-if="error" class="text-sm text-danger font-bold">{{ error }}</p>
      <button type="submit" :disabled="busy || !pin" class="w-full h-12 rounded-xl bg-accent text-white font-bold disabled:opacity-40">
        {{ busy ? '讀取中…' : '開啟' }}
      </button>
      <p class="text-xs text-muted leading-relaxed">手機版為唯讀，資料來自你的個人雲端備份。論文資料不會存在手機上，手機上鎖或登出時即清除。</p>
    </form>

    <div v-else class="p-4 space-y-3">
      <div class="flex items-center gap-2 text-xs text-muted">
        <span>備份 {{ research.backupDay || '—' }}（{{ fmtTime(research.backupAt) }}）</span>
        <button @click="openDays" class="text-accent font-bold">切換</button>
        <div class="flex-1" />
        <button @click="showArchived = !showArchived" class="font-bold" :class="showArchived ? 'text-accent' : ''">{{ showArchived ? '顯示進行中' : '顯示封存' }}</button>
      </div>
      <div v-if="dayOpen" class="rounded-2xl bg-surface border border-hairline divide-y divide-hairline">
        <button v-for="d in days" :key="d.day" @click="pickDay(d.day)" class="w-full flex justify-between px-4 py-3 text-sm">
          <span class="font-bold" :class="d.day === research.backupDay ? 'text-accent' : 'text-fg'">{{ d.day }}</span>
          <span class="text-muted">{{ fmtTime(d.updated_at) }}</span>
        </button>
      </div>
      <p v-if="error" class="text-sm text-danger">{{ error }}</p>
      <p v-if="!projects.length" class="py-12 text-center text-sm text-muted">{{ showArchived ? '沒有封存的專案' : '雲端備份裡沒有進行中的專案' }}</p>
      <RouterLink v-for="p in projects" :key="String(p.id)" :to="`/research/${p.id}`" class="block rounded-2xl bg-surface border border-hairline p-4">
        <div class="flex items-center gap-2 mb-1">
          <span class="rounded-full px-2 py-0.5 text-xs font-bold" :class="TONE[stageMeta(String(p.stage)).tone]">{{ stageMeta(String(p.stage)).label }}</span>
          <span class="text-xs text-muted">{{ studyTypeLabel(p.study_type as string | null) }}</span>
        </div>
        <p class="font-bold text-fg">{{ p.title }}</p>
        <p v-if="p.title_zh" class="text-sm text-fg-secondary">{{ p.title_zh }}</p>
      </RouterLink>
    </div>
  </div>
</template>
