<script setup lang="ts">
import { ref, computed, onMounted, watch } from "vue";
import { getDb } from "@/db";
import { upsertPhysician, removePhysician } from "@/composables/usePhysicians";
import { touchTable, markDeletedById, onTableSynced } from "@/composables/useTableSync";
import { exportToXlsx, xlsxPath } from "@/composables/useXlsxSync";
import CloudSyncButtons from "@/components/CloudSyncButtons.vue";

/**
 * 通訊錄：人員（physicians）與單位分機（contacts）合併查詢。
 * 兩者仍是各自的資料表與同步設定（ADR-011），只在畫面上合併；
 * 一個搜尋框同時比對姓名、科別／分類、職稱、分機、HIS 帳號與備註。
 */

interface Physician {
  id: number; name: string; department: string | null; title: string | null; ext: string | null;
  his_account: string | null; his_password: string | null; notes: string | null;
}
interface Contact { id: number; label: string; ext: string; category: string | null; notes: string | null }

type Kind = "person" | "unit";
type Tab = "all" | Kind;
interface Entry {
  kind: Kind; id: number;
  name: string; group: string; title: string; ext: string;
  hisAccount: string; hisPassword: string; notes: string;
  haystack: string;
}

const physicians = ref<Physician[]>([]);
const contacts   = ref<Contact[]>([]);
const search      = ref("");
const tab         = ref<Tab>("all");
const groupFilter = ref("");
const titleFilter = ref("");
const searchInput = ref<HTMLInputElement | null>(null);

const toast = ref("");
let toastTimer: ReturnType<typeof setTimeout> | null = null;
function showToast(msg: string) {
  toast.value = msg;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.value = ""; }, 2500);
}

async function load() {
  const db = await getDb();
  physicians.value = await db.select<Physician[]>("SELECT * FROM physicians ORDER BY department, name");
  contacts.value   = await db.select<Contact[]>("SELECT * FROM contacts ORDER BY category, label");
}

onMounted(async () => {
  searchInput.value?.focus();
  await migratePhysicianExts();
  await restorePhysicianExts();
  await load();
});
onTableSynced("physicians", load);
onTableSynced("contacts", load);

// ── 查詢 ─────────────────────────────────────────────────────────
const s = (v: string | null | undefined) => (v ?? "").trim();

const entries = computed<Entry[]>(() => [
  ...physicians.value.map(p => ({
    kind: "person" as const, id: p.id,
    name: p.name, group: s(p.department), title: s(p.title), ext: s(p.ext),
    hisAccount: s(p.his_account), hisPassword: s(p.his_password), notes: s(p.notes),
  })),
  ...contacts.value.map(c => ({
    kind: "unit" as const, id: c.id,
    name: c.label, group: s(c.category) || "常用分機", title: "", ext: s(c.ext),
    hisAccount: "", hisPassword: "", notes: s(c.notes),
  })),
].map(e => ({
  ...e,
  haystack: [e.name, e.group, e.title, e.ext, e.hisAccount, e.notes].join(" ").toLowerCase().replace(/\s+/g, " "),
})));

// 空白分隔的多個關鍵字須全部符合，例如「GS 主治」
const matched = computed(() => {
  const terms = search.value.toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return entries.value;
  return entries.value.filter(e => terms.every(t => e.haystack.includes(t)));
});

const counts = computed(() => ({
  all:    matched.value.length,
  person: matched.value.filter(e => e.kind === "person").length,
  unit:   matched.value.filter(e => e.kind === "unit").length,
}));

const inTab = computed(() => tab.value === "all" ? matched.value : matched.value.filter(e => e.kind === tab.value));

const groups = computed(() => {
  const src = tab.value === "all" ? entries.value : entries.value.filter(e => e.kind === tab.value);
  return [...new Set(src.map(e => e.group).filter(Boolean))].sort((a, b) => a.localeCompare(b, "zh-TW"));
});
const titles = computed(() =>
  [...new Set(physicians.value.map(p => s(p.title)).filter(Boolean))].sort((a, b) => a.localeCompare(b, "zh-TW")),
);

const filtered = computed(() => inTab.value.filter(e =>
  (!groupFilter.value || e.group === groupFilter.value) &&
  (!titleFilter.value || e.title === titleFilter.value),
));

// 切換分頁後，不存在於新分頁的篩選自動清掉，避免畫面空白卻看不出原因
watch(tab, (t) => {
  if (groupFilter.value && !groups.value.includes(groupFilter.value)) groupFilter.value = "";
  if (t === "unit") titleFilter.value = "";
});

const hasFilter = computed(() => !!(search.value || groupFilter.value || titleFilter.value));
function clearFilters() {
  search.value = ""; groupFilter.value = ""; titleFilter.value = "";
  searchInput.value?.focus();
}

const TABS: { key: Tab; label: string }[] = [
  { key: "all", label: "全部" },
  { key: "person", label: "人員" },
  { key: "unit", label: "單位分機" },
];

// ── 人員：新增／編輯／刪除 ─────────────────────────────────────────
const personModal = ref(false);
const personEditId = ref<number | null>(null);
const personForm = ref<Partial<Physician>>({});

function openAddPerson() {
  personEditId.value = null;
  personForm.value = { name: "", department: "", title: "主治醫師", ext: "", his_account: "", his_password: "", notes: "" };
  personModal.value = true;
}

function openEditPerson(id: number) {
  const p = physicians.value.find(x => x.id === id);
  if (!p) return;
  personEditId.value = id;
  personForm.value = { ...p };
  personModal.value = true;
}

async function savePerson() {
  if (!personForm.value.name?.trim()) return;
  const isEdit = personEditId.value != null;
  const { ahkMessage } = await upsertPhysician({ ...personForm.value, id: personEditId.value ?? undefined });
  personModal.value = false;
  await load();
  showToast(ahkMessage ?? (isEdit ? "已更新" : "已新增"));
}

// ── 單位分機：新增／編輯／刪除 ─────────────────────────────────────
const unitModal = ref(false);
const unitEditId = ref<number | null>(null);
const unitForm = ref<Partial<Contact>>({});

function openAddUnit() {
  unitEditId.value = null;
  unitForm.value = { label: "", ext: "", category: tab.value === "unit" && groupFilter.value ? groupFilter.value : "常用分機", notes: "" };
  unitModal.value = true;
}

function openEditUnit(id: number) {
  const c = contacts.value.find(x => x.id === id);
  if (!c) return;
  unitEditId.value = id;
  unitForm.value = { ...c };
  unitModal.value = true;
}

async function saveUnit() {
  const f = unitForm.value;
  if (!f.label?.trim() || !f.ext?.trim()) return;
  const db = await getDb();
  const params = [f.label.trim(), f.ext.trim(), f.category?.trim() || "常用分機", f.notes?.trim() || null];
  if (unitEditId.value == null) {
    await db.execute(
      "INSERT INTO contacts (label, ext, category, notes, updated_at) VALUES (?,?,?,?,datetime('now','localtime'))",
      params,
    );
  } else {
    await db.execute(
      "UPDATE contacts SET label=?, ext=?, category=?, notes=?, updated_at=datetime('now','localtime') WHERE id=?",
      [...params, unitEditId.value],
    );
  }
  const isEdit = unitEditId.value != null;
  unitModal.value = false;
  await load();
  showToast(isEdit ? "已更新" : "已新增");
  if (xlsxPath.value) exportToXlsx();
  await touchTable("contacts");
}

// ── 刪除（兩種共用確認視窗）──────────────────────────────────────
const deleteTarget = ref<Entry | null>(null);

function openEdit(e: Entry) {
  if (e.kind === "person") openEditPerson(e.id);
  else openEditUnit(e.id);
}

async function doDelete() {
  const e = deleteTarget.value;
  if (!e) return;
  deleteTarget.value = null;
  if (e.kind === "person") {
    const { ahkMessage } = await removePhysician(e.id);
    await load();
    showToast(ahkMessage ?? "已刪除");
    return;
  }
  const db = await getDb();
  await markDeletedById("contacts", e.id);
  await db.execute("DELETE FROM contacts WHERE id=?", [e.id]);
  await load();
  showToast("已刪除");
  if (xlsxPath.value) exportToXlsx();
  await touchTable("contacts");
}

// ── 一次性資料遷移（原常用分機頁）────────────────────────────────

// 把醫師通訊錄的院內分機搬到 contacts（排除主治醫師）；migration flag 確保只執行一次
async function migratePhysicianExts() {
  const db = await getDb();
  const flagRow = await db.select<{ value: string }[]>(
    "SELECT value FROM app_settings WHERE key='physician_ext_migrated'"
  );
  if (flagRow[0]?.value === "1") return;

  // 清除先前版本可能已遷移的主治醫師條目
  await db.execute(`
    DELETE FROM contacts
    WHERE label IN (SELECT name FROM physicians WHERE title = '主治醫師')
  `);

  // 只遷移非主治醫師的院內分機（如護理師、住院醫師、行政等）
  const staff = await db.select<{ name: string; ext: string; department: string | null }[]>(
    "SELECT name, ext, department FROM physicians WHERE ext IS NOT NULL AND TRIM(ext) != '' AND (title IS NULL OR title != '主治醫師')"
  );

  let migrated = 0;
  for (const p of staff) {
    const exists = await db.select<{ c: number }[]>(
      "SELECT COUNT(*) as c FROM contacts WHERE label=? AND ext=?",
      [p.name, p.ext]
    );
    if (exists[0].c > 0) continue;
    await db.execute(
      "INSERT INTO contacts (label, ext, category) VALUES (?,?,?)",
      [p.name, p.ext, p.department?.trim() || "院內分機"]
    );
    migrated++;
  }

  // 清空已遷移者的 ext（只執行這一次）
  await db.execute(`
    UPDATE physicians SET ext = NULL
    WHERE ext IS NOT NULL AND (title IS NULL OR title != '主治醫師')
  `);

  await db.execute(
    "INSERT OR REPLACE INTO app_settings (key, value) VALUES ('physician_ext_migrated', '1')"
  );

  if (migrated > 0) showToast(`已從醫師通訊錄匯入 ${migrated} 筆分機資料`);
}

// 把常用分機裡與 physicians.name 相符的條目移回通訊錄，讓單位分機只保留「非人員」的分機號
async function restorePhysicianExts() {
  const db = await getDb();
  const flag = await db.select<{ value: string }[]>(
    "SELECT value FROM app_settings WHERE key='physician_ext_restored'"
  );
  if (flag[0]?.value === "1") return;

  const rows = await db.select<{ id: number; label: string; ext: string }[]>(`
    SELECT c.id, c.label, c.ext
    FROM contacts c
    INNER JOIN physicians p ON p.name = c.label
    WHERE (p.ext IS NULL OR p.ext = '')
  `);

  for (const r of rows) {
    await db.execute("UPDATE physicians SET ext=? WHERE name=? AND (ext IS NULL OR ext='')", [r.ext, r.label]);
    await db.execute("DELETE FROM contacts WHERE id=?", [r.id]);
  }

  await db.execute("INSERT OR REPLACE INTO app_settings (key,value) VALUES ('physician_ext_restored','1')");
  if (rows.length > 0) showToast(`已將 ${rows.length} 筆人員分機還原至通訊錄`);
}
</script>

<template>
  <div class="accent-cyan flex flex-col h-full gap-3">

    <!-- 搜尋與操作 -->
    <div class="shrink-0 flex flex-col gap-2.5 bg-surface rounded-2xl border border-hairline px-4 py-3">
      <div class="flex items-center gap-3">
        <div class="relative flex-1 max-w-xl">
          <span class="absolute left-3 top-2.5 text-muted text-sm">🔍</span>
          <input ref="searchInput" v-model="search"
            placeholder="搜尋姓名、科別、職稱、分機、HIS 帳號、備註…（空白分隔多個關鍵字）"
            @keydown.esc="search = ''"
            class="w-full pl-9 pr-8 py-2 rounded-xl bg-sunken border border-hairline text-fg text-sm placeholder-muted outline-none focus:border-accent/50 transition-all" />
          <button v-if="search" @click="search = ''; searchInput?.focus()"
            class="absolute right-2.5 top-2 text-muted hover:text-fg-secondary text-lg leading-none cursor-pointer" title="清除">×</button>
        </div>
        <div class="flex-1" />
        <CloudSyncButtons :table="['physicians', 'contacts']" @synced="load" @message="showToast" />
        <div class="w-px h-5 bg-hairline" />
        <button @click="openAddPerson"
          class="px-3 py-1.5 rounded-xl bg-accent text-white text-xs font-bold hover:bg-accent-hover transition-colors cursor-pointer">
          ＋ 人員
        </button>
        <button @click="openAddUnit"
          class="px-3 py-1.5 rounded-xl bg-accent text-white text-xs font-bold hover:bg-accent-hover transition-colors cursor-pointer">
          ＋ 單位分機
        </button>
      </div>

      <div class="flex items-center gap-3 flex-wrap">
        <div class="flex rounded-xl bg-sunken p-0.5 text-xs font-bold">
          <button v-for="t in TABS" :key="t.key" @click="tab = t.key"
            class="rounded-lg px-3 py-1 transition-colors cursor-pointer"
            :class="tab === t.key ? 'bg-accent/15 text-accent' : 'text-muted hover:text-fg-secondary'">
            {{ t.label }} <span class="tabular-nums opacity-70">{{ counts[t.key] }}</span>
          </button>
        </div>
        <label class="flex items-center gap-1.5 text-xs text-muted">
          {{ tab === 'unit' ? '分類' : tab === 'person' ? '科別' : '科別／分類' }}
          <select v-model="groupFilter"
            class="rounded-lg bg-sunken border border-hairline px-2 py-1 text-xs text-fg outline-none focus:border-accent/50 cursor-pointer">
            <option value="">全部</option>
            <option v-for="g in groups" :key="g" :value="g">{{ g }}</option>
          </select>
        </label>
        <label v-if="tab !== 'unit'" class="flex items-center gap-1.5 text-xs text-muted">
          職稱
          <select v-model="titleFilter"
            class="rounded-lg bg-sunken border border-hairline px-2 py-1 text-xs text-fg outline-none focus:border-accent/50 cursor-pointer">
            <option value="">全部</option>
            <option v-for="t in titles" :key="t" :value="t">{{ t }}</option>
          </select>
        </label>
        <button v-if="hasFilter" @click="clearFilters"
          class="text-xs text-muted hover:text-accent cursor-pointer">清除條件</button>
      </div>
    </div>

    <!-- 結果表格 -->
    <div class="flex-1 min-h-0 flex flex-col bg-surface rounded-2xl border border-hairline overflow-hidden">
      <div class="contact-grid shrink-0 px-4 py-2 border-b border-hairline bg-sunken text-xs font-bold text-muted">
        <span>名稱</span>
        <span>科別／分類</span>
        <span>職稱</span>
        <span>分機</span>
        <span>HIS 帳號</span>
        <span>HIS 密碼</span>
        <span>備註</span>
        <span />
      </div>

      <div class="flex-1 overflow-y-auto custom-scrollbar">
        <div v-if="!filtered.length" class="py-16 text-center text-sm text-muted space-y-2">
          <p>{{ hasFilter ? '找不到符合條件的資料' : '尚無資料' }}</p>
          <button v-if="hasFilter" @click="clearFilters" class="text-xs text-accent hover:underline cursor-pointer">清除搜尋與篩選</button>
        </div>

        <div v-for="e in filtered" :key="`${e.kind}-${e.id}`"
          class="contact-grid group items-center px-4 py-2 border-b border-hairline text-sm hover:bg-overlay/5 transition-colors">
          <span class="min-w-0 flex items-center gap-1.5">
            <span v-if="tab === 'all'" class="shrink-0 rounded px-1 text-2xs font-bold"
              :class="e.kind === 'person' ? 'bg-accent/10 text-accent' : 'bg-warning/10 text-warning'">
              {{ e.kind === 'person' ? '人員' : '單位' }}
            </span>
            <span class="font-bold text-fg truncate" :title="e.name">{{ e.name }}</span>
          </span>
          <span class="text-fg-secondary truncate" :title="e.group">{{ e.group || '—' }}</span>
          <span class="text-fg-secondary truncate" :title="e.title">{{ e.title }}</span>
          <span class="font-mono font-bold tabular-nums text-accent select-all">{{ e.ext || '—' }}</span>
          <span class="font-mono tabular-nums text-fg select-all truncate">{{ e.hisAccount }}</span>
          <span class="font-mono tabular-nums text-fg select-all truncate">{{ e.hisPassword }}</span>
          <span class="text-xs text-muted truncate" :title="e.notes">{{ e.notes }}</span>
          <span class="flex justify-end gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
            <button @click="openEdit(e)"
              class="px-2 py-0.5 rounded-lg text-xs font-bold text-fg-secondary hover:bg-elevated hover:text-fg cursor-pointer">編輯</button>
            <button @click="deleteTarget = e"
              class="px-2 py-0.5 rounded-lg text-xs font-bold text-danger hover:bg-danger/10 cursor-pointer">刪除</button>
          </span>
        </div>
      </div>
    </div>
  </div>

  <Teleport to="body">
    <!-- 刪除確認 -->
    <div v-if="deleteTarget" class="fixed inset-0 z-50 flex items-center justify-center bg-sunken/60 backdrop-blur-sm" @click.self="deleteTarget = null">
      <div class="bg-surface border border-hairline rounded-2xl shadow-2xl w-80 p-6 space-y-4 text-center">
        <p class="text-fg text-sm font-semibold">確定刪除此{{ deleteTarget.kind === 'person' ? '人員' : '單位分機' }}？</p>
        <p class="text-xs text-danger font-bold">「{{ deleteTarget.name }}」{{ deleteTarget.ext }}</p>
        <p class="text-xs text-muted">刪除會同步到其他電腦</p>
        <div class="flex gap-2.5 justify-center pt-3 border-t border-hairline">
          <button @click="deleteTarget = null" class="px-4 py-2 text-xs font-bold bg-elevated border border-hairline text-fg-secondary rounded-xl hover:bg-raised cursor-pointer">取消</button>
          <button @click="doDelete" class="px-4 py-2 text-xs font-bold bg-danger text-white rounded-xl hover:bg-danger-hover cursor-pointer">確認刪除</button>
        </div>
      </div>
    </div>

    <!-- 人員 新增／編輯 -->
    <div v-if="personModal" class="fixed inset-0 z-50 flex items-center justify-center bg-sunken/60 backdrop-blur-sm" @click.self="personModal = false">
      <div class="bg-surface border border-hairline rounded-2xl shadow-2xl w-[440px] max-w-[95vw] p-6 space-y-4 overflow-y-auto max-h-[90vh]">
        <h2 class="text-fg font-black text-sm border-b border-hairline pb-2">{{ personEditId != null ? '編輯人員' : '新增人員' }}</h2>
        <div class="grid grid-cols-2 gap-4">
          <div class="col-span-2">
            <label class="text-xs font-bold text-muted mb-1 block">姓名 *</label>
            <input v-model="personForm.name" autofocus class="w-full px-3.5 py-2.5 rounded-xl bg-sunken border border-hairline text-fg text-sm focus:outline-none focus:border-accent/50 font-bold" />
          </div>
          <div>
            <label class="text-xs font-bold text-muted mb-1 block">科別</label>
            <input v-model="personForm.department" class="w-full px-3.5 py-2.5 rounded-xl bg-sunken border border-hairline text-fg text-sm focus:outline-none focus:border-accent/50" />
          </div>
          <div>
            <label class="text-xs font-bold text-muted mb-1 block">職稱</label>
            <input v-model="personForm.title" class="w-full px-3.5 py-2.5 rounded-xl bg-sunken border border-hairline text-fg text-sm focus:outline-none focus:border-accent/50" />
          </div>
          <div class="col-span-2">
            <label class="text-xs font-bold text-muted mb-1 block">分機</label>
            <input v-model="personForm.ext" class="w-full px-3.5 py-2.5 rounded-xl bg-sunken border border-hairline text-fg text-sm font-mono focus:outline-none focus:border-accent/50" placeholder="例如 5123" />
          </div>
          <div>
            <label class="text-xs font-bold text-muted mb-1 block">HIS 帳號</label>
            <input v-model="personForm.his_account" class="w-full px-3.5 py-2.5 rounded-xl bg-sunken border border-hairline text-fg text-sm font-mono focus:outline-none focus:border-accent/50" />
          </div>
          <div>
            <label class="text-xs font-bold text-muted mb-1 block">HIS 密碼</label>
            <input v-model="personForm.his_password" class="w-full px-3.5 py-2.5 rounded-xl bg-sunken border border-hairline text-fg text-sm font-mono focus:outline-none focus:border-accent/50" />
          </div>
          <div class="col-span-2">
            <label class="text-xs font-bold text-muted mb-1 block">備註</label>
            <input v-model="personForm.notes" class="w-full px-3.5 py-2.5 rounded-xl bg-sunken border border-hairline text-fg text-sm focus:outline-none focus:border-accent/50" />
          </div>
        </div>
        <div class="flex gap-3 justify-end pt-2 border-t border-hairline">
          <button @click="personModal = false" class="px-4 py-2 text-xs font-bold bg-elevated border border-hairline text-fg-secondary rounded-xl hover:bg-raised hover:text-fg transition-colors cursor-pointer">取消</button>
          <button @click="savePerson" class="px-5 py-2 text-xs font-bold bg-accent text-white rounded-xl hover:bg-accent-hover transition-colors cursor-pointer">儲存</button>
        </div>
      </div>
    </div>

    <!-- 單位分機 新增／編輯 -->
    <div v-if="unitModal" class="fixed inset-0 z-50 flex items-center justify-center bg-sunken/60 backdrop-blur-sm" @click.self="unitModal = false">
      <div class="bg-surface border border-hairline rounded-2xl shadow-2xl w-[400px] max-w-[95vw] p-6 space-y-4">
        <h2 class="text-fg font-black text-sm border-b border-hairline pb-2">{{ unitEditId != null ? '編輯單位分機' : '新增單位分機' }}</h2>
        <div class="space-y-3.5">
          <div>
            <label class="text-xs font-bold text-muted mb-1 block">名稱 *</label>
            <input v-model="unitForm.label" autofocus placeholder="護理站、值班室、藥局…"
              class="w-full px-3.5 py-2.5 rounded-xl bg-sunken border border-hairline text-fg text-sm focus:outline-none focus:border-accent/50 font-bold" />
          </div>
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="text-xs font-bold text-muted mb-1 block">分機 *</label>
              <input v-model="unitForm.ext" placeholder="12345"
                class="w-full px-3.5 py-2.5 rounded-xl bg-sunken border border-hairline text-fg text-sm font-mono focus:outline-none focus:border-accent/50" />
            </div>
            <div>
              <label class="text-xs font-bold text-muted mb-1 block">分類</label>
              <input v-model="unitForm.category" placeholder="常用分機" list="unit-categories"
                class="w-full px-3.5 py-2.5 rounded-xl bg-sunken border border-hairline text-fg text-sm focus:outline-none focus:border-accent/50" />
              <datalist id="unit-categories">
                <option v-for="g in [...new Set(contacts.map(c => c.category).filter(Boolean))]" :key="g!" :value="g!" />
              </datalist>
            </div>
          </div>
          <div>
            <label class="text-xs font-bold text-muted mb-1 block">備註</label>
            <input v-model="unitForm.notes" placeholder="選填"
              class="w-full px-3.5 py-2.5 rounded-xl bg-sunken border border-hairline text-fg text-sm focus:outline-none focus:border-accent/50" />
          </div>
        </div>
        <div class="flex gap-3 justify-end pt-2 border-t border-hairline">
          <button @click="unitModal = false" class="px-4 py-2 text-xs font-bold bg-elevated border border-hairline text-fg-secondary rounded-xl hover:bg-raised hover:text-fg transition-colors cursor-pointer">取消</button>
          <button @click="saveUnit" class="px-5 py-2 text-xs font-bold bg-accent text-white rounded-xl hover:bg-accent-hover transition-colors cursor-pointer">儲存</button>
        </div>
      </div>
    </div>

    <!-- Toast -->
    <Transition name="toast">
      <div v-if="toast" class="fixed bottom-6 left-1/2 -translate-x-1/2 px-4 py-2.5 bg-surface border border-hairline text-fg text-xs font-bold rounded-xl shadow-2xl z-[9999] pointer-events-none">
        {{ toast }}
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
/* 名稱｜科別／分類｜職稱｜分機｜HIS 帳號｜HIS 密碼｜備註｜操作 */
.contact-grid {
  display: grid;
  grid-template-columns: minmax(8rem, 1.3fr) minmax(6rem, 1fr) minmax(5rem, 0.8fr) 5.5rem 6.5rem 6.5rem minmax(0, 1.4fr) 6rem;
  column-gap: 0.75rem;
}
.toast-enter-active, .toast-leave-active { transition: opacity 0.25s, transform 0.25s; }
.toast-enter-from, .toast-leave-to { opacity: 0; transform: translateX(-50%) translateY(8px); }
</style>
