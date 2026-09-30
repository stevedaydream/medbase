<script setup lang="ts">
import { ref, computed, onMounted, watch } from "vue";
import { useRouter } from "vue-router";
import { openUrl } from "@tauri-apps/plugin-opener";
import { loadHandbook, HB_TABLE } from "@/composables/useHandbook";
import { loadEmergencyCards } from "@/composables/useEmergency";
import { onTableSynced } from "@/composables/useTableSync";
import { SECTION_LABELS, STATUS_LABELS, searchHandbook, visibleEntries, type HbEntry, type HbSection } from "@/shared/handbook/types";
import { DISCLAIMER } from "@/shared/emergency/types";
import { PUMP_UNIT_LABELS } from "@/shared/handbook/formulas";

/** 隨身工作手冊（ADR-018）：值班常見狀況、外科照護、常用公式、行政流程 */
const router = useRouter();
type Tab = HbSection;
/** only：嵌在「處置及臨床工具」時只顯示這些分頁；open：一開始要開的條目或公式 id */
const props = defineProps<{ only?: Tab[]; open?: string }>();
const ALL_TABS: { key: Tab; label: string }[] = [
  { key: "oncall", label: SECTION_LABELS.oncall }, { key: "surgical", label: SECTION_LABELS.surgical },
  { key: "drug", label: SECTION_LABELS.drug }, { key: "admin", label: SECTION_LABELS.admin },
];
const TABS = ALL_TABS.filter(t => !props.only || props.only.includes(t.key));
const tab = ref<Tab>(TABS[0].key);
const entries = ref<HbEntry[]>([]);
const emNames = ref<Record<string, string>>({});
const q = ref("");
const selected = ref<HbEntry | null>(null);

async function reload() {
  entries.value = visibleEntries(await loadHandbook());
  emNames.value = Object.fromEntries((await loadEmergencyCards()).map(c => [c.uid, c.name]));
  if (selected.value) selected.value = entries.value.find(e => e.uid === selected.value!.uid) ?? null;
  else if (props.open) openItem(props.open);
}
/** 開啟指定條目（切到它所在的分頁） */
function openItem(id: string) {
  const e = entries.value.find(x => x.uid === id);
  if (e && TABS.some(t => t.key === e.spec.section)) { tab.value = e.spec.section; selected.value = e; return; }
}
watch(() => props.open, id => { if (id) openItem(id); });
onMounted(reload);
onTableSynced(HB_TABLE, reload);

const list = computed(() => searchHandbook(entries.value.filter(e => e.spec.section === tab.value), q.value));
function setTab(t: Tab) { tab.value = t; selected.value = null; }

</script>

<template>
  <div class="flex flex-col h-full gap-3">
    <div v-if="TABS.length > 1" class="flex items-center gap-2">
      <button v-for="t in TABS" :key="t.key" @click="setTab(t.key)" class="px-4 py-2 rounded-lg text-sm font-bold"
        :class="tab === t.key ? 'bg-accent text-white' : 'bg-surface border border-hairline text-fg-secondary hover:text-fg'">{{ t.label }}</button>
    </div>

    <div class="flex-1 flex gap-4 overflow-hidden">
      <div class="w-64 shrink-0 bg-surface rounded-xl border border-hairline p-2 flex flex-col gap-2">
        <input v-model="q" placeholder="搜尋" class="px-3 py-2 rounded-lg bg-sunken border border-hairline text-xs" />
        <div class="flex-1 overflow-y-auto">
          <button v-for="e in list" :key="e.uid" @click="selected = e" class="w-full text-left px-3 py-2.5 rounded-lg text-sm"
            :class="selected?.uid === e.uid ? 'bg-accent/10 text-accent font-bold' : 'text-fg-secondary hover:text-fg'">
            {{ e.name }}<span class="block text-2xs text-muted">{{ e.spec.category }}</span>
          </button>
          <p v-if="!list.length" class="text-xs text-muted text-center py-8">{{ tab === 'admin' ? '院內流程尚未填寫（到「資料管理 › 工作手冊」編輯）' : '沒有符合的條目' }}</p>
        </div>
      </div>

      <div class="flex-1 bg-surface rounded-xl border border-hairline p-5 overflow-y-auto">
        <p v-if="!selected" class="h-full flex items-center justify-center text-sm text-muted">從左側選擇條目</p>
        <div v-else class="space-y-4 max-w-3xl">
          <div class="flex items-center gap-2 flex-wrap">
            <h2 class="text-xl font-black text-fg">{{ selected.name }}</h2>
            <span class="text-2xs px-2 py-0.5 rounded-full" :class="selected.spec.status === 'published' ? 'bg-success/10 text-success' : 'bg-warning/15 text-warning'">{{ STATUS_LABELS[selected.spec.status] }}</span>
            <div class="ml-auto flex flex-wrap gap-1.5">
              <button v-for="(r, i) in selected.spec.refs" :key="r.url" @click="openUrl(r.url)" :title="r.title"
                class="px-2 py-1 rounded-lg bg-accent/10 border border-accent/30 text-accent text-2xs font-bold">📚 [{{ i + 1 }}]</button>
            </div>
          </div>
          <p v-if="selected.spec.status === 'literature'" class="p-3 rounded-xl bg-warning/10 border border-warning/30 text-xs font-bold text-warning">⚠ 依國際指引與教科書整理，尚未經院內審核</p>
          <div v-if="selected.spec.emergency.length" class="flex flex-wrap gap-2">
            <button v-for="u in selected.spec.emergency.filter(x => emNames[x])" :key="u" @click="router.push({ path: '/care', query: { tab: 'value', c: u } })"
              class="px-3 py-1.5 rounded-lg bg-danger/10 border border-danger/30 text-danger text-xs font-bold">🚨 {{ emNames[u] }}</button>
          </div>
          <section v-for="b in selected.spec.blocks.filter(x => x.items.length)" :key="b.title">
            <h3 class="text-sm font-bold text-accent mb-1.5">{{ b.title }}</h3>
            <ul class="space-y-1">
              <li v-for="(it, i) in b.items" :key="i" class="text-sm text-fg flex gap-2"><span class="text-muted">•</span>{{ it }}</li>
            </ul>
          </section>
          <section v-if="selected.spec.dilutions?.length">
            <h3 class="text-sm font-bold text-accent mb-1.5">院內泡法</h3>
            <ul class="space-y-1">
              <li v-for="(d, i) in selected.spec.dilutions" :key="i" class="text-sm text-fg">
                {{ d.drug }}：{{ d.amt }}{{ d.unit === 3 ? " U" : " mg" }} ／ {{ d.vol }} mL（{{ PUMP_UNIT_LABELS[d.unit] }}）<span v-if="d.note" class="text-muted">　{{ d.note }}</span>
              </li>
            </ul>
          </section>
          <p v-if="selected.spec.notes" class="text-xs text-fg-secondary">📝 {{ selected.spec.notes }}</p>
          <div class="border-t border-hairline pt-3 text-2xs text-muted space-y-1">
            <p>依據：{{ selected.spec.source || "—" }}<template v-if="selected.spec.reviewer">　審核：{{ selected.spec.reviewer }}</template></p>
            <p v-for="(r, i) in selected.spec.refs" :key="r.url"><button class="underline hover:text-accent text-left" @click="openUrl(r.url)">[{{ i + 1 }}] {{ r.title }}</button></p>
            <p class="font-bold">{{ DISCLAIMER }}</p>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
