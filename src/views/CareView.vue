<script setup lang="ts">
import { computed, ref, onMounted } from "vue";
import { useRoute, useRouter } from "vue-router";
import SymptomPane from "@/components/care/SymptomPane.vue";
import EmergencyView from "@/views/EmergencyView.vue";
import HandbookView from "@/views/HandbookView.vue";
import ToolsView from "@/views/ToolsView.vue";
import FormulaPanel from "@/components/care/FormulaPanel.vue";
import { ALL_TOOLS, toolById } from "@/shared/tools";
import { FORMULAS } from "@/shared/handbook/formulas";
import { loadHandbook, HB_TABLE } from "@/composables/useHandbook";
import { onTableSynced } from "@/composables/useTableSync";
import { allDilutions, visibleEntries, type HbDilution } from "@/shared/handbook/types";

/**
 * 處置及臨床工具：依症狀、數值判讀、藥物速查、計算工具、手冊，一個入口。
 * 網址：?tab=symptom&e=<手冊 uid>｜value&c=<數值卡 uid>｜drug&e=｜tools&t=<工具 id>｜manual&e=
 */
type Tab = "symptom" | "value" | "drug" | "tools" | "manual";
const TABS: { key: Tab; label: string }[] = [
  { key: "symptom", label: "🩺 依症狀" }, { key: "value", label: "📊 數值判讀" }, { key: "drug", label: "💊 藥物速查" },
  { key: "tools", label: "🧮 計算工具" }, { key: "manual", label: "📘 手冊" },
];
const route = useRoute();
const router = useRouter();
const tab = computed<Tab>(() => (TABS.some(t => t.key === route.query.tab) ? route.query.tab : "symptom") as Tab);
const q = (k: string) => (typeof route.query[k] === "string" ? route.query[k] as string : undefined);
const go = (query: Record<string, string>) => router.replace({ path: "/care", query });

// 計算工具：公式與互動式工具（ABG、FiO₂…）同一份清單
const tool = computed(() => toolById(q("t") ?? "") ?? ALL_TOOLS[0]);
const formula = computed(() => FORMULAS.find(f => f.id === tool.value.id) ?? null);
const dilutions = ref<HbDilution[]>([]);
async function loadDilutions() { dilutions.value = allDilutions(visibleEntries(await loadHandbook())); }
onMounted(loadDilutions);
onTableSynced(HB_TABLE, loadDilutions);
</script>

<template>
  <div class="flex flex-col h-full gap-3 p-5">
    <div class="flex items-center gap-2 flex-wrap">
      <h1 class="text-lg font-black text-fg mr-2">處置及臨床工具</h1>
      <button v-for="t in TABS" :key="t.key" @click="go({ tab: t.key })" class="px-4 py-2 rounded-lg text-sm font-bold"
        :class="tab === t.key ? 'bg-accent text-white' : 'bg-surface border border-hairline text-fg-secondary hover:text-fg'">{{ t.label }}</button>
    </div>

    <SymptomPane v-if="tab === 'symptom'" :open="q('e')"
      @drug="u => go({ tab: 'drug', e: u })" @tool="id => go({ tab: 'tools', t: id })" />
    <EmergencyView v-else-if="tab === 'value'" class="flex-1" />
    <HandbookView v-else-if="tab === 'drug'" :only="['drug']" :open="q('e')" class="flex-1" />
    <HandbookView v-else-if="tab === 'manual'" :only="['surgical', 'admin']" :open="q('e')" class="flex-1" />
    <div v-else class="flex-1 flex gap-4 overflow-hidden">
      <div class="w-64 shrink-0 bg-surface rounded-xl border border-hairline p-2 overflow-y-auto">
        <button v-for="t in ALL_TOOLS" :key="t.id" @click="go({ tab: 'tools', t: t.id })" class="w-full text-left px-3 py-2.5 rounded-lg text-sm"
          :class="tool.id === t.id ? 'bg-accent/10 text-accent font-bold' : 'text-fg-secondary hover:text-fg'">
          {{ t.name }}<span class="block text-2xs text-muted truncate">{{ t.desc }}</span>
        </button>
      </div>
      <FormulaPanel v-if="formula" :formula="formula" :presets="dilutions" class="flex-1" />
      <ToolsView v-else :initial="tool.calcId" single class="flex-1" />
    </div>
  </div>
</template>
