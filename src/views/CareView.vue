<script setup lang="ts">
import { computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import SymptomPane from "@/components/care/SymptomPane.vue";
import EmergencyView from "@/views/EmergencyView.vue";
import HandbookView from "@/views/HandbookView.vue";
import ToolsView from "@/views/ToolsView.vue";
import { toolById } from "@/shared/tools";

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

// 計算工具：公式（手冊公式）或互動式工具（原臨床工具）
const tool = computed(() => toolById(q("t") ?? ""));
const toolKind = computed(() => tool.value?.kind ?? (q("k") === "formula" ? "formula" : "calc"));
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
    <template v-else>
      <div class="flex gap-2">
        <button v-for="k in (['calc', 'formula'] as const)" :key="k" @click="go({ tab: 'tools', k })" class="px-3 py-1.5 rounded-lg text-xs font-bold border"
          :class="toolKind === k ? 'bg-accent/10 text-accent border-accent/40' : 'bg-surface border-hairline text-fg-secondary'">{{ k === "calc" ? "互動工具" : "公式計算" }}</button>
      </div>
      <ToolsView v-if="toolKind === 'calc'" :initial="tool?.calcId" class="flex-1" />
      <HandbookView v-else :only="['formula']" :open="tool?.id" class="flex-1" />
    </template>
  </div>
</template>
