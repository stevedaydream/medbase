<script setup lang="ts">
import { computed, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import PrescriptionsView from "@/views/PrescriptionsView.vue";
import SurgeryView from "@/views/SurgeryView.vue";
import DiseaseView from "@/views/DiseaseView.vue";
import ExaminationView from "@/views/ExaminationView.vue";
import SetsView from "@/views/SetsView.vue";

/**
 * 套組管理：處方套組、手術處置、疾病常規、檢查處置、品項套組以分頁標籤合併。
 * 分頁記在網址 ?tab=，舊網址（/prescriptions 等）由 router 轉址到對應分頁。
 * KeepAlive 保留各分頁的選取與搜尋狀態。
 */
const TABS = [
  { key: "prescriptions", label: "處方套組", icon: "📋", component: PrescriptionsView },
  { key: "surgery",       label: "手術處置", icon: "🔪", component: SurgeryView },
  { key: "disease",       label: "疾病常規", icon: "🏥", component: DiseaseView },
  { key: "examination",   label: "檢查處置", icon: "🔬", component: ExaminationView },
  { key: "sets",          label: "品項套組", icon: "🗂️", component: SetsView },
] as const;
type TabKey = (typeof TABS)[number]["key"];

const STORAGE_KEY = "sets-hub-tab";
const route = useRoute();
const router = useRouter();

function isTab(v: unknown): v is TabKey {
  return TABS.some(t => t.key === v);
}

function lastTab(): TabKey {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (isTab(v)) return v;
  } catch { /* 無法存取時用預設 */ }
  return "prescriptions";
}

const active = computed<TabKey>(() => (isTab(route.query.tab) ? route.query.tab : lastTab()));
const activeComponent = computed(() => TABS.find(t => t.key === active.value)!.component);

function select(key: TabKey) {
  if (key !== route.query.tab) router.replace({ query: { ...route.query, tab: key } });
}

watch(active, (key) => {
  try { localStorage.setItem(STORAGE_KEY, key); } catch { /* 忽略 */ }
}, { immediate: true });
</script>

<template>
  <div class="flex flex-col h-full gap-3">
    <div class="shrink-0 flex gap-1 rounded-2xl bg-surface border border-hairline p-1 overflow-x-auto no-scrollbar" role="tablist">
      <button v-for="t in TABS" :key="t.key" @click="select(t.key)"
        role="tab" :aria-selected="active === t.key"
        class="shrink-0 flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-bold transition-colors cursor-pointer"
        :class="active === t.key ? 'bg-accent/15 text-accent' : 'text-muted hover:text-fg-secondary hover:bg-overlay/5'">
        <span class="text-base leading-none">{{ t.icon }}</span>
        {{ t.label }}
      </button>
    </div>
    <div class="flex-1 min-h-0">
      <KeepAlive>
        <component :is="activeComponent" :key="active" />
      </KeepAlive>
    </div>
  </div>
</template>

<style scoped>
.no-scrollbar::-webkit-scrollbar { display: none; }
.no-scrollbar { scrollbar-width: none; }
</style>
