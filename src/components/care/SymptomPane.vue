<script setup lang="ts">
import { ref, computed, onMounted, watch } from "vue";
import { openUrl } from "@tauri-apps/plugin-opener";
import { loadHandbook, HB_TABLE } from "@/composables/useHandbook";
import { loadEmergencyCards, EM_TABLE } from "@/composables/useEmergency";
import { onTableSynced } from "@/composables/useTableSync";
import EmergencyCardPanel from "@/components/emergency/EmergencyCardPanel.vue";
import TherapyList from "@/components/care/TherapyList.vue";
import { STATUS_LABELS, searchHandbook, visibleEntries, type HbEntry } from "@/shared/handbook/types";
import { visibleCards } from "@/shared/emergency/logic";
import { DISCLAIMER, type EmCard } from "@/shared/emergency/types";
import { toolById } from "@/shared/tools";

/** 依症狀（處置及臨床工具）：值班步驟＋數值判讀＋相關藥物＋相關工具，同一頁 */
const props = defineProps<{ open?: string }>();
const emit = defineEmits<{ drug: [uid: string]; tool: [id: string] }>();

const entries = ref<HbEntry[]>([]);
const cards = ref<EmCard[]>([]);
const q = ref("");
const selected = ref<HbEntry | null>(null);
const cardTab = ref("");

async function reload() {
  const all = visibleEntries(await loadHandbook());
  entries.value = all;
  cards.value = visibleCards(await loadEmergencyCards());
  if (selected.value) selected.value = all.find(e => e.uid === selected.value!.uid) ?? null;
  else if (props.open) pick(all.find(e => e.uid === props.open) ?? null);
}
onMounted(reload);
onTableSynced(HB_TABLE, reload);
onTableSynced(EM_TABLE, reload);
watch(() => props.open, id => { if (id) pick(entries.value.find(e => e.uid === id) ?? null); });

const symptoms = computed(() => searchHandbook(entries.value.filter(e => e.spec.section === "oncall"), q.value));
const drugNames = computed(() => Object.fromEntries(entries.value.filter(e => e.spec.section === "drug").map(e => [e.uid, e.name])));
const linkedCards = computed(() => (selected.value?.spec.emergency ?? []).map(u => cards.value.find(c => c.uid === u)).filter((c): c is EmCard => !!c));
const activeCard = computed(() => linkedCards.value.find(c => c.uid === cardTab.value) ?? linkedCards.value[0] ?? null);

function pick(e: HbEntry | null) {
  selected.value = e;
  cardTab.value = "";
}
</script>

<template>
  <div class="flex-1 flex gap-4 overflow-hidden">
    <div class="w-64 shrink-0 bg-surface rounded-xl border border-hairline p-2 flex flex-col gap-2">
      <input v-model="q" placeholder="搜尋症狀（例：喘、發燒、K）" class="px-3 py-2 rounded-lg bg-sunken border border-hairline text-xs" />
      <div class="flex-1 overflow-y-auto">
        <button v-for="e in symptoms" :key="e.uid" @click="pick(e)" class="w-full text-left px-3 py-2.5 rounded-lg text-sm"
          :class="selected?.uid === e.uid ? 'bg-accent/10 text-accent font-bold' : 'text-fg-secondary hover:text-fg'">
          {{ e.name }}<span class="block text-xs text-muted">{{ e.spec.category }}</span>
        </button>
        <p v-if="!symptoms.length" class="text-xs text-muted text-center py-8">沒有符合的症狀</p>
      </div>
    </div>

    <div class="flex-1 overflow-y-auto">
      <p v-if="!selected" class="h-full flex items-center justify-center text-sm text-muted">從左側選擇症狀</p>
      <div v-else class="space-y-4 max-w-4xl">
        <div class="flex items-center gap-2 flex-wrap">
          <h2 class="text-xl font-black text-fg">{{ selected.name }}</h2>
          <span class="text-2xs px-2 py-0.5 rounded-full" :class="selected.spec.status === 'published' ? 'bg-success/10 text-success' : 'bg-warning/15 text-warning'">{{ STATUS_LABELS[selected.spec.status] }}</span>
        </div>

        <!-- 相關藥物與工具 -->
        <div v-if="selected.spec.drugs.length || selected.spec.tools.length" class="flex flex-wrap gap-2">
          <button v-for="u in selected.spec.drugs.filter(x => drugNames[x])" :key="u" @click="emit('drug', u)"
            class="px-3 py-1.5 rounded-lg bg-accent/10 border border-accent/30 text-accent text-xs font-bold">💊 {{ drugNames[u] }}</button>
          <button v-for="t in selected.spec.tools.filter(x => toolById(x))" :key="t" @click="emit('tool', t)"
            class="px-3 py-1.5 rounded-lg bg-sunken border border-hairline text-fg-secondary text-xs font-bold hover:text-fg">🧮 {{ toolById(t)!.name }}</button>
        </div>

        <!-- 處置步驟 -->
        <div class="bg-surface rounded-xl border border-hairline p-5 space-y-4">
          <p v-if="selected.spec.status === 'literature'" class="text-xs font-bold text-warning">⚠ 依國際指引與教科書整理，尚未經院內審核</p>
          <section v-for="b in selected.spec.blocks.filter(x => x.items.length)" :key="b.title">
            <h3 class="text-sm font-bold text-accent mb-1.5">{{ b.title }}</h3>
            <ul class="space-y-1">
              <li v-for="(it, i) in b.items" :key="i" class="text-sm text-fg flex gap-2"><span class="text-muted">•</span>{{ it }}</li>
            </ul>
          </section>
          <p v-if="selected.spec.notes" class="text-xs text-fg-secondary">📝 {{ selected.spec.notes }}</p>
          <div class="border-t border-hairline pt-3 text-2xs text-muted space-y-1">
            <p v-for="(r, i) in selected.spec.refs" :key="r.url"><button class="underline hover:text-accent text-left" @click="openUrl(r.url)">📚 [{{ i + 1 }}] {{ r.title }}</button></p>
            <p class="font-bold">{{ DISCLAIMER }}</p>
          </div>
        </div>

        <!-- 用藥建議 -->
        <div v-if="selected.spec.therapy?.length" class="bg-surface rounded-xl border border-hairline p-5">
          <TherapyList :therapy="selected.spec.therapy" :refs="selected.spec.refs" />
        </div>

        <!-- 數值判讀（直接在這頁輸入） -->
        <div v-if="linkedCards.length" class="bg-surface rounded-xl border border-hairline p-5 space-y-3">
          <div class="flex items-center gap-2 flex-wrap">
            <h3 class="text-sm font-black text-fg">📊 數值判讀</h3>
            <button v-for="c in linkedCards" :key="c.uid" @click="cardTab = c.uid" class="px-3 py-1 rounded-lg text-xs font-bold border"
              :class="activeCard?.uid === c.uid ? 'bg-accent text-white border-accent' : 'bg-sunken border-hairline text-fg-secondary'">{{ c.name }}</button>
          </div>
          <EmergencyCardPanel v-if="activeCard" :card="activeCard" />
        </div>
      </div>
    </div>
  </div>
</template>
