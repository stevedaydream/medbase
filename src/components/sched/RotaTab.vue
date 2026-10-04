<script setup lang="ts">
import { ref, computed } from "vue";
import {
  useSchedStore, saveGlobal, recompute, sortedYms, personById, firstOpenYm, appendLog, actorName, groupPeople, createFirstMonth,
} from "@/composables/useSchedStore";
import { ymOfDate, WEEKDAY_LABEL, dowOfDate } from "@/shared/sched/calendar";
import type { Duty84Entry } from "@/shared/sched/types";
import {
  planHolidayImport, applyHolidayImport, earliestDate, TW_CALENDAR_URL, type HolidayImportPlan, type TwCalDay,
} from "@/shared/sched/holidayImport";
import QuotaPreview from "./QuotaPreview.vue";

/** isSuper：國定假日、春節、8-4 為全院共用，只有 super 可以修改（ADR-025） */
defineProps<{ isSuper: boolean }>();
const emit = defineEmits<{ toast: [msg: string] }>();
const store = useSchedStore();
const busy = ref(false);
const selYm = ref<string | null>(null);

const STATUS_LABEL = { open: "開放預班", scheduling: "排班中", published: "已發布" } as const;

const year = ref(String(new Date().getFullYear()));
const years = computed(() => {
  const ys = new Set<string>([year.value, String(Number(year.value) + 1)]);
  for (const d of Object.keys(store.holidays.days)) ys.add(d.slice(0, 4));
  return [...ys].sort();
});

const people = computed(() => [...store.people].sort((a, b) => a.order - b.order));
/** 國定假日抽籤候選：該日期月份的排班名單（在職）；月份未建立時用最近月份，都沒有時用本群組人員 */
function dutyCandidates(date: string) {
  const ym = ymOfDate(date);
  const yms = sortedYms();
  const src = store.months[ym] ?? store.months[yms.filter(y => y <= ym).pop() ?? yms[yms.length - 1]];
  const ids = new Set(src?.roster.filter(r => r.flags.active).map(r => r.personId) ?? []);
  const cur = store.holidayDuty[date.slice(0, 4)]?.[date];
  for (const id of [cur?.D, cur?.N]) if (id) ids.add(id);
  if (!ids.size) return groupPeople().filter(p => p.active).sort((a, b) => a.order - b.order);
  return people.value.filter(p => ids.has(p.id));
}
const name = (id: string | null | undefined) => personById(id)?.name ?? "—";
const wd = (date: string) => WEEKDAY_LABEL[dowOfDate(date)];

/** shared：改的是全院共用資料（假日、春節、8-4），一併重算其他群組 */
async function run(fromYm: string | null, reason: string, shared = true) {
  busy.value = true;
  try {
    await appendLog("global", "輪值設定", reason, actorName());
    const r = await recompute(fromYm, reason, { allGroups: shared });
    const parts = ["已重新計算預填"];
    if (r.notices) parts.push(`覆蓋 ${r.notices} 筆預班（已寫入通知）`);
    if (r.warnings.length) parts.push(`${r.warnings.length} 則提示`);
    emit("toast", parts.join("，"));
  } catch (e) {
    emit("toast", `重算失敗：${(e as Error).message}`);
  } finally {
    busy.value = false;
  }
}

async function firstMonth() {
  busy.value = true;
  try {
    await createFirstMonth();
    emit("toast", "已建立月份並預填");
  } catch (e) {
    emit("toast", `建立失敗：${(e as Error).message}`);
  } finally {
    busy.value = false;
  }
}

// ── 國定假日 ─────────────────────────────────────────────────
const newHolDate = ref("");
const newHolName = ref("");
const holidaysOfYear = computed(() =>
  Object.entries(store.holidays.days).filter(([d]) => d.startsWith(year.value)).sort(([a], [b]) => a.localeCompare(b)),
);
async function addHoliday() {
  if (!newHolDate.value) return;
  store.holidays.days[newHolDate.value] = newHolName.value || "國定假日";
  await saveGlobal("holidays");
  await run(ymOfDate(newHolDate.value), `新增國定假日 ${newHolDate.value}`);
  newHolDate.value = ""; newHolName.value = "";
}
async function removeHoliday(d: string) {
  delete store.holidays.days[d];
  await saveGlobal("holidays");
  await run(ymOfDate(d), `移除國定假日 ${d}`);
}

// ── 從政府辦公日曆匯入（選到的年度，含下一年度）────────────────
const importPlan = ref<HolidayImportPlan | null>(null);
const importCny = ref(true);
const importCnyFrom = ref(""), importCnyTo = ref("");
const importing = ref(false);
async function fetchHolidayPlan() {
  importing.value = true;
  try {
    const res = await fetch(TW_CALENDAR_URL(year.value));
    if (res.status === 404) throw new Error(`政府尚未公布 ${year.value} 年辦公日曆`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const plan = planHolidayImport(store.holidays, year.value, await res.json() as TwCalDay[]);
    if (!plan.days.length && !plan.workdays.length && !plan.cny) {
      emit("toast", `${year.value} 年的國定假日都已在清單中（${plan.existing} 天）`);
      return;
    }
    importPlan.value = plan;
    // 已過的春節（例如今年稍早）預設不勾，避免回頭改已排好的月份
    importCny.value = !!plan.cny && plan.cny.from >= new Date().toISOString().slice(0, 10);
    importCnyFrom.value = plan.cny?.from ?? "";
    importCnyTo.value = plan.cny?.to ?? "";
  } catch (e) {
    emit("toast", `取得國定假日失敗：${(e as Error).message}`);
  } finally {
    importing.value = false;
  }
}
async function confirmHolidayImport() {
  const plan = importPlan.value;
  if (!plan) return;
  const cny = plan.cny && importCny.value ? { from: importCnyFrom.value, to: importCnyTo.value } : null;
  if (cny && (!cny.from || !cny.to || cny.to < cny.from)) { emit("toast", "春節區間日期不正確"); return; }
  store.holidays = applyHolidayImport(store.holidays, plan, cny);
  await saveGlobal("holidays");
  importPlan.value = null;
  const first = earliestDate(plan, cny);
  const parts = [`國定假日 ${plan.days.length} 天`, plan.workdays.length ? `補班日 ${plan.workdays.length} 天` : "", cny ? `春節區間 ${cny.from}～${cny.to}` : ""];
  await run(first ? ymOfDate(first) : null, `匯入 ${plan.year} 年政府辦公日曆：${parts.filter(Boolean).join("、")}`);
}

const newWorkday = ref("");
async function addWorkday() {
  if (!newWorkday.value || store.holidays.workdays.includes(newWorkday.value)) return;
  store.holidays.workdays.push(newWorkday.value);
  store.holidays.workdays.sort();
  await saveGlobal("holidays");
  await run(ymOfDate(newWorkday.value), `新增補班日 ${newWorkday.value}`);
  newWorkday.value = "";
}
async function removeWorkday(d: string) {
  store.holidays.workdays = store.holidays.workdays.filter(x => x !== d);
  await saveGlobal("holidays");
  await run(ymOfDate(d), `移除補班日 ${d}`);
}

const cnyFrom = ref(""), cnyTo = ref("");
async function addCny() {
  if (!cnyFrom.value || !cnyTo.value || cnyTo.value < cnyFrom.value) return;
  store.holidays.cny.push({ from: cnyFrom.value, to: cnyTo.value });
  await saveGlobal("holidays");
  await run(ymOfDate(cnyFrom.value), "設定春節輪值區間");
  cnyFrom.value = ""; cnyTo.value = "";
}
async function removeCny(i: number) {
  const r = store.holidays.cny.splice(i, 1)[0];
  await saveGlobal("holidays");
  await run(ymOfDate(r.from), "移除春節輪值區間");
}

// ── 國定假日抽籤 ─────────────────────────────────────────────
function dutyOf(date: string) {
  const y = date.slice(0, 4);
  store.holidayDuty[y] ??= {};
  store.holidayDuty[y][date] ??= { D: null, N: null };
  return store.holidayDuty[y][date];
}
async function setDuty(date: string, code: "D" | "N", id: string) {
  dutyOf(date)[code] = id || null;
  await saveGlobal("holidayDuty");
  await run(ymOfDate(date), `國定假日抽籤結果變更（${date}）`, false);
}
const inCnyDate = (d: string) => store.holidays.cny.some(r => d >= r.from && d <= r.to);

// ── 8-4 ─────────────────────────────────────────────────────
const log84 = computed(() => [...store.duty84.log].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 40));
async function set84Person(e: Duty84Entry, id: string) {
  e.personId = id || null;
  e.manual = true;
  await saveGlobal("duty84");
  await run(ymOfDate(e.date), `8-4 人選手動調整（${e.date}）`);
}
async function remove84Date(e: Duty84Entry) {
  store.duty84.removedDates.push(e.date);
  store.duty84.addedDates = store.duty84.addedDates.filter(d => d !== e.date);
  await saveGlobal("duty84");
  await run(ymOfDate(e.date), `取消 8-4 日期 ${e.date}`);
}
const new84 = ref("");
async function add84Date() {
  if (!new84.value) return;
  store.duty84.addedDates.push(new84.value);
  store.duty84.removedDates = store.duty84.removedDates.filter(d => d !== new84.value);
  await saveGlobal("duty84");
  await run(ymOfDate(new84.value), `新增 8-4 日期 ${new84.value}`);
  new84.value = "";
}

// ── 春節 ────────────────────────────────────────────────────
const cnyYears = computed(() => {
  const ys = new Set(store.holidays.cny.map(r => String(Number(r.from.slice(0, 4)) - 1)));
  return [...ys].sort();
});
async function setLastD(y: string, id: string) {
  store.cny.lastD[y] = id || null;
  await saveGlobal("cny");
  const next = store.holidays.cny.find(r => r.from.startsWith(String(Number(y) + 1)));
  await run(next ? ymOfDate(next.from) : null, "春節輪序起點調整");
}
</script>

<template>
  <div class="h-full overflow-y-auto p-5 space-y-8 text-xs">
    <!-- 月份 -->
    <section class="space-y-2">
      <div class="flex items-center gap-2">
        <h2 class="text-sm font-semibold text-fg">月份</h2>
        <span class="text-muted">系統自動維持下個月起 6 個月：前 2 個月預填 8-4、國定假日、週末輪序與春節，其餘為遠期（只開放登記休假）</span>
        <button class="ml-auto px-2 py-1 text-muted hover:text-fg disabled:opacity-40" :disabled="busy || !firstOpenYm()"
          @click="run(null, '手動重新計算', isSuper)">重新計算</button>
      </div>
      <div class="flex flex-wrap gap-2">
        <button v-for="ym in sortedYms()" :key="ym" class="border rounded px-3 py-1.5 bg-elevated"
          :class="selYm === ym ? 'border-accent' : 'border-hairline'" @click="selYm = selYm === ym ? null : ym">
          <span class="font-semibold text-fg">{{ ym }}</span>
          <span class="ml-2" :class="store.months[ym].status === 'open' ? 'text-accent' : 'text-muted'">
            {{ STATUS_LABEL[store.months[ym].status] }}{{ store.months[ym].prefilled === false ? "・遠期" : "" }}
          </span>
        </button>
        <template v-if="!sortedYms().length">
          <span class="text-muted">尚無月份：可從「Excel 匯入」匯入起點月份，或以本群組在職人員建立下個月</span>
          <button class="px-2 py-1 border border-hairline rounded hover:bg-elevated disabled:opacity-40" :disabled="busy" @click="firstMonth">建立第一個月份</button>
        </template>
      </div>
      <div v-if="selYm" class="pt-2">
        <div class="text-fg-secondary mb-1">{{ selYm }} 配額{{ store.months[selYm].status === 'published' ? '（定案）' : '（預估）' }}</div>
        <QuotaPreview :ym="selYm" />
      </div>
    </section>

    <div class="flex items-center gap-2">
      <span class="text-fg-secondary">年度</span>
      <select v-model="year" class="sched-input">
        <option v-for="y in years" :key="y" :value="y">{{ y }}</option>
      </select>
    </div>

    <!-- 國定假日與抽籤 -->
    <section class="space-y-2">
      <div class="flex items-center gap-2">
        <h2 class="text-sm font-semibold text-fg">國定假日與抽籤結果</h2>
        <span v-if="!isSuper" class="ml-auto text-muted">國定假日、春節、8-4 為全院共用，由 super 維護</span>
        <button v-else class="ml-auto px-2 py-1 border border-hairline rounded hover:bg-elevated disabled:opacity-40" :disabled="busy || importing"
          @click="fetchHolidayPlan">{{ importing ? "取得中…" : `↓ 從政府辦公日曆匯入 ${year} 年` }}</button>
      </div>
      <p class="text-muted">抽籤在系統外進行，這裡填入每個國定假日 D、N 由誰上；春節區間內不抽籤。切換上方「年度」可匯入下一年度。</p>
      <div v-if="importPlan" class="border border-accent/40 rounded p-3 space-y-2 bg-accent/5">
        <div class="font-semibold text-fg">{{ importPlan.year }} 年政府辦公日曆：確認後新增（已存在的 {{ importPlan.existing }} 天不變）</div>
        <div v-if="importPlan.days.length">
          <span class="text-fg-secondary">國定假日 {{ importPlan.days.length }} 天：</span>
          <span v-for="d in importPlan.days" :key="d.date" class="inline-block mr-2">{{ d.date.slice(5) }}（{{ wd(d.date) }}）{{ d.name }}</span>
        </div>
        <div v-if="importPlan.workdays.length">
          <span class="text-fg-secondary">補班日：</span>{{ importPlan.workdays.join("、") }}
        </div>
        <div v-if="importPlan.cny" class="flex items-center gap-2 flex-wrap">
          <label class="flex items-center gap-1 cursor-pointer"><input v-model="importCny" type="checkbox" /> 同時設定春節輪值區間（全外科）</label>
          <template v-if="importCny">
            <input v-model="importCnyFrom" type="date" class="sched-input" /> ～ <input v-model="importCnyTo" type="date" class="sched-input" />
            <span class="text-muted">預設為春節連假，可調整</span>
          </template>
        </div>
        <div class="flex gap-2">
          <button class="px-3 py-1 bg-accent hover:bg-accent-hover text-white rounded disabled:opacity-40" :disabled="busy" @click="confirmHolidayImport">確認匯入</button>
          <button class="px-2 py-1 text-muted" @click="importPlan = null">取消</button>
        </div>
      </div>
      <table>
        <thead class="text-muted text-left">
          <tr><th class="px-2 py-1">日期</th><th class="px-2">名稱</th><th class="px-2">D</th><th class="px-2">N</th><th></th></tr>
        </thead>
        <tbody>
          <tr v-for="[d, n] in holidaysOfYear" :key="d" class="border-t border-hairline">
            <td class="px-2 py-1 whitespace-nowrap">{{ d }}（{{ wd(d) }}）</td>
            <td class="px-2">{{ n }}</td>
            <template v-if="inCnyDate(d)">
              <td colspan="2" class="px-2 text-muted">春節輪值</td>
            </template>
            <template v-else>
              <td class="px-2">
                <select class="sched-input" :value="store.holidayDuty[d.slice(0, 4)]?.[d]?.D ?? ''" @change="setDuty(d, 'D', ($event.target as HTMLSelectElement).value)">
                  <option value="">—</option>
                  <option v-for="p in dutyCandidates(d)" :key="p.id" :value="p.id">{{ p.name }}</option>
                </select>
              </td>
              <td class="px-2">
                <select class="sched-input" :value="store.holidayDuty[d.slice(0, 4)]?.[d]?.N ?? ''" @change="setDuty(d, 'N', ($event.target as HTMLSelectElement).value)">
                  <option value="">—</option>
                  <option v-for="p in dutyCandidates(d)" :key="p.id" :value="p.id">{{ p.name }}</option>
                </select>
              </td>
            </template>
            <td class="px-2"><button v-if="isSuper" class="text-muted hover:text-danger" :disabled="busy" @click="removeHoliday(d)">移除</button></td>
          </tr>
        </tbody>
      </table>
      <div v-if="isSuper" class="flex items-center gap-2">
        <input v-model="newHolDate" type="date" class="sched-input" />
        <input v-model="newHolName" placeholder="名稱" class="sched-input w-32" />
        <button class="px-2 py-1 border border-hairline rounded hover:bg-elevated" :disabled="busy" @click="addHoliday">新增國定假日</button>
      </div>
      <div class="flex items-center gap-2 flex-wrap">
        <span class="text-fg-secondary">補班日（視為平日）</span>
        <span v-for="d in store.holidays.workdays.filter(x => x.startsWith(year))" :key="d" class="px-2 py-0.5 rounded bg-elevated border border-hairline">
          {{ d }} <button v-if="isSuper" class="text-muted hover:text-danger ml-1" @click="removeWorkday(d)">×</button>
        </span>
        <template v-if="isSuper">
          <input v-model="newWorkday" type="date" class="sched-input" />
          <button class="px-2 py-1 border border-hairline rounded hover:bg-elevated" :disabled="busy" @click="addWorkday">新增</button>
        </template>
      </div>
    </section>

    <!-- 春節 -->
    <section class="space-y-2">
      <h2 class="text-sm font-semibold text-fg">春節輪值（全外科）</h2>
      <p class="text-muted">區間內病房合併：每天 D、N 各一人，D 依名單往下，N＝前一天的 D；第一天 N＝去年春節最後一天的 D。</p>
      <div class="flex items-center gap-2 flex-wrap">
        <span v-for="(r, i) in store.holidays.cny" :key="r.from" class="px-2 py-0.5 rounded bg-elevated border border-hairline">
          {{ r.from }} ～ {{ r.to }} <button v-if="isSuper" class="text-muted hover:text-danger ml-1" @click="removeCny(i)">×</button>
        </span>
        <template v-if="isSuper">
          <input v-model="cnyFrom" type="date" class="sched-input" /> ～ <input v-model="cnyTo" type="date" class="sched-input" />
          <button class="px-2 py-1 border border-hairline rounded hover:bg-elevated" :disabled="busy" @click="addCny">新增區間</button>
        </template>
      </div>
      <div v-for="y in cnyYears" :key="y" class="flex items-center gap-2">
        <span class="text-fg-secondary">{{ y }} 年春節最後一天的 D</span>
        <select class="sched-input" :disabled="!isSuper" :value="store.cny.lastD[y] ?? ''" @change="setLastD(y, ($event.target as HTMLSelectElement).value)">
          <option value="">—</option>
          <option v-for="p in people" :key="p.id" :value="p.id">{{ p.name }}（{{ p.unit || "外單位" }}）</option>
        </select>
      </div>
      <table v-if="store.cny.log.length">
        <tbody>
          <tr v-for="e in store.cny.log" :key="e.date" class="border-t border-hairline">
            <td class="px-2 py-1">{{ e.date }}（{{ wd(e.date) }}）</td>
            <td class="px-2">D {{ name(e.D) }}</td>
            <td class="px-2">N {{ name(e.N) }}</td>
          </tr>
        </tbody>
      </table>
    </section>

    <!-- 8-4 -->
    <section class="space-y-2">
      <h2 class="text-sm font-semibold text-fg">8-4 輪值明細（全外科，最近 40 筆）</h2>
      <p class="text-muted">日期為每段連續休假的最後一天；人選依人員名單順序接續、跳過 8-4 免輪。手動改人選後會保留，之後的日期接著往下輪。</p>
      <div v-if="isSuper" class="flex items-center gap-2">
        <input v-model="new84" type="date" class="sched-input" />
        <button class="px-2 py-1 border border-hairline rounded hover:bg-elevated" :disabled="busy" @click="add84Date">新增日期</button>
      </div>
      <table>
        <thead class="text-muted text-left">
          <tr><th class="px-2 py-1">日期</th><th class="px-2">類型</th><th class="px-2">人員</th><th class="px-2">單位</th><th></th></tr>
        </thead>
        <tbody>
          <tr v-for="e in log84" :key="e.date" class="border-t border-hairline">
            <td class="px-2 py-1 whitespace-nowrap">{{ e.date }}（{{ wd(e.date) }}）</td>
            <td class="px-2 text-muted">{{ e.kind }}</td>
            <td class="px-2">
              <select class="sched-input" :class="{ warn: e.manual }" :disabled="!isSuper" :value="e.personId ?? ''" @change="set84Person(e, ($event.target as HTMLSelectElement).value)">
                <option value="">—</option>
                <option v-for="p in people" :key="p.id" :value="p.id">{{ p.code84 ? p.code84 + " " : "" }}{{ p.name }}</option>
              </select>
              <span v-if="e.manual" class="ml-1 text-warning">手動</span>
            </td>
            <td class="px-2 text-muted">{{ personById(e.personId)?.unit || "外單位" }}</td>
            <td class="px-2"><button v-if="isSuper" class="text-muted hover:text-danger" :disabled="busy" @click="remove84Date(e)">取消此日</button></td>
          </tr>
        </tbody>
      </table>
    </section>
  </div>
</template>
