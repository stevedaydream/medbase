<script setup lang="ts">
import { ref, computed, watch } from "vue";
import { useSchedStore, personById } from "@/composables/useSchedStore";
import { RULE_LABELS, type Issue, type RuleCode } from "@/shared/sched/engine/validate";
import type { CellRef } from "@/composables/useGridEditor";
import QuotaPreview from "./QuotaPreview.vue";
import { deleteSwap, settleDebt, removePrefillSwap } from "@/composables/useSchedFlow";
import { useSchedSession } from "@/composables/useSchedSession";

const props = defineProps<{ ym: string; issues: Issue[]; focus: CellRef | null }>();
const emit = defineEmits<{ goto: [cell: CellRef] }>();
const store = useSchedStore();

type Tab = "issues" | "quota" | "swap" | "change" | "log";
const session = useSchedSession();
const isStaff = computed(() => session.role !== "employee");
const month = computed(() => store.months[props.ym]);
const nm = (id: string | null | undefined) => personById(id)?.name ?? "?";
const inRoster = computed(() => new Set(month.value?.roster.map(r => r.personId)));
const openDebts = computed(() => store.debts.filter(d => !d.settledAt && d.qty > 0 && (inRoster.value.has(d.from) || inRoster.value.has(d.to))));
const itemName = (id: string) => store.quotaItems.find(i => i.id === id)?.name ?? id;
const settleNote = ref("");
const prefillGroups = computed(() => {
  const g = new Map<string, { group: string; days: string; code: string; from: string; to: string; note: string }>();
  for (const x of month.value?.prefillSwaps ?? []) {
    const cur = g.get(x.group);
    const d = `${Number(props.ym.slice(4))}/${x.day}`;
    if (cur) cur.days += `、${d}`;
    else g.set(x.group, { group: x.group, days: d, code: x.code, from: x.from, to: x.to, note: x.note });
  }
  return [...g.values()];
});
async function onSettle(id: string) { await settleDebt(id, settleNote.value.trim()); settleNote.value = ""; }
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
      <button v-for="t in ([['issues', `問題 ${issues.length}`], ['quota', '配額'], ['swap', '換班'], ['change', '異動'], ['log', '紀錄']] as const)" :key="t[0]"
        class="flex-1 py-2 border-b-2 -mb-px whitespace-nowrap"
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

      <!-- 換班與欠班 -->
      <div v-else-if="tab === 'swap'" class="p-2 space-y-3">
        <div v-if="month?.prefillSwaps?.length">
          <div class="font-semibold text-fg mb-1">預填換人{{ month.status === 'open' ? "" : "（已於開始排班轉為換班）" }}</div>
          <div v-for="g in prefillGroups" :key="g.group" class="px-2 py-1.5 rounded bg-elevated mb-1">
            <div class="flex items-center gap-1">
              <span class="text-fg">{{ g.days }} {{ g.code }}：{{ nm(g.from) }} → {{ nm(g.to) }}</span>
              <button v-if="isStaff && month.status === 'open'" class="ml-auto text-muted hover:text-danger" @click="removePrefillSwap(ym, g.group)">取消</button>
            </div>
            <div v-if="g.note" class="text-muted">{{ g.note }}</div>
          </div>
        </div>
        <div>
          <div class="font-semibold text-fg mb-1">本月換班</div>
          <div v-if="!month?.swaps?.length" class="text-muted px-1">沒有換班（在格子上按右鍵建立）</div>
          <div v-for="sw in month?.swaps ?? []" :key="sw.id" class="px-2 py-1.5 rounded bg-elevated mb-1">
            <div class="flex items-center gap-1">
              <span class="text-fg">{{ Number(ym.slice(4)) }}/{{ sw.day }} {{ nm(sw.a) }} {{ sw.aCode || "空白" }} ⇄ {{ nm(sw.b) }} {{ sw.bCode || "空白" }}</span>
              <button v-if="isStaff" class="ml-auto text-muted hover:text-danger" @click="deleteSwap(ym, sw.id)">刪除</button>
            </div>
            <div v-if="sw.note" class="text-muted">{{ sw.note }}</div>
          </div>
        </div>
        <div>
          <div class="font-semibold text-fg mb-1">未平的欠班</div>
          <div v-if="!openDebts.length" class="text-muted px-1">沒有欠班</div>
          <div v-for="d in openDebts" :key="d.id" class="px-2 py-1.5 rounded bg-elevated mb-1">
            <div class="flex items-center gap-1">
              <span class="text-fg">{{ nm(d.from) }} 欠 {{ nm(d.to) }} {{ itemName(d.item) }} ×{{ d.qty }}</span>
              <span class="text-muted">（{{ d.ym }}）</span>
            </div>
            <div v-if="isStaff" class="flex items-center gap-1 mt-1">
              <input v-model="settleNote" placeholder="平帳備註" class="sched-input flex-1" />
              <button class="px-2 py-0.5 border border-hairline rounded hover:bg-raised" @click="onSettle(d.id)">平帳</button>
            </div>
          </div>
        </div>
      </div>

      <!-- 發布後異動 -->
      <div v-else-if="tab === 'change'" class="p-2 space-y-1">
        <div v-if="!month?.changeLog?.length" class="p-4 text-center text-muted">發布後沒有異動</div>
        <div v-for="(c, k) in [...(month?.changeLog ?? [])].reverse()" :key="k" class="px-2 py-1.5 rounded bg-elevated">
          <div class="flex items-center gap-1.5">
            <span class="font-semibold text-fg">{{ nm(c.personId) }} {{ Number(ym.slice(4)) }}/{{ c.day }}</span>
            <span class="text-fg-secondary">{{ c.from || "空白" }} → {{ c.to || "空白" }}</span>
            <span class="ml-auto text-muted tabular-nums">{{ when(c.at) }}</span>
          </div>
          <div class="text-fg-secondary">{{ c.reason }}<span v-if="c.approved" class="text-warning">（核准偏離）</span>　<span class="text-muted">{{ c.by }}</span></div>
        </div>
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
