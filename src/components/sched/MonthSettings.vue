<script setup lang="ts">
import { ref, computed } from "vue";
import {
  useSchedStore, personById, saveMonth, appendLog, actorName, recompute,
} from "@/composables/useSchedStore";
import { computeQuotas, handoverV, isEligible } from "@/shared/sched/engine/quota";
import { cellFnOf, applyWeekendFirst } from "@/shared/sched/engine/prefill";
import { nextInOrder } from "@/shared/sched/engine/rotation";
import {
  FLAG_DEFS, DAY_TYPES, emptyFlags, clone, type FlagKey, type StaffingTable, type RosterEntry,
} from "@/shared/sched/types";
import { daysIn, nextYm, prevYm } from "@/shared/sched/calendar";

const props = defineProps<{ ym: string }>();
const emit = defineEmits<{ close: []; toast: [msg: string] }>();
const store = useSchedStore();
const month = computed(() => store.months[props.ym]);
const readonly = computed(() => month.value?.status === "published");
const tab = ref<"roster" | "staffing" | "start">("roster");
const NEEDS = ["D", "N", "S1"] as const;

/** 目前名單的單位（例：9A、9B），同單位的人排在加入選單前面 */
const units = computed(() => new Set((month.value?.roster ?? []).map(r => personById(r.personId)?.unit ?? "")));
const candidates = computed(() => {
  const inRoster = new Set(month.value?.roster.map(r => r.personId));
  return [...store.people].filter(p => p.active && !inRoster.has(p.id)).sort((a, b) =>
    (units.value.has(a.unit) ? 0 : 1) - (units.value.has(b.unit) ? 0 : 1) || a.order - b.order);
});
const addId = ref("");

let timer: ReturnType<typeof setTimeout> | null = null;
const pending: string[] = [];
function persist(detail: string) {
  pending.push(detail);
  if (timer) clearTimeout(timer);
  timer = setTimeout(async () => {
    const m = month.value;
    if (!m) return;
    const details = pending.splice(0).join("；");
    try {
      // 排班中：人員與人力影響配額，即時更新 X
      if (m.status === "scheduling") {
        const q = computeQuotas({ month: m, holidays: store.holidays, shifts: store.shifts, items: store.quotaItems, cell: cellFnOf(m, store.prebooks[m.ym]) });
        for (const [k, mk] of Object.entries(q.markers)) m.markers[k] = mk;
      }
      await saveMonth(m);
      await appendLog(m.ym, "本月設定", details, actorName());
      const from = m.status === "open" ? m.ym : nextYm(m.ym);
      const r = await recompute(from, `${m.ym} 本月設定變更（${details}）`);
      if (r.notices) emit("toast", `已重算，覆蓋 ${r.notices} 筆預班並通知`);
    } catch (e) {
      emit("toast", `儲存失敗：${(e as Error).message}`);
    }
  }, 500);
}

const nm = (r: RosterEntry) => personById(r.personId)?.name ?? "?";
function move(i: number, delta: number) {
  const list = month.value!.roster, j = i + delta;
  if (j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
  persist(`${nm(list[j])} 順序移到第 ${j + 1}`);
}
function toggleFlag(r: RosterEntry, k: FlagKey) {
  r.flags[k] = !r.flags[k];
  const label = FLAG_DEFS.find(f => f.key === k)!.label;
  persist(`${nm(r)} ${label}：${r.flags[k] ? "是" : "否"}`);
}
function addPerson() {
  const m = month.value;
  if (!m || !addId.value) return;
  m.roster.push({ personId: addId.value, flags: emptyFlags() });
  m.schedule[addId.value] ??= Array(daysIn(m.ym)).fill("");
  m.origin[addId.value] ??= Array(daysIn(m.ym)).fill("");
  persist(`加入 ${personById(addId.value)?.name}`);
  addId.value = "";
}
function removePerson(i: number) {
  const m = month.value!;
  const r = m.roster[i];
  const hasShifts = (m.schedule[r.personId] ?? []).some(Boolean);
  if (hasShifts && m.status !== "open") {
    emit("toast", `${nm(r)} 本月已有排班，請改為取消「在職」`);
    return;
  }
  m.roster.splice(i, 1);
  persist(`移除 ${nm(r)}`);
}

// ── 人力 ─────────────────────────────────────────────────────
function setNeed(t: StaffingTable, dt: keyof StaffingTable, k: typeof NEEDS[number], e: Event, label: string) {
  const v = Math.max(0, Number((e.target as HTMLInputElement).value) || 0);
  t[dt][k] = v;
  persist(`${label} ${DAY_TYPES.find(x => x.key === dt)!.label} ${k}＝${v}`);
}
const rFrom = ref(1), rTo = ref(1);
function addRange() {
  const m = month.value!;
  const nd = daysIn(m.ym);
  const from = Math.min(Math.max(1, rFrom.value), nd), to = Math.min(Math.max(from, rTo.value), nd);
  m.staffing.ranges.push({ from, to, table: clone(m.staffing.base) });
  persist(`新增人力區段 ${from}–${to} 日`);
}
function removeRange(i: number) {
  const r = month.value!.staffing.ranges.splice(i, 1)[0];
  persist(`移除人力區段 ${r.from}–${r.to} 日`);
}
// ── 輪序起點（手動指定，優先於上月交接）─────────────────────
const items = computed(() => store.quotaItems.filter(i => i.enabled));
const prevMonth = computed(() => month.value ? store.months[prevYm(month.value.ym)] : undefined);
const canSetStart = computed(() => month.value?.status === "open" || month.value?.status === "scheduling");
const eligibleFor = (itemId: string) => {
  const it = store.quotaItems.find(i => i.id === itemId)!;
  return (month.value?.roster ?? []).filter(r => isEligible(it, r.flags)).map(r => r.personId);
};
const autoV = (itemId: string) => {
  const it = store.quotaItems.find(i => i.id === itemId)!;
  const pm = prevMonth.value, m = month.value!;
  return pm ? handoverV(it, pm.roster, pm.markers[it.id], m.roster) : null;
};
function setV(itemId: string, id: string) {
  const m = month.value!;
  const it = store.quotaItems.find(i => i.id === itemId)!;
  m.vOverride ??= {};
  if (id) m.vOverride[itemId] = id; else delete m.vOverride[itemId];
  const v = id || autoV(itemId);
  m.markers[itemId] = { v, x: m.markers[itemId]?.x ?? null };
  persist(`${it.name} 餘數起點 V：${id ? personById(id)?.name : `自動（上月交接：${personById(v)?.name ?? "—"}）`}`);
}

type WkKey = "wkN" | "satD" | "sunD";
const WK: { key: WkKey; label: string }[] = [
  { key: "wkN", label: "週末 N" }, { key: "satD", label: "週六 D" }, { key: "sunD", label: "週日 D" },
];
const order = computed(() => (month.value?.roster ?? []).map(r => r.personId));
const wkOk = (k: WkKey) => (id: string) => {
  const f = month.value?.roster.find(r => r.personId === id)?.flags;
  if (!f?.active) return false;
  return k === "wkN" ? !f.noN && !f.nightTransfer : !f.noD;
};
/** 本月第一個輪到的人（含手動指定） */
function wkFirst(k: WkKey, withOverride = true): string | null {
  const m = month.value;
  if (!m) return null;
  const base = prevMonth.value?.weekend.end ?? m.weekend.start;
  const start = applyWeekendFirst(order.value, base, withOverride ? m.weekendFirst : undefined);
  return nextInOrder(order.value, start[k], wkOk(k));
}
function setWk(k: WkKey, id: string) {
  const m = month.value!;
  m.weekendFirst ??= {};
  if (id) m.weekendFirst[k] = id; else delete m.weekendFirst[k];
  const label = WK.find(w => w.key === k)!.label;
  persist(`${label} 本月第一位：${id ? personById(id)?.name : `自動（接續上月：${personById(wkFirst(k, false))?.name ?? "—"}）`}`);
}

function clearAdjust(d: string) {
  delete month.value!.staffing.dayAdjust[Number(d)];
  persist(`取消 ${Number(props.ym.slice(4))}/${d} 可休微調`);
}
</script>

<template>
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-sunken/60 backdrop-blur-sm" @mousedown.self="emit('close')">
    <div v-if="month" class="bg-surface border border-hairline rounded-xl shadow-2xl w-[56rem] max-h-[85vh] flex flex-col text-xs">
      <div class="flex items-center gap-2 px-4 py-2.5 border-b border-hairline">
        <h3 class="text-sm font-semibold text-fg">{{ ym }} 本月設定</h3>
        <span v-if="readonly" class="text-warning">已發布，唯讀</span>
        <div class="ml-4 flex gap-1">
          <button v-for="t in ([['roster', '人員與旗標'], ['staffing', '人力'], ['start', '輪序起點']] as const)" :key="t[0]"
            class="px-2.5 py-1 rounded" :class="tab === t[0] ? 'bg-accent text-white' : 'text-muted hover:bg-elevated'"
            @click="tab = t[0]">{{ t[1] }}</button>
        </div>
        <button class="ml-auto text-muted hover:text-fg text-base" @click="emit('close')">✕</button>
      </div>

      <div class="flex-1 overflow-y-auto p-4">
        <!-- 人員與旗標 -->
        <template v-if="tab === 'roster'">
          <p class="text-muted mb-2">順序＝餘數輪序與週末輪序的順序。旗標各自獨立，修改後自動重算配額與預填。</p>
          <table>
            <thead class="text-muted text-left">
              <tr>
                <th class="px-2 py-1">順序</th><th class="px-2">姓名</th>
                <th v-for="f in FLAG_DEFS" :key="f.key" class="px-1.5 text-center font-normal">{{ f.label }}</th><th></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(r, i) in month.roster" :key="r.personId" class="border-t border-hairline">
                <td class="px-2 py-1 whitespace-nowrap text-muted">
                  <template v-if="!readonly">
                    <button class="px-0.5 hover:text-fg" @click="move(i, -1)">▲</button>
                    <button class="px-0.5 hover:text-fg" @click="move(i, 1)">▼</button>
                  </template>
                  {{ i + 1 }}
                </td>
                <td class="px-2 whitespace-nowrap text-fg">{{ nm(r) }} <span class="text-muted">{{ personById(r.personId)?.unit }}</span></td>
                <td v-for="f in FLAG_DEFS" :key="f.key" class="px-1.5 text-center">
                  <input type="checkbox" :checked="r.flags[f.key]" :disabled="readonly" @change="toggleFlag(r, f.key)" />
                </td>
                <td class="px-2"><button v-if="!readonly" class="text-muted hover:text-danger" @click="removePerson(i)">移除</button></td>
              </tr>
            </tbody>
          </table>
          <div v-if="!readonly" class="flex items-center gap-2 mt-3">
            <select v-model="addId" class="sched-input">
              <option value="">從人員名單加入…</option>
              <option v-for="p in candidates" :key="p.id" :value="p.id">{{ p.name }}（{{ p.unit || "外單位" }}）</option>
            </select>
            <button class="px-2 py-1 border border-hairline rounded hover:bg-elevated" @click="addPerson">加入</button>
            <span class="text-muted">外單位支援請加入後勾「支援人員」</span>
          </div>
        </template>

        <!-- 輪序起點 -->
        <template v-else-if="tab === 'start'">
          <p class="text-muted mb-3">
            平常由上個月自動交接；交接有誤（例如匯入的起點不對）時在這裡手動指定。選「自動」即恢復交接。修改後自動重算本月與之後月份的配額與預填。
          </p>
          <p v-if="!canSetStart" class="text-warning mb-3">已發布的月份不能改輪序起點。</p>
          <div class="space-y-4">
            <div>
              <div class="font-semibold text-fg mb-1">月配額餘數起點 V（本月第一個多拿 1 的人）</div>
              <table>
                <tbody>
                  <tr v-for="it in items" :key="it.id" class="border-t border-hairline">
                    <td class="pr-3 py-1 text-fg-secondary w-24">{{ it.name }}</td>
                    <td class="py-1">
                      <select class="sched-input" :disabled="!canSetStart" :value="month.vOverride?.[it.id] ?? ''" @change="setV(it.id, ($event.target as HTMLSelectElement).value)">
                        <option value="">自動（上月交接：{{ personById(autoV(it.id))?.name ?? "—" }}）</option>
                        <option v-for="id in eligibleFor(it.id)" :key="id" :value="id">{{ personById(id)?.name }}</option>
                      </select>
                    </td>
                    <td class="pl-3 text-muted">目前 V：{{ personById(month.markers[it.id]?.v)?.name ?? "—" }}　X：{{ personById(month.markers[it.id]?.x)?.name ?? "—" }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div>
              <div class="font-semibold text-fg mb-1">週末輪序（本月第一個輪到的人）</div>
              <p v-if="month.status !== 'open'" class="text-muted mb-1">只有開放預班的月份會預填週末輪序；已開始排班的月份請直接在班表上調整。</p>
              <table>
                <tbody>
                  <tr v-for="w in WK" :key="w.key" class="border-t border-hairline">
                    <td class="pr-3 py-1 text-fg-secondary w-24">{{ w.label }}</td>
                    <td class="py-1">
                      <select class="sched-input" :disabled="month.status !== 'open'" :value="month.weekendFirst?.[w.key] ?? ''" @change="setWk(w.key, ($event.target as HTMLSelectElement).value)">
                        <option value="">自動（接續上月：{{ personById(wkFirst(w.key, false))?.name ?? "—" }}）</option>
                        <option v-for="id in order.filter(wkOk(w.key))" :key="id" :value="id">{{ personById(id)?.name }}</option>
                      </select>
                    </td>
                    <td class="pl-3 text-muted">目前第一位：{{ personById(wkFirst(w.key))?.name ?? "—" }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </template>

        <!-- 人力 -->
        <template v-else>
          <p class="text-muted mb-2">可休人數＝在職（不含支援）−當日需上班（D＋N＋S1）−當日 8-4＋單日微調。區段覆蓋依日期套用，後設定的優先。</p>
          <div class="space-y-4">
            <div>
              <div class="font-semibold text-fg mb-1">基本人力表</div>
              <table>
                <thead class="text-muted"><tr><th></th><th v-for="k in NEEDS" :key="k" class="px-2">{{ k }}</th></tr></thead>
                <tbody>
                  <tr v-for="dt in DAY_TYPES" :key="dt.key">
                    <td class="pr-3 text-fg-secondary">{{ dt.label }}</td>
                    <td v-for="k in NEEDS" :key="k" class="px-1 py-0.5">
                      <input type="number" min="0" class="sched-input w-14" :value="month.staffing.base[dt.key][k]" :disabled="readonly"
                        @change="setNeed(month.staffing.base, dt.key, k, $event, '基本人力')" />
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div v-for="(rg, i) in month.staffing.ranges" :key="i">
              <div class="flex items-center gap-2 font-semibold text-fg mb-1">
                區段 {{ rg.from }}–{{ rg.to }} 日
                <button v-if="!readonly" class="font-normal text-muted hover:text-danger" @click="removeRange(i)">移除</button>
              </div>
              <table>
                <thead class="text-muted"><tr><th></th><th v-for="k in NEEDS" :key="k" class="px-2">{{ k }}</th></tr></thead>
                <tbody>
                  <tr v-for="dt in DAY_TYPES" :key="dt.key">
                    <td class="pr-3 text-fg-secondary">{{ dt.label }}</td>
                    <td v-for="k in NEEDS" :key="k" class="px-1 py-0.5">
                      <input type="number" min="0" class="sched-input w-14" :value="rg.table[dt.key][k]" :disabled="readonly"
                        @change="setNeed(rg.table, dt.key, k, $event, `區段 ${rg.from}–${rg.to}`)" />
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div v-if="!readonly" class="flex items-center gap-2">
              <span class="text-fg-secondary">新增區段</span>
              <input v-model.number="rFrom" type="number" min="1" class="sched-input w-14" /> 日 ～
              <input v-model.number="rTo" type="number" min="1" class="sched-input w-14" /> 日
              <button class="px-2 py-1 border border-hairline rounded hover:bg-elevated" @click="addRange">新增</button>
            </div>
            <div>
              <div class="font-semibold text-fg mb-1">單日可休微調</div>
              <div v-if="!Object.keys(month.staffing.dayAdjust).length" class="text-muted">無（在班表下方「可休」列滑過該日可 ±1）</div>
              <span v-for="(v, d) in month.staffing.dayAdjust" :key="d" class="inline-block mr-2 mb-1 px-2 py-0.5 rounded bg-elevated border border-hairline">
                {{ Number(ym.slice(4)) }}/{{ d }}：{{ v > 0 ? "+" : "" }}{{ v }}
                <button v-if="!readonly" class="ml-1 text-muted hover:text-danger" @click="clearAdjust(String(d))">×</button>
              </span>
            </div>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>
