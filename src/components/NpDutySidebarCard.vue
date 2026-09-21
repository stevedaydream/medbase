<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { loadNpDuty, localDateKey, NP_DUTY_UPDATED_EVENT, type NpDutyAssignment } from "@/composables/useNpDuty";

const rows = ref<NpDutyAssignment[]>([]);
const loaded = ref(false);
const today = ref(localDateKey());
let timer: ReturnType<typeof setInterval> | null = null;

const displayDate = computed(() => {
  const [, month, day] = today.value.split("-");
  return `${Number(month)}/${Number(day)}`;
});

function wardRows(ward: NpDutyAssignment["ward"]) {
  return rows.value.filter(row => row.ward === ward);
}

function shiftLabel(shift: string): string {
  if (shift === "白八") return "白";
  if (shift === "夜八") return "夜";
  return shift;
}

async function refresh() {
  const nextToday = localDateKey();
  today.value = nextToday;
  try {
    rows.value = await loadNpDuty(nextToday);
  } catch {
    rows.value = [];
  } finally {
    loaded.value = true;
  }
}

function onUpdated() { refresh(); }

onMounted(() => {
  refresh();
  window.addEventListener(NP_DUTY_UPDATED_EVENT, onUpdated);
  timer = setInterval(refresh, 60_000);
});

onUnmounted(() => {
  window.removeEventListener(NP_DUTY_UPDATED_EVENT, onUpdated);
  if (timer) clearInterval(timer);
});
</script>

<template>
  <section class="mt-3 rounded-xl border border-accent/20 bg-accent/[0.05] p-2.5" aria-label="今日 NP 值班">
    <div class="flex items-center justify-between mb-2">
      <span class="text-xs font-bold text-fg">今日值班 NP</span>
      <span class="text-2xs font-bold text-accent tabular-nums">{{ displayDate }}</span>
    </div>

    <div v-if="loaded" class="space-y-1.5">
      <div v-for="ward in (['9A', '9B', '8A'] as const)" :key="ward" class="flex items-start gap-2 text-xs">
        <span class="w-6 shrink-0 rounded bg-accent/10 py-0.5 text-center font-bold text-accent">{{ ward }}</span>
        <div v-if="wardRows(ward).length" class="min-w-0 flex-1 space-y-0.5">
          <div
            v-for="person in wardRows(ward)"
            :key="`${person.id}-${person.shift}`"
            class="flex min-w-0 items-baseline gap-1"
            :title="person.extension ? `${person.np_name} 分機 ${person.extension}` : person.np_name"
          >
            <span class="shrink-0 text-2xs font-bold text-muted">{{ shiftLabel(person.shift) }}</span>
            <span class="truncate font-semibold text-fg-secondary">{{ person.np_name }}</span>
          </div>
        </div>
        <span v-else class="py-0.5 text-xs text-muted">未排／未匯入</span>
      </div>
    </div>
    <div v-else class="text-xs text-muted">讀取中…</div>
  </section>
</template>
