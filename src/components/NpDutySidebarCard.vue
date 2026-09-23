<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { openUrl } from "@tauri-apps/plugin-opener";
import { getNpDutyUrl, loadNpDuty, localDateKey, NP_DUTY_UPDATED_EVENT, type NpDutyAssignment } from "@/composables/useNpDuty";
import { NP_WARDS, VS_UNITS } from "@/utils/npDutyXlsx";
import { getDb } from "@/db";

type Ward = NpDutyAssignment["ward"];
interface DisplayRow extends NpDutyAssignment {
  /** 凌晨 00–08 仍在班上的「昨天夜八」 */
  carried: boolean;
}

const view = ref<"today" | "tomorrow">("today");
const group = ref<"NP" | "VS">("NP");
const rows = ref<DisplayRow[]>([]);
const loaded = ref(false);
const downloadUrl = ref("");
const now = ref(new Date());
const showOtherVs = ref(false);
/** 通訊錄（physicians）姓名 → HIS 帳號，姓名去空白後比對 */
const hisByName = ref<Record<string, string>>({});
let timer: ReturnType<typeof setInterval> | null = null;

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

const viewDate = computed(() => addDays(now.value, view.value === "today" ? 0 : 1));
const displayDate = computed(() => `${viewDate.value.getMonth() + 1}/${viewDate.value.getDate()}`);
const activeUnits = computed<readonly Ward[]>(() => group.value === "NP" ? NP_WARDS : VS_UNITS);
const activeRows = computed(() => rows.value.filter(row => activeUnits.value.includes(row.ward)));
/** VS 只常駐顯示總值，其餘科別收折 */
const otherVsUnits = VS_UNITS.filter(unit => unit !== "總值");
const visibleUnits = computed<readonly Ward[]>(() => {
  if (group.value === "NP") return NP_WARDS;
  return showOtherVs.value ? ["總值", ...otherVsUnits] : ["總值"];
});

/** 白八 08–20、夜八 20–隔日 08；凌晨時在班的是昨天的夜八 */
function isCurrent(row: DisplayRow): boolean {
  if (view.value !== "today") return false;
  const h = now.value.getHours();
  if (row.carried) return h < 8;
  if (row.shift === "白八") return h >= 8 && h < 20;
  if (row.shift === "夜八") return h >= 20;
  return false;
}

/** 只有白八／夜八有時間，其他班（例如 PGY 值班）不淡化 */
function isTimed(row: DisplayRow): boolean {
  return row.carried || row.shift === "白八" || row.shift === "夜八";
}

function wardRows(ward: Ward) {
  return rows.value.filter(row => row.ward === ward);
}

function shiftLabel(row: DisplayRow): string {
  if (row.carried) return "昨夜";
  if (row.shift === "白八") return "白";
  if (row.shift === "夜八") return "夜";
  return row.shift;
}

function rowKey(row: DisplayRow) {
  return `${row.id}-${row.carried ? "c" : ""}`;
}

function normName(name: string): string {
  return name.replace(/\s+/g, "");
}

function hisAccount(row: DisplayRow): string {
  return hisByName.value[normName(row.np_name)] ?? "";
}

async function loadHisAccounts() {
  const db = await getDb();
  const list = await db.select<{ name: string; his_account: string }[]>(
    "SELECT name, his_account FROM physicians WHERE his_account IS NOT NULL AND TRIM(his_account) != ''",
  );
  hisByName.value = Object.fromEntries(list.map(p => [normName(p.name), p.his_account.trim()]));
}

async function refresh() {
  now.value = new Date();
  try {
    const date = localDateKey(viewDate.value);
    const list: DisplayRow[] = (await loadNpDuty(date)).map(r => ({ ...r, carried: false }));
    if (view.value === "today" && now.value.getHours() < 8) {
      const yesterday = await loadNpDuty(localDateKey(addDays(now.value, -1)));
      const carried = yesterday.filter(r => r.shift === "夜八").map(r => ({ ...r, carried: true }));
      list.unshift(...carried);
    }
    rows.value = list;
    try { await loadHisAccounts(); } catch { hisByName.value = {}; }
    downloadUrl.value = await getNpDutyUrl();
  } catch {
    rows.value = [];
  } finally {
    loaded.value = true;
  }
}

function switchView(v: "today" | "tomorrow") {
  view.value = v;
  refresh();
}

function openDownload() {
  if (downloadUrl.value) openUrl(downloadUrl.value);
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
  <section class="mt-3 rounded-xl border border-accent/20 bg-accent/[0.05] p-2.5" aria-label="NP 與 VS 值班">
    <div class="flex items-center justify-between mb-2 gap-1">
      <div class="flex rounded-md bg-sunken p-0.5 text-2xs font-bold">
        <button
          v-for="v in (['today', 'tomorrow'] as const)" :key="v"
          @click="switchView(v)"
          class="rounded px-1.5 py-0.5 transition-colors cursor-pointer"
          :class="view === v ? 'bg-accent/15 text-accent' : 'text-muted hover:text-fg-secondary'">
          {{ v === 'today' ? '今日' : '明日' }}
        </button>
      </div>
      <span class="text-2xs font-bold text-accent tabular-nums">{{ displayDate }}</span>
    </div>

    <div class="mb-2 grid grid-cols-2 gap-1 rounded-md bg-sunken p-0.5 text-2xs font-bold">
      <button v-for="g in (['NP', 'VS'] as const)" :key="g" @click="group = g"
        class="rounded px-2 py-1 transition-colors cursor-pointer"
        :class="group === g ? 'bg-accent/15 text-accent' : 'text-muted hover:text-fg-secondary'">
        {{ g }} 值班
      </button>
    </div>

    <div v-if="!loaded" class="text-xs text-muted">讀取中…</div>

    <!-- 這天完全沒有資料：多半是本月尚未匯入 -->
    <div v-else-if="!activeRows.length" class="space-y-1.5 text-xs">
      <p class="text-muted">尚無 {{ group }} 值班資料</p>
      <button v-if="downloadUrl" @click="openDownload"
        class="w-full rounded-lg border border-accent/30 bg-accent/10 px-2 py-1 font-bold text-accent hover:bg-accent/20 transition-colors cursor-pointer"
        :title="downloadUrl">
        ⬇ 下載班表
      </button>
      <p v-else class="text-2xs text-muted leading-snug">可在「資料管理 → NP／VS 值班」設定班表下載網址</p>
    </div>

    <div v-else class="space-y-1.5">
      <!-- 展開其他科別時限制高度並在卡片內捲動，收合按鈕留在外面，小視窗也按得到 -->
      <div class="space-y-1.5" :class="showOtherVs && group === 'VS' ? 'max-h-[35vh] overflow-y-auto pr-1' : ''">
      <!-- VS 科別名稱較長，改為科別在上、醫師在下，讓姓名能用滿整行寬度 -->
      <div v-for="ward in visibleUnits" :key="ward" class="flex text-xs"
        :class="group === 'NP' ? 'items-start gap-2' : 'flex-col gap-0.5'">
        <span class="shrink-0 self-start rounded bg-accent/10 px-1 py-0.5 text-center font-bold text-accent"
          :class="group === 'NP' ? 'w-6' : 'text-2xs'">{{ ward }}</span>
        <div v-if="wardRows(ward).length" class="min-w-0 flex-1 space-y-0.5">
          <div
            v-for="person in wardRows(ward)"
            :key="rowKey(person)"
            class="flex w-full min-w-0 items-baseline gap-1 rounded px-1 -mx-1"
            :class="[
              isCurrent(person) ? 'bg-accent/15' : '',
              view === 'today' && isTimed(person) && !isCurrent(person) ? 'opacity-45' : '',
            ]"
          >
            <span class="shrink-0 text-2xs font-bold" :class="isCurrent(person) ? 'text-accent' : 'text-muted'">{{ shiftLabel(person) }}</span>
            <span class="flex min-w-0 flex-wrap items-baseline gap-x-1">
              <span class="min-w-0 wrap-break-word font-semibold" :class="isCurrent(person) ? 'text-fg' : 'text-fg-secondary'">{{ person.np_name }}</span>
              <span v-if="hisAccount(person)" class="text-2xs tabular-nums text-muted">HIS {{ hisAccount(person) }}</span>
            </span>
            <span v-if="person.extension" class="ml-auto shrink-0 text-2xs tabular-nums text-muted">{{ person.extension }}</span>
          </div>
        </div>
        <span v-else class="py-0.5 text-xs text-muted">未排</span>
      </div>
      </div>
      <button v-if="group === 'VS'" @click="showOtherVs = !showOtherVs"
        class="w-full rounded px-1 py-0.5 text-2xs font-bold text-muted hover:bg-accent/10 hover:text-accent transition-colors cursor-pointer">
        {{ showOtherVs ? '▴ 收合其他科別' : `▾ 其他科別（${otherVsUnits.length}）` }}
      </button>
    </div>
  </section>
</template>
