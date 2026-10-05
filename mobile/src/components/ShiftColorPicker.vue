<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { doc, loadSchedCache } from '../lib/sched'
import { myColors, loadMyColors, saveMyColors } from '../lib/shiftColors'
import { toast } from '../lib/ui'
import { COLOR_PALETTE, colorOf, textOn, type ShiftColorPrefs } from '@shared/sched/palette'
import { DEFAULT_SHIFTS, type ShiftDef } from '@shared/sched/types'

/** 自選班表顏色：每個班別從色票挑或自由選色（字色依底色自動配），存雲端跟著帳號 */
const shifts = computed(() => doc<ShiftDef[]>('shifts') ?? DEFAULT_SHIFTS)
const draft = ref<ShiftColorPrefs>({})
const open = ref(false)
const saving = ref(false)

onMounted(async () => {
  await loadSchedCache()
  await loadMyColors()
  draft.value = JSON.parse(JSON.stringify(myColors.value))
})

const colorOfCode = (s: ShiftDef) => draft.value[s.code] ?? colorOf(s.color)
const dirty = computed(() => JSON.stringify(draft.value) !== JSON.stringify(myColors.value))

function pick(code: string, bg: string, text = textOn(bg)) {
  draft.value = { ...draft.value, [code]: { bg, text } }
}
function reset(code: string) {
  const { [code]: _drop, ...rest } = draft.value
  draft.value = rest
}
async function save() {
  saving.value = true
  try {
    await saveMyColors(draft.value)
    toast('已儲存班表顏色')
  } catch (e) {
    toast(`儲存失敗：${(e as Error).message}`)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <section class="p-4 rounded-2xl bg-surface border border-hairline space-y-3">
    <button class="w-full flex items-center justify-between" @click="open = !open">
      <span class="font-bold text-fg">班表顏色</span>
      <span class="text-sm text-muted">{{ open ? '收起 ▴' : '自訂 ▾' }}</span>
    </button>
    <template v-if="open">
      <p class="text-sm text-fg-secondary">只改變你自己看到的顏色，換手機或重新登入也會保留。</p>
      <div v-for="s in shifts" :key="s.code" class="space-y-1.5 pt-2 border-t border-hairline">
        <div class="flex items-center gap-2">
          <span class="min-w-12 px-2 py-1 rounded-lg text-sm font-bold text-center" :style="{ backgroundColor: colorOfCode(s).bg, color: colorOfCode(s).text }">{{ s.code }}</span>
          <span class="flex-1 text-sm text-fg-secondary truncate">{{ s.name }}</span>
          <span v-if="draft[s.code]" class="text-xs text-accent font-bold">自訂</span>
          <button v-if="draft[s.code]" class="text-xs text-muted" @click="reset(s.code)">單位預設</button>
        </div>
        <div class="flex flex-wrap items-center gap-1.5">
          <button v-for="c in COLOR_PALETTE" :key="c.key" class="w-7 h-7 rounded-full border-2"
            :class="colorOfCode(s).bg === c.bg ? 'border-accent' : 'border-transparent'" :style="{ backgroundColor: c.bg }"
            :aria-label="c.key" @click="pick(s.code, c.bg, c.text)" />
          <label class="relative w-7 h-7 rounded-full border border-hairline flex items-center justify-center text-xs text-muted overflow-hidden" title="自由選色">
            ＋
            <input type="color" :value="colorOfCode(s).bg" class="absolute inset-0 opacity-0" @input="pick(s.code, ($event.target as HTMLInputElement).value)" />
          </label>
        </div>
      </div>
      <button class="w-full h-11 rounded-xl bg-accent text-white font-bold disabled:opacity-40" :disabled="saving || !dirty" @click="save">
        {{ saving ? '儲存中…' : '儲存班表顏色' }}
      </button>
    </template>
  </section>
</template>
