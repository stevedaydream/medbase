<script setup lang="ts">
import { ref, computed, watch } from "vue";
import { useSchedStore, personById } from "@/composables/useSchedStore";
import { RULE_LABELS, type Issue, type RuleCode } from "@/utils/sched/engine/validate";
import type { CellRef } from "@/composables/useGridEditor";
import QuotaPreview from "./QuotaPreview.vue";

const props = defineProps<{ ym: string; issues: Issue[]; focus: CellRef | null }>();
const emit = defineEmits<{ goto: [cell: CellRef] }>();
const store = useSchedStore();

type Tab = "issues" | "quota" | "log";
const tab = ref<Tab>("issues");
const onlyCell = ref(false);
watch(() => props.focus, () => { if (onlyCell.value && !props.focus) onlyCell.value = false; });

const grouped = computed(() => {
  const g = new Map<RuleCode, Issue[]>();
  for (const i of props.issues) {
    if (!g.has(i.rule)) g.set(i.rule, []);
    g.get(i.rule)!.push(i);
  }
  return [...g.entries()].sort(([a], [b]) => Number(a.slice(1)) - Number(b.slice(1)));
});
const collapsed = ref(new Set<RuleCode>());
function toggle(r: RuleCode) {
  const s = new Set(collapsed.value);
  if (s.has(r)) s.delete(r); else s.add(r);
  collapsed.value = s;
}
function go(i: Issue) {
  if (i.personId && i.day) emit("goto", { personId: i.personId, day: i.day });
}

const focusLabel = computed(() => {
  const f = props.focus;
  if (!f) return "";
  return `${personById(f.personId)?.name ?? ""} ${Number(props.ym.slice(4))}/${f.day}`;
});
const logs = computed(() => {
  const entries = [...(store.logs[props.ym]?.entries ?? [])].reverse();
  if (!onlyCell.value || !props.focus) return entries;
  const nm = personById(props.focus.personId)?.name ?? "";
  const md = `${Number(props.ym.slice(4))}/${props.focus.day}`;
  return entries.filter(e => e.detail.includes(`${nm} ${md} `) || e.detail.includes(`${nm} ${md}`));
});
function when(iso: string) {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

defineExpose({ showLog: () => { tab.value = "log"; onlyCell.value = true; } });
</script>

<template>
  <div class="h-full flex flex-col bg-surface border-l border-hairline text-xs">
    <div class="flex border-b border-hairline flex-shrink-0">
      <button v-for="t in ([['issues', `問題 ${issues.length}`], ['quota', '配額'], ['log', '操作紀錄']] as const)" :key="t[0]"
        class="flex-1 py-2 border-b-2 -mb-px"
        :class="tab === t[0] ? 'border-accent text-fg font-semibold' : 'border-transparent text-muted hover:text-fg-secondary'"
        @click="tab = t[0]">{{ t[1] }}</button>
    </div>

    <div class="flex-1 overflow-y-auto">
      <!-- 問題清單 -->
      <div v-if="tab === 'issues'" class="p-2 space-y-2">
        <div v-if="!issues.length" class="p-4 text-center text-success">沒有違規 ✓</div>
        <div v-for="[rule, list] in grouped" :key="rule" class="border border-hairline rounded">
          <button class="w-full flex items-center gap-2 px-2 py-1.5 bg-elevated hover:bg-raised" @click="toggle(rule)">
            <span class="text-danger font-semibold">{{ RULE_LABELS[rule] }}</span>
            <span class="ml-auto text-muted">{{ list.length }}</span>
          </button>
          <div v-if="!collapsed.has(rule)">
            <button v-for="(i, k) in list" :key="k" class="w-full text-left px-2 py-1 border-t border-hairline hover:bg-elevated text-fg-secondary"
              :class="i.personId && i.day ? '' : 'cursor-default'" @click="go(i)">{{ i.message }}</button>
          </div>
        </div>
      </div>

      <!-- 配額 -->
      <div v-else-if="tab === 'quota'" class="p-2">
        <QuotaPreview :ym="ym" />
        <p class="mt-2 text-muted leading-relaxed">V＝本月餘數起點、X＝最後一個多拿的人；下個月 V＝X 的下一位。</p>
      </div>

      <!-- 操作紀錄 -->
      <div v-else class="p-2 space-y-1">
        <label v-if="focus" class="flex items-center gap-1 px-1 pb-1 text-fg-secondary">
          <input v-model="onlyCell" type="checkbox" /> 只看 {{ focusLabel }}
        </label>
        <div v-if="!logs.length" class="p-4 text-center text-muted">沒有紀錄</div>
        <div v-for="(e, k) in logs" :key="k" class="px-2 py-1.5 rounded bg-elevated">
          <div class="flex items-center gap-1.5">
            <span>{{ e.actor === "system" ? "🤖" : "👤" }}</span>
            <span class="font-semibold text-fg">{{ e.action }}</span>
            <span class="text-muted">{{ e.actor === "system" ? "系統" : e.actor }}</span>
            <span class="ml-auto text-muted tabular-nums">{{ when(e.at) }}</span>
          </div>
          <div class="text-fg-secondary mt-0.5 break-all leading-relaxed">{{ e.detail }}</div>
        </div>
      </div>
    </div>
  </div>
</template>
