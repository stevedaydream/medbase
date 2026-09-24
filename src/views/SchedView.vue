<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from "vue";
import { ensureSchedLoaded, useSchedStore } from "@/composables/useSchedStore";
import { useSchedSession } from "@/composables/useSchedSession";
import PeopleTab from "@/components/sched/PeopleTab.vue";
import SettingsTab from "@/components/sched/SettingsTab.vue";
import ImportTab from "@/components/sched/ImportTab.vue";
import RotaTab from "@/components/sched/RotaTab.vue";
import ScheduleTab from "@/components/sched/ScheduleTab.vue";
import "@/components/sched/sched.css";

type TabKey = "schedule" | "rota" | "people" | "settings" | "import";
const TABS: { key: TabKey; label: string; superOnly?: boolean }[] = [
  { key: "schedule", label: "班表" },
  { key: "rota",     label: "月份與輪值" },
  { key: "people",   label: "人員名單" },
  { key: "settings", label: "班別與規則" },
  { key: "import",   label: "Excel 匯入", superOnly: true },
];

const store = useSchedStore();
const session = useSchedSession();
const isSuper = computed(() => session.role === "super");
const visibleTabs = computed(() => TABS.filter(t => !t.superOnly || isSuper.value));
const tab = ref<TabKey>("schedule");
const loadError = ref("");

const toast = ref("");
let toastTimer: ReturnType<typeof setTimeout> | null = null;
function showToast(msg: string) {
  toast.value = msg;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.value = ""; }, 2500);
}
onUnmounted(() => { if (toastTimer) clearTimeout(toastTimer); });

onMounted(async () => {
  try {
    await ensureSchedLoaded();
  } catch (e) {
    loadError.value = `載入排班資料失敗：${(e as Error).message}`;
  }
});
</script>

<template>
  <div class="h-full flex flex-col overflow-hidden bg-surface">
    <div class="flex items-center gap-1 px-3 border-b border-hairline flex-shrink-0">
      <button v-for="t in visibleTabs" :key="t.key"
        class="text-xs px-3 py-2 border-b-2 -mb-px transition-colors"
        :class="tab === t.key ? 'border-accent text-fg font-semibold' : 'border-transparent text-muted hover:text-fg-secondary'"
        @click="tab = t.key">{{ t.label }}</button>
    </div>

    <div v-if="loadError" class="p-6 text-sm text-danger">{{ loadError }}</div>
    <div v-else-if="!store.loaded" class="p-6 text-sm text-muted">載入中…</div>
    <div v-else class="flex-1 overflow-hidden">
      <ScheduleTab v-if="tab === 'schedule'" @toast="showToast" />
      <RotaTab v-else-if="tab === 'rota'" @toast="showToast" />
      <PeopleTab v-else-if="tab === 'people'" @toast="showToast" />
      <SettingsTab v-else-if="tab === 'settings'" :can-edit="isSuper" @toast="showToast" />
      <ImportTab v-else-if="tab === 'import'" @toast="showToast" />
    </div>

    <div v-if="toast"
      class="fixed bottom-4 right-4 z-50 px-4 py-2 bg-elevated text-fg text-sm rounded-lg shadow-lg border border-hairline">
      {{ toast }}
    </div>
  </div>
</template>
