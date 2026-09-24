<script setup lang="ts">
import { useSchedStore, saveGlobal, appendLog, actorName, recompute, type GlobalKey } from "@/composables/useSchedStore";
import { COLOR_PALETTE, colorOf } from "@/shared/sched/palette";
import {
  DEFAULT_SHIFTS, DEFAULT_QUOTA_ITEMS, DEFAULT_RULES, FLAG_DEFS, newId,
  type ShiftDef, type QuotaItem, type ShiftCategory, type FlagKey,
} from "@/shared/sched/types";
import { WEEKDAY_LABEL } from "@/shared/sched/calendar";

const props = defineProps<{ canEdit: boolean }>();
const emit = defineEmits<{ toast: [msg: string] }>();
const store = useSchedStore();

const CATEGORIES: ShiftCategory[] = ["D", "N", "OFF", "S1", "H3", "OTHER"];
const SHIFT_BOOLS: { key: keyof ShiftDef; label: string; title: string }[] = [
  { key: "staffing",   label: "上班人力", title: "佔當日上班人力" },
  { key: "takesOff",   label: "休假名額", title: "佔當日休假名額" },
  { key: "reducesOff", label: "可休−1",   title: "離開單位：使當日可休人數 −1" },
  { key: "isRest",     label: "休息日",   title: "算休息日（中斷連續上班）" },
];

const timers: Partial<Record<GlobalKey, ReturnType<typeof setTimeout>>> = {};
function persist(key: GlobalKey) {
  if (!props.canEdit) return;
  clearTimeout(timers[key]);
  timers[key] = setTimeout(async () => {
    try {
      await saveGlobal(key);
      await appendLog("global", "班別與規則", `${KEY_LABEL[key] ?? key}已修改`, actorName());
      // 班別與配額項目影響配額與 V/X 交接，開放月份需重算
      if (key === "shifts" || key === "quotaItems") await recompute(null, `${KEY_LABEL[key]}修改`);
    } catch (e) {
      emit("toast", `儲存失敗：${(e as Error).message}`);
    }
  }, 500);
}
const KEY_LABEL: Partial<Record<GlobalKey, string>> = { shifts: "班別", quotaItems: "配額項目", rules: "檢核規則" };

function colorStyle(key: string) {
  const c = colorOf(key);
  return { backgroundColor: c.bg, color: c.text };
}

// ── 班別 ─────────────────────────────────────────────────────
function addShift() {
  store.shifts.push({
    code: "新", name: "", color: "gray", hotkey: "", hours: 8,
    staffing: false, takesOff: false, reducesOff: false, isRest: false, category: "OTHER",
  });
  persist("shifts");
}
function removeShift(s: ShiftDef) {
  store.shifts.splice(store.shifts.indexOf(s), 1);
  persist("shifts");
}
function resetShifts() {
  store.shifts = structuredClone(DEFAULT_SHIFTS);
  persist("shifts");
}

// ── 配額項目 ─────────────────────────────────────────────────
function toggleIn<T>(arr: T[], v: T) {
  const i = arr.indexOf(v);
  if (i >= 0) arr.splice(i, 1); else arr.push(v);
}
function toggleDow(q: QuotaItem, d: number) {
  const list = q.dow ?? [];
  toggleIn(list, d);
  q.dow = list.length ? list.sort() : null;
  persist("quotaItems");
}
function toggleCount(q: QuotaItem, code: string) { toggleIn(q.countShifts, code); persist("quotaItems"); }
function toggleExclude(q: QuotaItem, f: FlagKey) { toggleIn(q.exclude, f); persist("quotaItems"); }
function addQuota() {
  store.quotaItems.push({ id: newId().slice(0, 8), name: "新項目", enabled: false, total: "OFF", dow: null, countShifts: ["OFF"], exclude: ["support"] });
  persist("quotaItems");
}
function removeQuota(q: QuotaItem) {
  if (DEFAULT_QUOTA_ITEMS.some(d => d.id === q.id)) { q.enabled = false; persist("quotaItems"); return; }
  store.quotaItems.splice(store.quotaItems.indexOf(q), 1);
  persist("quotaItems");
}

function resetRules() {
  store.rules = structuredClone(DEFAULT_RULES);
  persist("rules");
}
</script>

<template>
  <div class="h-full overflow-y-auto p-5 space-y-8">
    <div v-if="!canEdit" class="text-xs text-warning">班別、配額項目、檢核規則只有 super 可以修改</div>

    <!-- 班別 -->
    <section class="space-y-2">
      <div class="flex items-center gap-2">
        <h2 class="text-sm font-semibold text-fg">班別</h2>
        <span class="text-xs text-muted">空白格：平日＝S1、週六＝H3；週日與國定假日不允許空白</span>
        <template v-if="canEdit">
          <button class="ml-auto text-xs px-2 py-1 text-muted hover:text-fg" @click="resetShifts">還原預設</button>
          <button class="text-xs px-3 py-1 bg-accent hover:bg-accent-hover text-white rounded" @click="addShift">＋ 班別</button>
        </template>
      </div>
      <table class="text-xs">
        <thead class="text-muted text-left">
          <tr>
            <th class="px-2 py-1">代碼</th><th class="px-2">名稱</th><th class="px-2">顏色</th><th class="px-2">快速鍵</th>
            <th class="px-2">工時</th>
            <th v-for="b in SHIFT_BOOLS" :key="b.key" class="px-2 text-center" :title="b.title">{{ b.label }}</th>
            <th class="px-2">統計歸類</th><th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="s in store.shifts" :key="s.code + store.shifts.indexOf(s)" class="border-t border-hairline">
            <td class="px-2 py-1">
              <input v-model="s.code" :disabled="!canEdit" class="sched-input w-14 font-semibold" :style="colorStyle(s.color)" @change="persist('shifts')" />
            </td>
            <td class="px-2"><input v-model="s.name" :disabled="!canEdit" class="sched-input w-20" @change="persist('shifts')" /></td>
            <td class="px-2">
              <select v-model="s.color" :disabled="!canEdit" class="sched-input" @change="persist('shifts')">
                <option v-for="c in COLOR_PALETTE" :key="c.key" :value="c.key">{{ c.key }}</option>
              </select>
            </td>
            <td class="px-2"><input v-model="s.hotkey" maxlength="1" :disabled="!canEdit" class="sched-input w-8 text-center" @change="persist('shifts')" /></td>
            <td class="px-2"><input v-model.number="s.hours" type="number" min="0" step="0.5" :disabled="!canEdit" class="sched-input w-14" @change="persist('shifts')" /></td>
            <td v-for="b in SHIFT_BOOLS" :key="b.key" class="px-2 text-center">
              <input v-model="(s[b.key] as boolean)" type="checkbox" :disabled="!canEdit" @change="persist('shifts')" />
            </td>
            <td class="px-2">
              <select v-model="s.category" :disabled="!canEdit" class="sched-input" @change="persist('shifts')">
                <option v-for="c in CATEGORIES" :key="c" :value="c">{{ c }}</option>
              </select>
            </td>
            <td class="px-2">
              <button v-if="canEdit" class="text-muted hover:text-danger" @click="removeShift(s)">刪除</button>
            </td>
          </tr>
        </tbody>
      </table>
    </section>

    <!-- 配額項目 -->
    <section class="space-y-2">
      <div class="flex items-center gap-2">
        <h2 class="text-sm font-semibold text-fg">月配額項目</h2>
        <span class="text-xs text-muted">每項各有一組 V/X 餘數輪序；夜班配額轉出與 OFF 固定＝假日數固定套用在 N、OFF 項目</span>
        <button v-if="canEdit" class="ml-auto text-xs px-3 py-1 bg-accent hover:bg-accent-hover text-white rounded" @click="addQuota">＋ 項目</button>
      </div>
      <div class="space-y-2">
        <div v-for="q in store.quotaItems" :key="q.id" class="border border-hairline rounded p-3 space-y-2 bg-surface"
          :class="q.enabled ? '' : 'opacity-60'">
          <div class="flex items-center gap-3 text-xs">
            <label class="flex items-center gap-1"><input v-model="q.enabled" type="checkbox" :disabled="!canEdit" @change="persist('quotaItems')" />啟用</label>
            <input v-model="q.name" :disabled="!canEdit" class="sched-input w-24 font-semibold" @change="persist('quotaItems')" />
            <span class="text-muted">總數來源</span>
            <select v-model="q.total" :disabled="!canEdit" class="sched-input" @change="persist('quotaItems')">
              <option value="D">每日 D 需求加總</option>
              <option value="N">每日 N 需求加總</option>
              <option value="OFF">每日可休人數加總</option>
            </select>
            <button v-if="canEdit" class="ml-auto text-muted hover:text-danger" @click="removeQuota(q)">
              {{ DEFAULT_QUOTA_ITEMS.some(d => d.id === q.id) ? "停用" : "刪除" }}
            </button>
          </div>
          <div class="flex items-center gap-1 text-xs flex-wrap">
            <span class="text-muted w-20">限星期</span>
            <button v-for="(w, d) in WEEKDAY_LABEL" :key="d" :disabled="!canEdit"
              class="px-1.5 py-0.5 rounded border"
              :class="q.dow?.includes(d) ? 'bg-accent text-white border-accent' : 'border-hairline text-muted'"
              @click="toggleDow(q, d)">{{ w }}</button>
            <span class="text-muted ml-1">{{ q.dow ? "" : "（全部日子）" }}</span>
          </div>
          <div class="flex items-center gap-1 text-xs flex-wrap">
            <span class="text-muted w-20">統計班別</span>
            <button v-for="s in store.shifts" :key="s.code" :disabled="!canEdit"
              class="px-1.5 py-0.5 rounded border"
              :class="q.countShifts.includes(s.code) ? 'bg-accent text-white border-accent' : 'border-hairline text-muted'"
              @click="toggleCount(q, s.code)">{{ s.code }}</button>
          </div>
          <div class="flex items-center gap-1 text-xs flex-wrap">
            <span class="text-muted w-20">不參與</span>
            <button v-for="f in FLAG_DEFS.filter(f => f.key !== 'active')" :key="f.key" :disabled="!canEdit"
              class="px-1.5 py-0.5 rounded border"
              :class="q.exclude.includes(f.key) ? 'bg-accent text-white border-accent' : 'border-hairline text-muted'"
              @click="toggleExclude(q, f.key)">{{ f.label }}</button>
          </div>
        </div>
      </div>
    </section>

    <!-- 檢核規則 -->
    <section class="space-y-2 text-xs">
      <div class="flex items-center gap-2">
        <h2 class="text-sm font-semibold text-fg">檢核規則參數</h2>
        <span class="text-muted">違規只警告不阻擋；發布時列出未解決項目</span>
        <button v-if="canEdit" class="ml-auto px-2 py-1 text-muted hover:text-fg" @click="resetRules">還原預設</button>
      </div>
      <div class="grid grid-cols-[14rem_auto] gap-y-2 items-center">
        <span class="text-fg-secondary">連續上班天數上限（OFF 才中斷）</span>
        <input v-model.number="store.rules.maxConsecutiveWork" type="number" min="1" :disabled="!canEdit" class="sched-input w-16" @change="persist('rules')" />
        <span class="text-fg-secondary">連續值班（D/N）天數上限</span>
        <input v-model.number="store.rules.maxConsecutiveDuty" type="number" min="1" :disabled="!canEdit" class="sched-input w-16" @change="persist('rules')" />
        <span class="text-fg-secondary">N 隔天只能排 N 或 OFF</span>
        <input v-model="store.rules.nightNextOnlyNOrOff" type="checkbox" :disabled="!canEdit" class="justify-self-start" @change="persist('rules')" />
        <span class="text-fg-secondary">發布後可退回時數</span>
        <input v-model.number="store.rules.revertHours" type="number" min="0" :disabled="!canEdit" class="sched-input w-16" @change="persist('rules')" />
      </div>
    </section>
  </div>
</template>
