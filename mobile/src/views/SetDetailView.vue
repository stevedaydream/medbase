<script setup lang="ts">
import { computed, watch } from 'vue'
import { useRoute } from 'vue-router'
import PageHeader from '../components/PageHeader.vue'
import { data, type Row, type TableName, pullRefresh } from '../lib/data'
import { usePullRefresh } from '../lib/pull'
import { steps, setItemsOf, itemByCode, pushRecent } from '../lib/records'
import { copy } from '../lib/ui'

/** 套組詳情（唯讀）：處方、手術處置、疾病常規、檢查處置、品項套組 */
const route = useRoute()
const kind = computed(() => String(route.params.kind) as TableName)
const row = computed<Row | undefined>(() => (data.tables[kind.value] ?? []).find(r => r.uid === route.params.id))

const LABEL: Record<string, string> = { prescriptions: '處方', surgery: '手術', disease: '疾病', examination: '檢查', sets: '套組' }
const ACCENT: Record<string, string> = { sets: 'accent-violet' }

watch(row, r => { if (r) pushRecent({ to: route.fullPath, title: r.name, type: LABEL[kind.value] ?? '' }) }, { immediate: true })

/** 步驟清單區塊 */
const blocks = computed(() => {
  const r = row.value
  if (!r) return []
  switch (kind.value) {
    case 'prescriptions': return [{ title: '配製步驟／醫囑', lines: steps(r.orders) }]
    case 'surgery': return [{ title: '術前醫囑', lines: steps(r.pre_op_orders) }, { title: '術後醫囑', lines: steps(r.post_op_orders) }]
    case 'disease': return [
      { title: '入院檢查（Workup）', lines: steps(r.workup) },
      { title: '常規醫囑', lines: steps(r.treatment_orders) },
      { title: '會診流程', lines: (r.consult_flow || '').split('\n').map(s => s.trim()).filter(Boolean) },
    ]
    case 'examination': return [{ title: '開單注意事項', lines: steps(r.orders) }]
    default: return []
  }
})

const setLines = computed(() => row.value && kind.value === 'sets'
  ? setItemsOf(row.value).map(si => {
      const it = itemByCode.value.get(si.hospital_code)
      const price = si.price ?? it?.price ?? null
      return { ...si, name: it?.name_zh || it?.name_en || '（品項資料缺漏）', unitPrice: price, subtotal: price != null ? price * (si.quantity || 1) : null }
    })
  : [])
const setTotal = computed(() => setLines.value.filter(l => !l.is_optional).reduce((n, l) => n + (l.subtotal ?? 0), 0))

usePullRefresh(() => pullRefresh(['prescriptions', 'surgery', 'examination', 'disease', 'sets', 'items']))
</script>

<template>
  <div class="pad-tabbar" :class="ACCENT[kind] ?? 'accent-teal'">
    <PageHeader :title="row?.name ?? '找不到資料'" back />
    <div v-if="!row" class="p-8 text-center text-sm text-muted">這筆資料不存在或已被刪除</div>
    <div v-else class="p-4 space-y-4">
      <!-- 基本資訊 -->
      <section class="rounded-2xl bg-surface border border-hairline p-4 space-y-1.5 text-sm">
        <p v-if="row.category" class="text-fg-secondary"><span class="text-muted">分類　</span>{{ row.category }}</p>
        <p v-if="row.indication" class="text-fg-secondary"><span class="text-muted">適應症　</span>{{ row.indication }}</p>
        <p v-if="row.icd10" class="text-fg-secondary"><span class="text-muted">ICD-10　</span><span class="font-mono">{{ row.icd10 }}</span></p>
        <p v-if="row.his_code" class="text-fg-secondary">
          <span class="text-muted">HIS 代碼　</span>
          <button @click="copy(row.his_code, 'HIS 代碼')" class="font-mono font-bold text-accent">{{ row.his_code }}</button>
        </p>
        <p v-if="row.physician_name" class="text-fg-secondary"><span class="text-muted">醫師　</span>{{ row.physician_name }}</p>
        <p v-if="row.surgery_type" class="text-fg-secondary"><span class="text-muted">術式　</span>{{ row.surgery_type }}</p>
      </section>

      <!-- 醫囑步驟 -->
      <section v-for="b in blocks.filter(b => b.lines.length)" :key="b.title" class="rounded-2xl bg-surface border border-hairline p-4">
        <div class="flex items-center justify-between mb-2">
          <p class="font-bold text-fg">{{ b.title }}</p>
          <button @click="copy(b.lines.join('\n'), b.title)" class="h-8 px-3 rounded-lg bg-sunken text-xs font-bold text-fg-secondary">複製</button>
        </div>
        <ol class="space-y-1.5 text-sm">
          <li v-for="(l, i) in b.lines" :key="i" class="flex gap-2">
            <span class="shrink-0 w-5 text-right text-muted tabular-nums">{{ i + 1 }}.</span>
            <span class="text-fg whitespace-pre-wrap break-words">{{ l }}</span>
          </li>
        </ol>
      </section>

      <!-- 品項套組 -->
      <section v-if="kind === 'sets'" class="rounded-2xl bg-surface border border-hairline">
        <div class="flex items-center justify-between px-4 pt-4 pb-2">
          <p class="font-bold text-fg">品項（{{ setLines.length }}）</p>
          <p class="text-sm font-bold text-success tabular-nums">必用合計 ${{ setTotal.toLocaleString() }}</p>
        </div>
        <div class="divide-y divide-hairline">
          <div v-for="(l, i) in setLines" :key="i" class="px-4 py-2.5">
            <div class="flex items-baseline gap-2">
              <button @click="copy(l.hospital_code, '院內碼')" class="shrink-0 font-mono text-xs font-bold text-accent">{{ l.hospital_code }}</button>
              <span class="flex-1 min-w-0 text-sm font-bold text-fg">{{ l.name }}</span>
              <span v-if="l.is_optional" class="shrink-0 text-2xs font-bold rounded bg-warning/15 text-warning px-1.5">PRN</span>
            </div>
            <p class="mt-0.5 text-xs text-muted tabular-nums">
              × {{ l.quantity || 1 }}
              <template v-if="l.unitPrice != null">　單價 ${{ l.unitPrice.toLocaleString() }}　小計 ${{ (l.subtotal ?? 0).toLocaleString() }}</template>
              <template v-if="l.notes">　{{ l.notes }}</template>
            </p>
          </div>
        </div>
      </section>

      <section v-if="row.notes" class="rounded-2xl bg-surface border border-hairline p-4">
        <p class="font-bold text-fg mb-1">備註</p>
        <p class="text-sm text-fg-secondary whitespace-pre-wrap">{{ row.notes }}</p>
      </section>
    </div>
  </div>
</template>
