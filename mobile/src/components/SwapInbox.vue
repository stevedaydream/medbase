<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { swapApi, ApiError } from '../lib/api'
import { toast } from '../lib/ui'
import { KIND_LABELS, type SwapReq } from '@shared/sched/empSwap'

/** 我的換班申請（ADR-016）：別人找我的（同意／婉拒）、我提出的（撤回）、最近結果 */
const props = defineProps<{ me: string; nameOf: (id: string) => string }>()
const emit = defineEmits<{ changed: [] }>()

const items = ref<SwapReq[]>([])
const busy = ref('')
async function load() {
  try { items.value = (await swapApi<{ items: SwapReq[] }>('list')).items } catch { /* 離線時沿用 */ }
}
onMounted(load)
defineExpose({ load })

const incoming = computed(() => items.value.filter(r => r.status === 'pending' && r.b === props.me))
const outgoing = computed(() => items.value.filter(r => r.status === 'pending' && r.a === props.me))
const recent = computed(() => items.value.filter(r => r.status !== 'pending').slice(0, 5))
const open = ref(false)

const STATUS: Record<string, string> = { done: '已生效', rejected: '已婉拒', cancelled: '已撤回', failed: '未成立' }
const mo = (r: SwapReq) => Number(r.ym.slice(4))
/** 從我的角度：我換前 → 換後 */
function line(r: SwapReq) {
  const iAmA = r.a === props.me
  return r.days.map(x => {
    const mine = iAmA ? x.aCode : x.bCode, theirs = iAmA ? x.bCode : x.aCode
    return `${mo(r)}/${x.day} ${mine || '空白'}→${theirs || '空白'}`
  }).join('、')
}

async function act(r: SwapReq, action: 'accept' | 'reject' | 'cancel') {
  busy.value = r.id
  try {
    const res = await swapApi<{ error?: string }>(action, { ym: r.ym, id: r.id })
    toast(action === 'accept' ? '✓ 換班已生效' : action === 'reject' ? '已婉拒' : '已撤回')
    if (res.error) toast(res.error)
    emit('changed')
  } catch (e) {
    toast(e instanceof ApiError && e.code === 'OFFLINE' ? '目前離線' : (e as Error).message)
  } finally {
    busy.value = ''
    await load()
  }
}
</script>

<template>
  <div v-if="items.length" class="mx-4 mb-3 space-y-2 text-sm">
    <div v-for="r in incoming" :key="r.id" class="p-3 rounded-2xl bg-accent/10 border border-accent/40 space-y-1.5">
      <p class="font-bold">{{ nameOf(r.a) }} 想跟你{{ KIND_LABELS[r.kind] }}</p>
      <p>你的班：{{ line(r) }}</p>
      <p v-if="r.note" class="text-fg-secondary">原因：{{ r.note }}</p>
      <p v-for="w in r.warnings" :key="w" class="text-xs text-warning">⚠ {{ w }}</p>
      <div class="flex gap-2 pt-1">
        <button :disabled="busy === r.id" @click="act(r, 'reject')" class="flex-1 h-10 rounded-xl bg-sunken font-bold disabled:opacity-40">婉拒</button>
        <button :disabled="busy === r.id" @click="act(r, 'accept')" class="flex-1 h-10 rounded-xl bg-accent text-white font-bold disabled:opacity-40">同意</button>
      </div>
    </div>
    <div v-for="r in outgoing" :key="r.id" class="p-3 rounded-2xl bg-surface border border-hairline flex items-center gap-2">
      <div class="flex-1">
        <p class="font-bold">等 {{ nameOf(r.b) }} 回覆 · {{ KIND_LABELS[r.kind] }}</p>
        <p class="text-fg-secondary">{{ line(r) }}</p>
      </div>
      <button :disabled="busy === r.id" @click="act(r, 'cancel')" class="text-danger font-bold disabled:opacity-40">撤回</button>
    </div>
    <button v-if="recent.length" @click="open = !open" class="text-xs text-muted">{{ open ? '▾' : '▸' }} 最近的換班（{{ recent.length }}）</button>
    <div v-if="open" class="space-y-1">
      <div v-for="r in recent" :key="r.id" class="px-3 py-2 rounded-xl bg-surface border border-hairline text-xs">
        <b :class="r.status === 'done' ? 'text-success' : 'text-muted'">{{ STATUS[r.status] }}</b>
        {{ r.a === me ? `我 ↔ ${nameOf(r.b)}` : `${nameOf(r.a)} ↔ 我` }}：{{ line(r) }}
        <span v-if="r.reason" class="text-danger">（{{ r.reason }}）</span>
      </div>
    </div>
  </div>
</template>
