<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from "vue";
import { useRoute } from "vue-router";
import { openUrl } from "@tauri-apps/plugin-opener";
import { loadEmergencyCards, EM_TABLE } from "@/composables/useEmergency";
import { onTableSynced } from "@/composables/useTableSync";
import { matchTiers, searchCards, visibleCards, rangeText, tierRefs } from "@/shared/emergency/logic";
import { EM_CATEGORIES, STATUS_LABELS, DISCLAIMER, type EmCard, type EmTier, type EmRecheck } from "@/shared/emergency/types";

/** 危急處置（ADR-017）：選卡 → 輸入數值、回答是非題 → 顯示符合級距的處置 */
const cards = ref<EmCard[]>([]);
const q = ref("");
const selected = ref<EmCard | null>(null);
const valueText = ref("");
const answers = ref<Record<string, boolean | undefined>>({});
const checked = ref(new Set<string>());

const route = useRoute();
async function reload() {
  cards.value = visibleCards(await loadEmergencyCards());
  if (selected.value) selected.value = cards.value.find(c => c.uid === selected.value!.uid) ?? null;
  else openFromQuery();
}
function openFromQuery() {
  const c = cards.value.find(x => x.uid === route.query.c);
  if (c && selected.value?.uid !== c.uid) pick(c);
}
watch(() => route.query.c, openFromQuery);
onMounted(reload);
onTableSynced(EM_TABLE, reload);

const list = computed(() => searchCards(cards.value, q.value));
const groups = computed(() => {
  const cats = [...EM_CATEGORIES, ...new Set(list.value.map(c => c.spec.category))];
  return [...new Set(cats)].map(cat => ({ cat, items: list.value.filter(c => c.spec.category === cat) })).filter(g => g.items.length);
});

function pick(c: EmCard) {
  selected.value = c;
  valueText.value = "";
  answers.value = {};
  checked.value = new Set();
}

const spec = computed(() => selected.value?.spec ?? null);
const value = computed(() => {
  const t = valueText.value.trim();
  return t === "" ? null : Number(t);
});
const result = computed(() => spec.value ? matchTiers(spec.value, value.value, answers.value) : null);
const condQ = (id: string) => spec.value?.conditions.find(c => c.id === id)?.question ?? id;
const unit = computed(() => spec.value?.measure?.unit ?? "");

function toggle(key: string) {
  const s = new Set(checked.value);
  if (s.has(key)) s.delete(key); else s.add(key);
  checked.value = s;
}
function answer(id: string, v: boolean) {
  answers.value = { ...answers.value, [id]: answers.value[id] === v ? undefined : v };
}

// ── 追蹤提醒計時 ──────────────────────────────────────────────
interface Timer { key: string; label: string; left: number; total: number; done: boolean }
const timers = ref<Timer[]>([]);
let tick: ReturnType<typeof setInterval> | undefined;
function startTimer(r: EmRecheck, owner: string) {
  const key = `${owner}|${r.label}`;
  timers.value = [...timers.value.filter(t => t.key !== key), { key, label: r.label, left: r.minutes * 60, total: r.minutes * 60, done: false }];
  tick ??= setInterval(() => {
    for (const t of timers.value) if (!t.done && --t.left <= 0) { t.left = 0; t.done = true; }
  }, 1000);
}
const removeTimer = (key: string) => { timers.value = timers.value.filter(t => t.key !== key); };
onUnmounted(() => clearInterval(tick));
watch(selected, () => { timers.value = []; });
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

const tiersToShow = computed<EmTier[]>(() => result.value?.matched ?? []);
</script>

<template>
  <div class="accent-rose flex gap-4 h-full bg-sunken rounded-2xl border border-hairline p-1 overflow-hidden">
    <!-- 左：卡片清單 -->
    <div class="w-72 shrink-0 flex flex-col bg-surface rounded-xl border border-hairline p-3 gap-3">
      <div class="flex items-center gap-2">
        <span class="text-lg">🚨</span>
        <p class="text-sm font-bold text-danger">危急處置</p>
      </div>
      <input v-model="q" placeholder="搜尋：症狀、項目（例：喘、K、低血壓）"
        class="w-full px-3 py-2 rounded-lg bg-sunken border border-hairline text-xs text-fg" />
      <div class="flex-1 overflow-y-auto space-y-3 pr-1">
        <div v-for="g in groups" :key="g.cat">
          <p class="text-2xs font-bold text-muted mb-1">{{ g.cat }}</p>
          <button v-for="c in g.items" :key="c.uid" @click="pick(c)"
            class="w-full text-left px-3 py-2.5 mb-1 rounded-lg border text-xs"
            :class="selected?.uid === c.uid ? 'bg-danger/10 border-danger/30 text-danger font-bold' : 'bg-sunken border-hairline text-fg-secondary hover:text-fg'">
            {{ c.name }}
            <span v-if="c.spec.status === 'literature'" class="ml-1 text-2xs text-warning">文獻版</span>
          </button>
        </div>
        <p v-if="!list.length" class="text-xs text-muted text-center py-8">沒有符合的卡片</p>
      </div>
    </div>

    <!-- 右：處置 -->
    <div class="flex-1 overflow-y-auto p-4 space-y-4">
      <div v-if="!selected || !spec" class="h-full flex flex-col items-center justify-center text-muted text-sm gap-2">
        <span class="text-4xl opacity-30">🚨</span>
        從左側選擇項目，或搜尋症狀
      </div>

      <template v-else>
        <div class="flex items-center gap-3 border-b border-hairline pb-3">
          <h2 class="text-xl font-black text-danger">{{ selected.name }}</h2>
          <span class="text-2xs px-2 py-0.5 rounded-full"
            :class="spec.status === 'published' ? 'bg-success/10 text-success' : 'bg-warning/15 text-warning'">{{ STATUS_LABELS[spec.status] }}</span>
          <div class="ml-auto flex flex-wrap gap-1.5 justify-end">
            <button v-for="(r, i) in spec.refs" :key="r.url" @click="openUrl(r.url)" :title="r.title"
              class="px-2 py-1 rounded-lg bg-accent/10 border border-accent/30 text-accent text-2xs font-bold hover:bg-accent/20">📚 [{{ i + 1 }}] {{ r.title.length > 28 ? r.title.slice(0, 28) + "…" : r.title }}</button>
          </div>
        </div>
        <div v-if="spec.status === 'literature'" class="p-3 rounded-xl bg-warning/10 border border-warning/30 text-xs text-warning font-bold">
          ⚠ 依國際文獻整理，尚未經院內審核。處置與劑量以醫囑及院內規範為準。
        </div>

        <!-- 數值與是非題 -->
        <div v-if="spec.kind === 'graded' && spec.measure" class="rounded-2xl bg-surface border border-hairline p-4 space-y-3">
          <label class="flex items-center gap-3">
            <span class="text-sm font-bold text-fg w-40">{{ spec.measure.label }}</span>
            <input v-model="valueText" inputmode="decimal" autofocus placeholder="輸入數值"
              class="w-40 px-3 py-2 rounded-lg bg-sunken border border-hairline text-2xl font-mono font-bold text-fg" />
            <span class="text-sm text-muted">{{ spec.measure.unit }}</span>
          </label>
          <div v-for="c in spec.conditions" :key="c.id" class="flex items-center gap-3 text-xs"
            :class="result?.needAnswers.includes(c.id) ? 'text-warning font-bold' : 'text-fg-secondary'">
            <span class="flex-1">{{ c.question }}</span>
            <button v-for="v in [true, false]" :key="String(v)" @click="answer(c.id, v)"
              class="px-3 py-1.5 rounded-lg border font-bold"
              :class="answers[c.id] === v ? (v ? 'bg-danger text-white border-danger' : 'bg-fg-secondary text-surface border-fg-secondary') : 'border-hairline bg-sunken'">
              {{ v ? "是" : "否" }}
            </button>
          </div>
        </div>

        <!-- 結果 -->
        <template v-if="spec.kind === 'graded'">
          <p v-if="value === null" class="text-sm text-muted">輸入數值後顯示對應的處置。</p>
          <p v-else-if="!Number.isFinite(value)" class="text-sm text-danger font-bold">數值格式錯誤</p>
          <template v-else-if="result">
            <p v-if="result.needAnswers.length" class="p-3 rounded-xl bg-warning/10 border border-warning/30 text-xs text-warning font-bold">
              請回答：{{ result.needAnswers.map(condQ).join("；") }}（會影響處置）
            </p>
            <p v-if="result.uncovered" class="p-4 rounded-xl bg-sunken border border-hairline text-sm text-fg-secondary">
              {{ value }} {{ unit }} 不在這張卡的處置範圍內；有疑慮請聯絡醫師。
            </p>
          </template>
        </template>

        <div v-for="t in tiersToShow" :key="t.id" class="rounded-2xl bg-surface border-2 border-danger/30 p-4 space-y-3">
          <div class="flex items-baseline gap-2">
            <h3 class="text-base font-black text-danger">{{ t.title }}</h3>
            <span class="text-xs text-muted font-mono">{{ rangeText(t, unit) }}</span>
          </div>
          <label v-for="(a, i) in t.actions" :key="i" class="flex items-start gap-3 p-2.5 rounded-lg bg-sunken cursor-pointer select-none"
            :class="checked.has(`${t.id}|${i}`) ? 'opacity-40 line-through' : ''">
            <input type="checkbox" :checked="checked.has(`${t.id}|${i}`)" @change="toggle(`${t.id}|${i}`)" class="mt-0.5" />
            <span class="text-sm text-fg">{{ a }}</span>
          </label>
          <div v-if="t.meds.length" class="grid grid-cols-1 xl:grid-cols-2 gap-2">
            <div v-for="m in t.meds" :key="m.name" class="p-3 rounded-lg border"
              :class="m.alert ? 'bg-danger/10 border-danger/40' : 'bg-accent/5 border-accent/20'">
              <p class="text-sm font-bold" :class="m.alert ? 'text-danger' : 'text-accent'">{{ m.alert ? "⚠ 高警訊 · " : "" }}{{ m.name }}</p>
              <p class="text-xs text-fg-secondary mt-1">{{ m.dose }}</p>
            </div>
          </div>
          <div v-if="t.rechecks.length" class="flex flex-wrap gap-2">
            <button v-for="r in t.rechecks" :key="r.label" @click="startTimer(r, t.id)"
              class="px-3 py-1.5 rounded-lg bg-success/10 border border-success/30 text-success text-xs font-bold">
              ⏱ {{ r.label }}（{{ r.minutes }} 分）
            </button>
          </div>
          <p v-if="t.notes" class="text-xs text-muted">{{ t.notes }}</p>
          <p v-if="tierRefs(spec, t).length" class="text-2xs text-muted flex flex-wrap gap-x-3 gap-y-1">
            <span>📚 依據：</span>
            <button v-for="r in tierRefs(spec, t)" :key="r.url" @click="openUrl(r.url)" class="underline hover:text-accent text-left">[{{ spec.refs.indexOf(r) + 1 }}] {{ r.title }}</button>
          </p>
        </div>

        <div v-if="result && (result.neighbors.below || result.neighbors.above)" class="text-xs text-muted space-y-1">
          <p v-if="result.neighbors.below">數值較低的一級：{{ result.neighbors.below.title }}（{{ rangeText(result.neighbors.below, unit) }}）</p>
          <p v-if="result.neighbors.above">數值較高的一級：{{ result.neighbors.above.title }}（{{ rangeText(result.neighbors.above, unit) }}）</p>
        </div>

        <!-- 一般卡 -->
        <div v-if="spec.kind === 'general'" class="rounded-2xl bg-surface border border-hairline p-4 space-y-3">
          <label v-for="(a, i) in spec.general.actions" :key="i" class="flex items-start gap-3 p-2.5 rounded-lg bg-sunken cursor-pointer select-none"
            :class="checked.has(`g|${i}`) ? 'opacity-40 line-through' : ''">
            <input type="checkbox" :checked="checked.has(`g|${i}`)" @change="toggle(`g|${i}`)" class="mt-0.5" />
            <span class="text-sm text-fg">{{ a }}</span>
          </label>
          <div v-for="m in spec.general.meds" :key="m.name" class="p-3 rounded-lg border"
            :class="m.alert ? 'bg-danger/10 border-danger/40' : 'bg-accent/5 border-accent/20'">
            <p class="text-sm font-bold" :class="m.alert ? 'text-danger' : 'text-accent'">{{ m.alert ? "⚠ 高警訊 · " : "" }}{{ m.name }}</p>
            <p class="text-xs text-fg-secondary mt-1">{{ m.dose }}</p>
          </div>
          <button v-for="r in spec.general.rechecks" :key="r.label" @click="startTimer(r, 'g')"
            class="mr-2 px-3 py-1.5 rounded-lg bg-success/10 border border-success/30 text-success text-xs font-bold">⏱ {{ r.label }}（{{ r.minutes }} 分）</button>
        </div>

        <!-- 計時 -->
        <div v-if="timers.length" class="flex flex-wrap gap-2">
          <div v-for="t in timers" :key="t.key" class="flex items-center gap-2 px-3 py-2 rounded-xl border"
            :class="t.done ? 'bg-danger/15 border-danger text-danger animate-pulse' : 'bg-surface border-hairline text-fg'">
            <span class="text-xs font-bold">{{ t.label }}</span>
            <span class="font-mono font-black text-lg">{{ t.done ? "時間到" : mmss(t.left) }}</span>
            <button @click="removeTimer(t.key)" class="text-muted text-xs">✕</button>
          </div>
        </div>

        <p v-if="spec.notes" class="text-xs text-fg-secondary">📝 {{ spec.notes }}</p>

        <div v-if="spec.contacts.length" class="flex flex-wrap gap-2">
          <span v-for="c in spec.contacts" :key="c.label + c.ext" class="px-3 py-1.5 rounded-lg bg-surface border border-hairline text-xs">
            📞 {{ c.label }} <b class="font-mono text-danger">{{ c.ext }}</b>
          </span>
        </div>

        <!-- 依據 -->
        <div class="border-t border-hairline pt-3 text-2xs text-muted space-y-1">
          <p>依據：{{ spec.source || "—" }}<template v-if="spec.reviewer">　審核：{{ spec.reviewer }}</template><template v-if="spec.effective">　生效：{{ spec.effective }}</template></p>
          <p v-for="(r, i) in spec.refs" :key="r.url">
            <button class="underline hover:text-accent text-left" @click="openUrl(r.url)">[{{ i + 1 }}] {{ r.title }}</button>
            <span class="ml-1 opacity-70">{{ r.url }}</span>
          </p>
          <p class="font-bold">{{ DISCLAIMER }}</p>
        </div>
      </template>
    </div>
  </div>
</template>
