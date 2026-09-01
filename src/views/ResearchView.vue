<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, nextTick } from "vue";
import { useRouter } from "vue-router";
import {
  listProjects, createProject, isStalled, stageMeta, studyTypeLabel,
  phiWarning, ALL_STAGES, STUDY_TYPES,
  type ProjectListRow, type NewProjectInput, type Stage,
} from "@/composables/useResearch";

const router = useRouter();

const rows      = ref<ProjectListRow[]>([]);
const loading   = ref(true);
const search    = ref("");
const stage     = ref("");
const studyType = ref("");
const archived  = ref(false);

const toast = ref("");
let toastTimer: ReturnType<typeof setTimeout> | null = null;
function showToast(msg: string) {
  toast.value = msg;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.value = ""; }, 2500);
}
onUnmounted(() => { if (toastTimer) clearTimeout(toastTimer); });

// ── 載入（篩選全部下推 SQL）──────────────────────────────────────────
async function load() {
  try {
    rows.value = await listProjects({
      search: search.value, stage: stage.value,
      studyType: studyType.value, archived: archived.value,
    });
    if (cursor.value >= rows.value.length) cursor.value = rows.value.length - 1;
  } catch (e) {
    showToast(`載入失敗：${(e as Error).message}`);
  } finally {
    loading.value = false;
  }
}
onMounted(load);

let searchTimer: ReturnType<typeof setTimeout> | null = null;
function onSearchInput() {
  if (searchTimer) clearTimeout(searchTimer);
  searchTimer = setTimeout(load, 200);
}
onUnmounted(() => { if (searchTimer) clearTimeout(searchTimer); });

const hasAnyFilter = computed(() =>
  !!search.value || !!stage.value || !!studyType.value || archived.value
);

// ── 鍵盤操作（規格 §4：醫院滑鼠環境不佳）─────────────────────────────
const cursor  = ref(-1);
const listEl  = ref<HTMLElement | null>(null);

function onKeydown(e: KeyboardEvent) {
  if (showModal.value) return;
  const tag = (e.target as HTMLElement)?.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
  }
  if (!rows.value.length) return;

  if (e.key === "ArrowDown") {
    e.preventDefault();
    cursor.value = Math.min(cursor.value + 1, rows.value.length - 1);
    scrollCursorIntoView();
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    cursor.value = Math.max(cursor.value - 1, 0);
    scrollCursorIntoView();
  } else if (e.key === "Enter" && cursor.value >= 0) {
    e.preventDefault();
    open(rows.value[cursor.value].id);
  }
}

async function scrollCursorIntoView() {
  await nextTick();
  listEl.value
    ?.querySelector<HTMLElement>(`[data-row-index="${cursor.value}"]`)
    ?.scrollIntoView({ block: "nearest" });
}

onMounted(() => window.addEventListener("keydown", onKeydown));
onUnmounted(() => window.removeEventListener("keydown", onKeydown));

function open(id: string) {
  router.push(`/research/${id}`);
}

// ── 新增專案 ────────────────────────────────────────────────────────
const showModal = ref(false);
const saving    = ref(false);
const form      = ref<NewProjectInput>(blankForm());

function blankForm(): NewProjectInput {
  return {
    title: "", title_zh: "", study_type: "case_report", specialty: "",
    stage: "idea", deident_confirmed: false,
    repo_path: "", irb_number: "", irb_approved_date: "",
  };
}

function openCreate() {
  form.value = blankForm();
  showModal.value = true;
}

// 輕量防呆：警告而非阻擋（規格 §6.3）
const titleWarning = computed(() =>
  phiWarning(form.value.title) ?? phiWarning(form.value.title_zh)
);

async function save() {
  if (!form.value.title.trim())      { showToast("請填寫論文標題"); return; }
  if (!form.value.deident_confirmed) { showToast("請先勾選去識別化確認"); return; }
  saving.value = true;
  try {
    const id = await createProject(form.value);
    showModal.value = false;
    showToast("專案已建立");
    router.push(`/research/${id}`);
  } catch (e) {
    showToast(`建立失敗：${(e as Error).message}`);
  } finally {
    saving.value = false;
  }
}

// ── 樣式輔助 ────────────────────────────────────────────────────────
function badgeClass(s: string): string {
  const tone = stageMeta(s).tone;
  if (tone === "warn")    return "bg-warning/10 border-warning/30 text-warning";
  if (tone === "success") return "bg-success/10 border-success/30 text-success";
  return "bg-elevated border-hairline text-fg-secondary";
}
</script>

<template>
  <div class="accent-fuchsia flex flex-col h-full bg-sunken rounded-2xl border border-hairline shadow-2xl overflow-hidden">

    <!-- Header -->
    <div class="flex items-center gap-3 px-6 py-4 border-b border-hairline shrink-0 bg-surface">
      <div class="relative flex-1 min-w-[200px]">
        <span class="absolute left-3 top-3 text-muted text-sm">🔍</span>
        <input
          v-model="search" @input="onSearchInput"
          placeholder="搜尋標題、中文暫稱、IRB 案號…"
          class="w-full pl-9 pr-4 py-2.5 rounded-xl bg-surface border border-hairline text-fg text-xs placeholder-muted outline-none focus:border-accent/50 focus:ring-2 focus:ring-accent/10 transition-all"
        />
        <button v-if="search" @click="search = ''; load()"
          class="absolute right-3 top-2.5 text-muted hover:text-fg-secondary text-lg leading-none cursor-pointer">×</button>
      </div>

      <div class="text-2xs text-muted font-mono tabular-nums shrink-0 px-3 py-2 rounded-xl bg-sunken border border-hairline">
        {{ rows.length }} 篇
      </div>

      <button @click="openCreate"
        class="px-4 py-2.5 rounded-xl bg-accent text-white text-xs font-bold hover:bg-accent-hover transition-all shadow-lg shadow-accent/10 flex items-center gap-1.5 cursor-pointer shrink-0">
        <span>＋</span> 建立專案
      </button>
    </div>

    <!-- Filters -->
    <div class="flex items-center gap-2 px-6 py-3 border-b border-hairline shrink-0 bg-surface flex-wrap">
      <button
        @click="stage = ''; load()"
        class="shrink-0 px-3 py-1.5 rounded-full text-2xs font-bold tracking-wide transition-all border cursor-pointer"
        :class="stage === '' ? 'bg-accent/10 border-accent/30 text-accent' : 'bg-sunken border-hairline text-muted hover:text-fg-secondary'"
      >全部階段</button>
      <button
        v-for="s in ALL_STAGES" :key="s.key"
        @click="stage = s.key; load()"
        class="shrink-0 px-3 py-1.5 rounded-full text-2xs font-bold tracking-wide transition-all border cursor-pointer"
        :class="stage === s.key ? 'bg-accent/10 border-accent/30 text-accent' : 'bg-sunken border-hairline text-muted hover:text-fg-secondary'"
      >{{ s.label }}</button>

      <div class="flex-1"></div>

      <select v-model="studyType" @change="load()"
        class="px-3 py-1.5 rounded-lg bg-sunken border border-hairline text-fg-secondary text-2xs outline-none focus:border-accent/50 cursor-pointer">
        <option value="">所有研究類型</option>
        <option v-for="t in STUDY_TYPES" :key="t.key" :value="t.key">{{ t.label }}</option>
      </select>

      <label class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-sunken border border-hairline text-2xs text-fg-secondary cursor-pointer">
        <input type="checkbox" v-model="archived" @change="load()" class="accent-accent" />
        已封存
      </label>
    </div>

    <!-- Table -->
    <div ref="listEl" class="flex-1 overflow-y-auto">
      <div v-if="loading" class="text-center py-20 text-muted text-xs">載入中…</div>

      <!-- 空狀態要能行動（規格 §4）-->
      <div v-else-if="!rows.length" class="text-center py-20 px-6">
        <div class="text-4xl mb-3 opacity-20">🎓</div>
        <template v-if="hasAnyFilter">
          <p class="text-fg-secondary text-xs font-semibold">沒有符合條件的專案</p>
          <button @click="search = ''; stage = ''; studyType = ''; archived = false; load()"
            class="mt-4 px-4 py-2 rounded-xl bg-elevated border border-hairline text-fg-secondary text-xs font-bold hover:bg-raised cursor-pointer">
            清除篩選
          </button>
        </template>
        <template v-else>
          <p class="text-fg-secondary text-xs font-semibold">還沒有論文專案</p>
          <p class="text-muted text-2xs mt-1">從選題開始，把一篇論文的所有非寫作事務放進來管理</p>
          <button @click="openCreate"
            class="mt-4 px-5 py-2.5 rounded-xl bg-accent text-white text-xs font-bold hover:bg-accent-hover shadow-lg shadow-accent/10 cursor-pointer">
            建立第一篇
          </button>
        </template>
      </div>

      <table v-else class="w-full text-left border-collapse">
        <thead class="sticky top-0 bg-surface z-10">
          <tr class="border-b border-hairline">
            <th class="px-6 py-2.5 text-2xs font-bold text-muted uppercase tracking-widest">標題</th>
            <th class="px-3 py-2.5 text-2xs font-bold text-muted uppercase tracking-widest w-24">階段</th>
            <th class="px-3 py-2.5 text-2xs font-bold text-muted uppercase tracking-widest w-28">類型</th>
            <th class="px-3 py-2.5 text-2xs font-bold text-muted uppercase tracking-widest w-44">目前期刊</th>
            <th class="px-3 py-2.5 text-2xs font-bold text-muted uppercase tracking-widest w-28 text-right">距上次變更</th>
            <th class="px-6 py-2.5 text-2xs font-bold text-muted uppercase tracking-widest w-24"></th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="(r, i) in rows" :key="r.id"
            :data-row-index="i"
            @click="cursor = i; open(r.id)"
            @mouseenter="cursor = i"
            class="border-b border-hairline cursor-pointer transition-colors"
            :class="[
              cursor === i ? 'bg-elevated' : 'hover:bg-elevated/60',
              isStalled(r) ? 'border-l-2 border-l-warning' : 'border-l-2 border-l-transparent',
            ]"
          >
            <td class="px-6 py-2.5">
              <div class="text-xs text-fg font-semibold leading-snug">{{ r.title }}</div>
              <div v-if="r.title_zh" class="text-2xs text-muted mt-0.5">{{ r.title_zh }}</div>
            </td>
            <td class="px-3 py-2.5">
              <span class="inline-block px-2 py-0.5 rounded-md text-2xs font-bold border" :class="badgeClass(r.stage)">
                {{ stageMeta(r.stage).label }}
              </span>
            </td>
            <td class="px-3 py-2.5 text-2xs text-fg-secondary">{{ studyTypeLabel(r.study_type) }}</td>
            <td class="px-3 py-2.5 text-2xs text-fg-secondary truncate" :title="r.journal_name ?? ''">
              {{ r.journal_name ?? "—" }}
            </td>
            <td class="px-3 py-2.5 text-2xs text-right font-mono tabular-nums"
                :class="isStalled(r) ? 'text-warning font-bold' : 'text-muted'">
              {{ r.days_since_update }} 天
            </td>
            <td class="px-6 py-2.5">
              <span v-if="isStalled(r)"
                class="inline-block px-2 py-0.5 rounded-md text-2xs font-bold border bg-warning/10 border-warning/30 text-warning"
                :title="r.stage === 'under_review' ? '審稿中超過 90 天' : '超過 180 天無進展'">
                停滯
              </span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Footer hint -->
    <div v-if="rows.length" class="px-6 py-2 border-t border-hairline bg-surface shrink-0 text-2xs text-muted">
      ↑ ↓ 移動　Enter 開啟
    </div>
  </div>

  <!-- 建立專案 Modal -->
  <Teleport to="body">
    <div v-if="showModal"
      class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-sunken/60 backdrop-blur-sm"
      @click.self="showModal = false"
    >
      <div class="accent-fuchsia w-full max-w-lg bg-surface border border-hairline rounded-2xl shadow-2xl overflow-hidden max-h-[90vh] flex flex-col">
        <div class="flex items-center justify-between px-5 py-4 border-b border-hairline shrink-0">
          <h3 class="text-fg font-black text-xs">建立論文專案</h3>
          <button @click="showModal = false" class="text-muted hover:text-fg-secondary text-xl leading-none cursor-pointer">×</button>
        </div>

        <div class="px-5 py-4 space-y-3.5 overflow-y-auto">
          <div>
            <label class="text-2xs font-bold text-muted mb-1 block">論文標題（英文）*</label>
            <input v-model="form.title" autofocus
              class="w-full px-3.5 py-2.5 rounded-xl bg-sunken border border-hairline text-fg text-xs focus:outline-none focus:border-accent/50"
              placeholder="A rare presentation of…" />
          </div>
          <div>
            <label class="text-2xs font-bold text-muted mb-1 block">中文暫稱</label>
            <input v-model="form.title_zh"
              class="w-full px-3.5 py-2.5 rounded-xl bg-sunken border border-hairline text-fg text-xs focus:outline-none focus:border-accent/50"
              placeholder="方便搜尋用" />
          </div>

          <p v-if="titleWarning" class="text-2xs text-warning bg-warning/10 border border-warning/30 rounded-lg px-3 py-2">
            ⚠ {{ titleWarning }}
          </p>

          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="text-2xs font-bold text-muted mb-1 block">研究類型</label>
              <select v-model="form.study_type"
                class="w-full px-3.5 py-2.5 rounded-xl bg-sunken border border-hairline text-fg text-xs focus:outline-none focus:border-accent/50 cursor-pointer">
                <option v-for="t in STUDY_TYPES" :key="t.key" :value="t.key">{{ t.label }}</option>
              </select>
            </div>
            <div>
              <label class="text-2xs font-bold text-muted mb-1 block">科別</label>
              <input v-model="form.specialty"
                class="w-full px-3.5 py-2.5 rounded-xl bg-sunken border border-hairline text-fg text-xs focus:outline-none focus:border-accent/50"
                placeholder="骨科 / 整外 / 泌尿…" />
            </div>
          </div>

          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="text-2xs font-bold text-muted mb-1 block">起始階段</label>
              <select v-model="form.stage"
                class="w-full px-3.5 py-2.5 rounded-xl bg-sunken border border-hairline text-fg text-xs focus:outline-none focus:border-accent/50 cursor-pointer">
                <option v-for="s in ALL_STAGES" :key="s.key" :value="s.key as Stage">{{ s.label }}</option>
              </select>
            </div>
            <div>
              <label class="text-2xs font-bold text-muted mb-1 block">IRB 案號</label>
              <input v-model="form.irb_number"
                class="w-full px-3.5 py-2.5 rounded-xl bg-sunken border border-hairline text-fg text-xs focus:outline-none focus:border-accent/50"
                placeholder="選填" />
            </div>
          </div>

          <div>
            <label class="text-2xs font-bold text-muted mb-1 block">本機專案資料夾</label>
            <input v-model="form.repo_path"
              class="w-full px-3.5 py-2.5 rounded-xl bg-sunken border border-hairline text-fg text-xs font-mono focus:outline-none focus:border-accent/50"
              placeholder="I:\paper\case-report-01（選填）" />
          </div>

          <!-- 去識別化強制確認（規格 §6.2）-->
          <label class="flex items-start gap-2.5 px-3.5 py-3 rounded-xl border cursor-pointer transition-colors"
            :class="form.deident_confirmed
              ? 'bg-success/10 border-success/30'
              : 'bg-warning/10 border-warning/30'">
            <input type="checkbox" v-model="form.deident_confirmed" class="mt-0.5 accent-accent shrink-0" />
            <span class="text-2xs leading-relaxed"
              :class="form.deident_confirmed ? 'text-success' : 'text-warning'">
              本專案於本模組中不會輸入任何可識別病患資訊（姓名、病歷號、身分證號、完整生日、住院日期、影像檔）。
            </span>
          </label>
        </div>

        <div class="flex justify-end gap-2.5 px-5 py-3.5 border-t border-hairline shrink-0">
          <button @click="showModal = false"
            class="px-4 py-2 text-xs font-bold bg-elevated border border-hairline text-fg-secondary rounded-xl hover:bg-raised hover:text-fg transition-colors cursor-pointer">取消</button>
          <button @click="save" :disabled="saving || !form.deident_confirmed || !form.title.trim()"
            class="px-5 py-2 text-xs font-bold bg-accent text-white rounded-xl hover:bg-accent-hover transition-all shadow-lg disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer">
            建立專案
          </button>
        </div>
      </div>
    </div>
  </Teleport>

  <!-- Toast -->
  <Teleport to="body">
    <Transition name="slide-up">
      <div v-if="toast"
        class="fixed bottom-6 left-1/2 -translate-x-1/2 px-4.5 py-2.5 bg-surface border border-hairline text-fg text-xs font-bold rounded-xl shadow-2xl z-[9999] pointer-events-none">
        {{ toast }}
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.slide-up-enter-active, .slide-up-leave-active { transition: all 0.25s ease-out; }
.slide-up-enter-from, .slide-up-leave-to { opacity: 0; transform: translate(-50%, 8px); }
</style>
