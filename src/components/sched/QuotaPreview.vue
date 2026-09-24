<script setup lang="ts">
import { computed } from "vue";
import { useSchedStore, personById } from "@/composables/useSchedStore";
import { computeQuotas } from "@/utils/sched/engine/quota";
import { cellFnOf } from "@/utils/sched/engine/prefill";
import { FLAG_DEFS, type Flags } from "@/utils/sched/types";

const props = defineProps<{ ym: string }>();
const store = useSchedStore();

const month = computed(() => store.months[props.ym]);
const items = computed(() => store.quotaItems.filter(i => i.enabled));
const result = computed(() => {
  const m = month.value;
  if (!m) return null;
  // 已發布：顯示定案配額；其餘即時計算
  if (m.status === "published" && m.frozenQuotas) {
    return { quotas: m.frozenQuotas, markers: m.markers, totals: null as Record<string, number> | null };
  }
  const r = computeQuotas({
    month: m, holidays: store.holidays, shifts: store.shifts, items: store.quotaItems,
    cell: cellFnOf(m, store.prebooks[props.ym]),
  });
  return { quotas: r.quotas, markers: r.markers, totals: r.totals };
});

function mark(itemId: string, personId: string): string {
  const mk = result.value?.markers[itemId];
  if (!mk) return "";
  const v = mk.v === personId, x = mk.x === personId;
  return v && x ? "VX" : v ? "V" : x ? "X" : "";
}
const flagShort = (f: Flags) => FLAG_DEFS.filter(d => d.key !== "active" && f[d.key]).map(d => d.short).join(" ");
</script>

<template>
  <div v-if="month && result">
    <table class="text-xs">
      <thead class="text-muted text-left">
        <tr>
          <th class="px-2 py-1">人員</th>
          <th class="px-2">旗標</th>
          <th v-for="it in items" :key="it.id" class="px-2 text-center">
            {{ it.name }}<span v-if="result.totals" class="text-muted font-normal">（{{ result.totals[it.id] }}）</span>
          </th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="r in month.roster" :key="r.personId" class="border-t border-hairline" :class="r.flags.active ? '' : 'opacity-40'">
          <td class="px-2 py-1 whitespace-nowrap">{{ personById(r.personId)?.name }}</td>
          <td class="px-2 text-muted whitespace-nowrap">{{ r.flags.active ? flagShort(r.flags) : "非在職" }}</td>
          <td v-for="it in items" :key="it.id" class="px-2 text-center tabular-nums">
            <template v-if="r.flags.active">
              {{ result.quotas[r.personId]?.[it.id] ?? 0 }}
              <span v-if="mark(it.id, r.personId)" class="ml-0.5 text-accent font-semibold">{{ mark(it.id, r.personId) }}</span>
            </template>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
