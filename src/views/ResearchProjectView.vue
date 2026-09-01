<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import {
  getProject, updateProject, setStage, setArchived, deleteProject,
  listProjectAuthors, addProjectAuthor, updateProjectAuthor,
  removeProjectAuthor, reorderProjectAuthors,
  listAuthors, createAuthor, updateAuthor, deleteAuthor, authorUsage,
  buildIrbText, phiWarning, stageMeta,
  STAGE_FLOW, STAGE_REJECTED, STUDY_TYPES, IRB_CATEGORIES,
  type ResearchProject, type ProjectAuthorRow, type ResearchAuthor,
  type AuthorInput, type Stage,
} from "@/composables/useResearch";

const route  = useRoute();
const router = useRouter();
const projectId = computed(() => String(route.params.id ?? ""));

const project = ref<ResearchProject | null>(null);
const loading = ref(true);

const TABS = [
  { key: "overview",   label: "概要" },
  { key: "authors",    label: "作者" },
  { key: "submission", label: "投稿" },
  { key: "checklist",  label: "檢核" },
  { key: "review",     label: "審稿" },
] as const;
type TabKey = (typeof TABS)[number]["key"];
const tab = ref<TabKey>("overview");

const toast = ref("");
let toastTimer: ReturnType<typeof setTimeout> | null = null;
function showToast(msg: string) {
  toast.value = msg;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.value = ""; }, 2500);
}
onUnmounted(() => { if (toastTimer) clearTimeout(toastTimer); });

// ── 載入 ────────────────────────────────────────────────────────────
async function load() {
  loading.value = true;
  try {
    project.value = await getProject(projectId.value);
    if (!project.value) { showToast("找不到此專案"); return; }
    form.value = { ...project.value };
    await loadAuthors();
  } catch (e) {
    showToast(`載入失敗：${(e as Error).message}`);
  } finally {
    loading.value = false;
  }
}
onMounted(load);
watch(projectId, load);

// ── 概要頁籤 ────────────────────────────────────────────────────────
const form  = ref<Partial<ResearchProject>>({});
const dirty = computed(() => {
  if (!project.value) return false;
  const p = project.value, f = form.value;
  return p.title !== f.title || p.title_zh !== f.title_zh
      || p.study_type !== f.study_type || p.specialty !== f.specialty
      || p.repo_path !== f.repo_path || p.irb_number !== f.irb_number
      || p.irb_approved_date !== f.irb_approved_date;
});

const overviewWarning = computed(() =>
  phiWarning(form.value.title) ?? phiWarning(form.value.title_zh)
);

async function saveOverview() {
  if (!form.value.title?.trim()) { showToast("論文標題不可空白"); return; }
  try {
    await updateProject(projectId.value, {
      title: form.value.title.trim(),
      title_zh: form.value.title_zh || null,
      study_type: form.value.study_type || null,
      specialty: form.value.specialty || null,
      repo_path: form.value.repo_path || null,
      irb_number: form.value.irb_number || null,
      irb_approved_date: form.value.irb_approved_date || null,
    });
    project.value = await getProject(projectId.value);
    showToast("專案資料已儲存");
  } catch (e) {
    showToast(`儲存失敗：${(e as Error).message}`);
  }
}

async function changeStage(s: Stage) {
  try {
    await setStage(projectId.value, s);
    project.value = await getProject(projectId.value);
    showToast(`階段已改為「${stageMeta(s).label}」`);
  } catch (e) {
    showToast(`更新失敗：${(e as Error).message}`);
  }
}

async function openRepo() {
  if (!project.value?.repo_path) return;
  try {
    await revealItemInDir(project.value.repo_path);
  } catch (e) {
    showToast(`無法開啟資料夾：${(e as Error).message}`);
  }
}

async function toggleArchive() {
  if (!project.value) return;
  const next = !project.value.archived;
  await setArchived(projectId.value, next);
  project.value = await getProject(projectId.value);
  showToast(next ? "已封存" : "已取消封存");
}

const showDeleteConfirm = ref(false);
async function doDelete() {
  try {
    await deleteProject(projectId.value);
    showDeleteConfirm.value = false;
    router.push("/research");
  } catch (e) {
    showToast(`刪除失敗：${(e as Error).message}`);
  }
}

// ── 作者頁籤 ────────────────────────────────────────────────────────
const projectAuthors = ref<ProjectAuthorRow[]>([]);
const roster         = ref<ResearchAuthor[]>([]);

async function loadAuthors() {
  projectAuthors.value = await listProjectAuthors(projectId.value);
  roster.value         = await listAuthors();
}

/** 名冊中尚未加入本專案的人 */
const availableAuthors = computed(() => {
  const used = new Set(projectAuthors.value.map(a => a.author_id));
  return roster.value.filter(a => !used.has(a.id));
});

const pickAuthorId = ref("");
async function addAuthor() {
  if (!pickAuthorId.value) return;
  try {
    await addProjectAuthor(projectId.value, pickAuthorId.value);
    pickAuthorId.value = "";
    await loadAuthors();
    showToast("已加入作者");
  } catch (e) {
    showToast((e as Error).message);
  }
}

async function patchAuthor(row: ProjectAuthorRow, field: string, value: unknown) {
  try {
    await updateProjectAuthor(row.id, projectId.value, { [field]: value });
  } catch (e) {
    showToast(`儲存失敗：${(e as Error).message}`);
  }
}

/** 通訊作者同時只能有一位 */
async function setCorresponding(row: ProjectAuthorRow) {
  const next = row.is_corresponding ? 0 : 1;
  for (const a of projectAuthors.value) {
    const val = a.id === row.id ? next : 0;
    if (a.is_corresponding !== val) await updateProjectAuthor(a.id, projectId.value, { is_corresponding: val });
  }
  await loadAuthors();
}

async function removeAuthor(row: ProjectAuthorRow) {
  await removeProjectAuthor(row.id, projectId.value);
  await loadAuthors();
  showToast("已移除作者");
}

// ── 掛名順序拖曳（Tauri WebView 的 HTML5 DnD 不可靠，用 Pointer Events）─
const dragFrom   = ref<number | null>(null);
const dragTo     = ref<number | null>(null);
const isDragging = ref(false);

function onRowPointerDown(e: PointerEvent, index: number) {
  if (e.button !== 0) return;
  e.preventDefault();
  dragFrom.value = index;
  dragTo.value   = index;
  isDragging.value = false;
  document.addEventListener("pointermove", onDocPointerMove);
  document.addEventListener("pointerup",   onDocPointerUp);
}

function onDocPointerMove(e: PointerEvent) {
  if (dragFrom.value === null) return;
  isDragging.value = true;
  const els = document.querySelectorAll<HTMLElement>("[data-author-index]");
  els.forEach(el => {
    const rect = el.getBoundingClientRect();
    if (e.clientY >= rect.top && e.clientY < rect.bottom) {
      dragTo.value = parseInt(el.dataset.authorIndex ?? "-1");
    }
  });
}

async function onDocPointerUp() {
  document.removeEventListener("pointermove", onDocPointerMove);
  document.removeEventListener("pointerup",   onDocPointerUp);

  const from = dragFrom.value, to = dragTo.value;
  dragFrom.value = null;
  dragTo.value   = null;

  if (isDragging.value && from !== null && to !== null && from !== to && to >= 0) {
    const items = [...projectAuthors.value];
    const [moved] = items.splice(from, 1);
    items.splice(to, 0, moved);
    projectAuthors.value = items;
    await reorderProjectAuthors(projectId.value, items.map(i => i.id));
    await loadAuthors();
  }
  isDragging.value = false;
}

onUnmounted(() => {
  document.removeEventListener("pointermove", onDocPointerMove);
  document.removeEventListener("pointerup",   onDocPointerUp);
});

// ── IRB 文字產生器（規格 §3.3）───────────────────────────────────────
const irbPreview = ref("");
const showIrbModal = ref(false);

function generateIrb() {
  if (!projectAuthors.value.length) { showToast("請先加入作者"); return; }
  irbPreview.value = buildIrbText(projectAuthors.value);
  showIrbModal.value = true;
}

async function copyIrb() {
  try {
    await navigator.clipboard.writeText(irbPreview.value);
    showToast("IRB 文字已複製");
  } catch {
    showToast("複製失敗，請手動選取");
  }
}

// ── 作者名冊管理 ────────────────────────────────────────────────────
const showRoster    = ref(false);
const rosterMode    = ref<"add" | "edit">("add");
const rosterEditId  = ref<string | null>(null);
const rosterForm    = ref<AuthorInput>(blankAuthor());

function blankAuthor(): AuthorInput {
  return {
    name_zh: "", name_en: "", title: "", department: "",
    affiliation: "", email: "", default_role: "", orcid: "",
  };
}

function openRosterAdd() {
  rosterMode.value = "add";
  rosterEditId.value = null;
  rosterForm.value = blankAuthor();
  showRoster.value = true;
}

function openRosterEdit(a: ResearchAuthor) {
  rosterMode.value = "edit";
  rosterEditId.value = a.id;
  rosterForm.value = {
    name_zh: a.name_zh, name_en: a.name_en ?? "", title: a.title ?? "",
    department: a.department ?? "", affiliation: a.affiliation ?? "",
    email: a.email ?? "", default_role: a.default_role ?? "", orcid: a.orcid ?? "",
  };
  showRoster.value = true;
}

async function saveRoster() {
  if (!rosterForm.value.name_zh.trim()) { showToast("請填寫姓名"); return; }
  try {
    if (rosterMode.value === "add") {
      const id = await createAuthor(rosterForm.value);
      await loadAuthors();
      showRoster.value = false;
      // 從專案頁新增名冊成員時，直接把人掛上這篇論文
      await addProjectAuthor(projectId.value, id);
      await loadAuthors();
      showToast("已新增至名冊並加入本專案");
    } else if (rosterEditId.value) {
      await updateAuthor(rosterEditId.value, rosterForm.value);
      await loadAuthors();
      showRoster.value = false;
      showToast("名冊資料已更新");
    }
  } catch (e) {
    showToast(`儲存失敗：${(e as Error).message}`);
  }
}

async function removeFromRoster(a: ResearchAuthor) {
  const n = await authorUsage(a.id);
  const msg = n > 0
    ? `「${a.name_zh}」目前掛名於 ${n} 篇論文，刪除會一併從那些論文移除。確定？`
    : `確定從名冊刪除「${a.name_zh}」？`;
  if (!window.confirm(msg)) return;
  await deleteAuthor(a.id);
  await loadAuthors();
  showToast("已從名冊刪除");
}

const showRosterList = ref(false);

// ── 樣式輔助 ────────────────────────────────────────────────────────
function badgeClass(s: string): string {
  const tone = stageMeta(s).tone;
  if (tone === "warn")    return "bg-warning/10 border-warning/30 text-warning";
  if (tone === "success") return "bg-success/10 border-success/30 text-success";
  return "bg-elevated border-hairline text-fg-secondary";
}

const currentIndex = computed(() =>
  STAGE_FLOW.findIndex(s => s.key === project.value?.stage)
);
</script>

<template>
  <div class="accent-fuchsia flex flex-col h-full bg-sunken rounded-2xl border border-hairline shadow-2xl overflow-hidden">

    <div v-if="loading" class="flex-1 flex items-center justify-center text-muted text-xs">載入中…</div>

    <div v-else-if="!project" class="flex-1 flex flex-col items-center justify-center gap-3">
      <p class="text-muted text-xs">找不到此專案</p>
      <button @click="router.push('/research')"
        class="px-4 py-2 rounded-xl bg-elevated border border-hairline text-fg-secondary text-xs font-bold hover:bg-raised cursor-pointer">回到清單</button>
    </div>

    <template v-else>
      <!-- Header -->
      <div class="px-6 py-4 border-b border-hairline shrink-0 bg-surface">
        <div class="flex items-start gap-3">
          <button @click="router.push('/research')"
            class="mt-0.5 px-2.5 py-1.5 rounded-lg bg-elevated border border-hairline text-fg-secondary text-2xs font-bold hover:bg-raised transition-colors shrink-0 cursor-pointer">← 清單</button>

          <div class="flex-1 min-w-0">
            <h2 class="text-sm font-bold text-fg leading-snug">{{ project.title }}</h2>
            <p v-if="project.title_zh" class="text-2xs text-muted mt-0.5">{{ project.title_zh }}</p>
          </div>

          <span class="px-2.5 py-1 rounded-md text-2xs font-bold border shrink-0" :class="badgeClass(project.stage)">
            {{ stageMeta(project.stage).label }}
          </span>
          <span v-if="project.archived"
            class="px-2.5 py-1 rounded-md text-2xs font-bold border border-hairline bg-elevated text-muted shrink-0">已封存</span>
        </div>

        <!-- 階段進度條 -->
        <div class="mt-4 flex items-center gap-1">
          <template v-for="(s, i) in STAGE_FLOW" :key="s.key">
            <button
              @click="changeStage(s.key)"
              :title="`切換至「${s.label}」`"
              class="flex-1 px-1 py-1.5 rounded-md text-2xs font-bold border transition-all cursor-pointer"
              :class="project.stage === s.key
                ? badgeClass(s.key) + ' ring-1 ring-accent/40'
                : (currentIndex >= 0 && i < currentIndex
                    ? 'bg-elevated border-hairline text-fg-secondary'
                    : 'bg-sunken border-hairline text-muted hover:text-fg-secondary')"
            >{{ s.label }}</button>
          </template>
        </div>

        <!-- rejected 分支：拒稿後可回到 submitted 換期刊（規格 §2.2）-->
        <div class="mt-1.5 flex items-center gap-2">
          <span class="text-2xs text-muted">拒稿分支</span>
          <button
            @click="changeStage(STAGE_REJECTED.key)"
            class="px-2.5 py-1 rounded-md text-2xs font-bold border transition-all cursor-pointer"
            :class="project.stage === STAGE_REJECTED.key
              ? 'bg-warning/10 border-warning/30 text-warning ring-1 ring-warning/40'
              : 'bg-sunken border-hairline text-muted hover:text-fg-secondary'"
          >{{ STAGE_REJECTED.label }}</button>
          <template v-if="project.stage === 'rejected'">
            <span class="text-2xs text-muted">→</span>
            <button @click="changeStage('submitted')"
              class="px-2.5 py-1 rounded-md text-2xs font-bold border border-accent/30 bg-accent/10 text-accent hover:bg-accent/20 transition-all cursor-pointer">
              換期刊再投（回到「已投稿」）
            </button>
          </template>
        </div>
      </div>

      <!-- Tabs -->
      <div class="flex gap-1 px-6 pt-3 border-b border-hairline shrink-0 bg-surface">
        <button
          v-for="t in TABS" :key="t.key"
          @click="tab = t.key"
          class="px-4 py-2 rounded-t-lg text-xs font-bold border border-b-0 transition-colors cursor-pointer"
          :class="tab === t.key
            ? 'bg-sunken border-hairline text-accent'
            : 'bg-transparent border-transparent text-muted hover:text-fg-secondary'"
        >
          {{ t.label }}
          <span v-if="t.key === 'authors' && projectAuthors.length"
            class="ml-1 text-2xs text-muted font-mono">{{ projectAuthors.length }}</span>
        </button>
      </div>

      <!-- Tab body -->
      <div class="flex-1 overflow-y-auto px-6 py-5">

        <!-- ══ 概要 ══════════════════════════════════════════════ -->
        <div v-if="tab === 'overview'" class="max-w-3xl space-y-5">
          <div class="grid grid-cols-2 gap-4">
            <div class="col-span-2">
              <label class="text-2xs font-bold text-muted mb-1 block">論文標題（英文）*</label>
              <input v-model="form.title"
                class="w-full px-3.5 py-2.5 rounded-xl bg-surface border border-hairline text-fg text-xs focus:outline-none focus:border-accent/50" />
            </div>
            <div class="col-span-2">
              <label class="text-2xs font-bold text-muted mb-1 block">中文暫稱</label>
              <input v-model="form.title_zh"
                class="w-full px-3.5 py-2.5 rounded-xl bg-surface border border-hairline text-fg text-xs focus:outline-none focus:border-accent/50" />
            </div>

            <p v-if="overviewWarning" class="col-span-2 text-2xs text-warning bg-warning/10 border border-warning/30 rounded-lg px-3 py-2">
              ⚠ {{ overviewWarning }}
            </p>

            <div>
              <label class="text-2xs font-bold text-muted mb-1 block">研究類型</label>
              <select v-model="form.study_type"
                class="w-full px-3.5 py-2.5 rounded-xl bg-surface border border-hairline text-fg text-xs focus:outline-none focus:border-accent/50 cursor-pointer">
                <option :value="null">未設定</option>
                <option v-for="t in STUDY_TYPES" :key="t.key" :value="t.key">{{ t.label }}</option>
              </select>
            </div>
            <div>
              <label class="text-2xs font-bold text-muted mb-1 block">科別</label>
              <input v-model="form.specialty"
                class="w-full px-3.5 py-2.5 rounded-xl bg-surface border border-hairline text-fg text-xs focus:outline-none focus:border-accent/50" />
            </div>

            <div>
              <label class="text-2xs font-bold text-muted mb-1 block">IRB 案號</label>
              <input v-model="form.irb_number"
                class="w-full px-3.5 py-2.5 rounded-xl bg-surface border border-hairline text-fg text-xs focus:outline-none focus:border-accent/50" />
            </div>
            <div>
              <label class="text-2xs font-bold text-muted mb-1 block">IRB 核准日</label>
              <input v-model="form.irb_approved_date" type="date"
                class="w-full px-3.5 py-2.5 rounded-xl bg-surface border border-hairline text-fg text-xs focus:outline-none focus:border-accent/50" />
            </div>

            <div class="col-span-2">
              <label class="text-2xs font-bold text-muted mb-1 block">本機專案資料夾</label>
              <div class="flex gap-2">
                <input v-model="form.repo_path"
                  class="flex-1 px-3.5 py-2.5 rounded-xl bg-surface border border-hairline text-fg text-xs font-mono focus:outline-none focus:border-accent/50"
                  placeholder="I:\paper\case-report-01" />
                <button @click="openRepo" :disabled="!project.repo_path"
                  class="px-4 py-2.5 rounded-xl bg-elevated border border-hairline text-fg-secondary text-xs font-bold hover:bg-raised disabled:opacity-40 transition-colors cursor-pointer shrink-0">
                  開啟資料夾
                </button>
              </div>
            </div>
          </div>

          <div class="flex items-center gap-2.5 pt-2">
            <button @click="saveOverview" :disabled="!dirty"
              class="px-5 py-2.5 rounded-xl bg-accent text-white text-xs font-bold hover:bg-accent-hover shadow-lg shadow-accent/10 disabled:opacity-40 disabled:cursor-not-allowed transition-all cursor-pointer">
              儲存變更
            </button>
            <span v-if="dirty" class="text-2xs text-warning">有未儲存的變更</span>
            <div class="flex-1"></div>
            <button @click="toggleArchive"
              class="px-4 py-2.5 rounded-xl bg-elevated border border-hairline text-fg-secondary text-xs font-bold hover:bg-raised transition-colors cursor-pointer">
              {{ project.archived ? "取消封存" : "封存專案" }}
            </button>
            <button @click="showDeleteConfirm = true"
              class="px-4 py-2.5 rounded-xl bg-danger/10 border border-danger/20 text-danger text-xs font-bold hover:bg-danger/20 transition-colors cursor-pointer">
              刪除
            </button>
          </div>

          <div class="pt-3 border-t border-hairline text-2xs text-muted space-y-1">
            <p>建立於 {{ project.created_at }}　最後變更 {{ project.updated_at }}</p>
            <p class="text-success">✓ 已確認本專案不輸入任何可識別病患資訊</p>
          </div>
        </div>

        <!-- ══ 作者 ══════════════════════════════════════════════ -->
        <div v-else-if="tab === 'authors'" class="space-y-4">
          <div class="flex items-center gap-2 flex-wrap">
            <select v-model="pickAuthorId"
              class="px-3.5 py-2 rounded-xl bg-surface border border-hairline text-fg text-xs focus:outline-none focus:border-accent/50 cursor-pointer min-w-[180px]">
              <option value="">從名冊選取作者…</option>
              <option v-for="a in availableAuthors" :key="a.id" :value="a.id">
                {{ a.name_zh }}{{ a.title ? `（${a.title}）` : "" }}
              </option>
            </select>
            <button @click="addAuthor" :disabled="!pickAuthorId"
              class="px-4 py-2 rounded-xl bg-accent text-white text-xs font-bold hover:bg-accent-hover disabled:opacity-40 disabled:cursor-not-allowed transition-all cursor-pointer">
              加入專案
            </button>
            <button @click="openRosterAdd"
              class="px-4 py-2 rounded-xl bg-elevated border border-hairline text-fg-secondary text-xs font-bold hover:bg-raised transition-colors cursor-pointer">
              ＋ 名冊新增
            </button>
            <button @click="showRosterList = true"
              class="px-4 py-2 rounded-xl bg-elevated border border-hairline text-fg-secondary text-xs font-bold hover:bg-raised transition-colors cursor-pointer">
              管理名冊（{{ roster.length }}）
            </button>

            <div class="flex-1"></div>

            <button @click="generateIrb"
              class="px-4 py-2 rounded-xl bg-accent/10 border border-accent/30 text-accent text-xs font-bold hover:bg-accent/20 transition-all cursor-pointer">
              產生 IRB 文字
            </button>
          </div>

          <div v-if="!projectAuthors.length"
            class="text-center py-16 rounded-2xl border border-dashed border-hairline bg-surface">
            <div class="text-3xl mb-2 opacity-20">👥</div>
            <p class="text-fg-secondary text-xs font-semibold">尚未加入作者</p>
            <p class="text-muted text-2xs mt-1">作者資料建一次，之後每份 IRB 都是選取而非重打</p>
          </div>

          <div v-else class="space-y-2.5">
            <div
              v-for="(a, i) in projectAuthors" :key="a.id"
              :data-author-index="i"
              class="rounded-2xl border bg-surface transition-all"
              :class="[
                dragFrom === i && isDragging ? 'opacity-30' : '',
                dragTo === i && isDragging && dragFrom !== i ? 'border-accent/40' : 'border-hairline',
              ]"
            >
              <!-- 作者列頭 -->
              <div class="flex items-center gap-2.5 px-4 py-2.5 border-b border-hairline">
                <span
                  @pointerdown="onRowPointerDown($event, i)"
                  title="拖曳調整掛名順序"
                  class="text-muted text-sm select-none cursor-grab active:cursor-grabbing shrink-0">⠿</span>
                <span class="w-6 h-6 rounded-md bg-elevated border border-hairline flex items-center justify-center text-2xs font-mono font-bold text-fg-secondary shrink-0">
                  {{ a.author_order }}
                </span>
                <span class="text-xs font-bold text-fg">{{ a.name_zh }}</span>
                <span v-if="a.name_en" class="text-2xs text-muted">{{ a.name_en }}</span>
                <span v-if="a.title" class="text-2xs text-muted">· {{ a.title }}</span>
                <span v-if="a.author_order === 1"
                  class="px-2 py-0.5 rounded-md text-2xs font-bold border border-hairline bg-elevated text-fg-secondary">first author</span>

                <div class="flex-1"></div>

                <button @click="setCorresponding(a)"
                  class="px-2.5 py-1 rounded-md text-2xs font-bold border transition-colors cursor-pointer"
                  :class="a.is_corresponding
                    ? 'bg-accent/10 border-accent/30 text-accent'
                    : 'bg-sunken border-hairline text-muted hover:text-fg-secondary'">
                  通訊作者
                </button>
                <button @click="removeAuthor(a)"
                  class="px-2.5 py-1 rounded-md text-2xs font-bold bg-danger/10 border border-danger/20 text-danger hover:bg-danger/20 transition-colors cursor-pointer">
                  移除
                </button>
              </div>

              <!-- IRB 欄位 -->
              <div class="px-4 py-3 grid grid-cols-4 gap-3">
                <div>
                  <label class="text-2xs font-bold text-muted mb-1 block">IRB 角色</label>
                  <input
                    :value="a.irb_category ?? ''"
                    @change="patchAuthor(a, 'irb_category', ($event.target as HTMLInputElement).value || null)"
                    list="irb-categories"
                    class="w-full px-3 py-2 rounded-lg bg-sunken border border-hairline text-fg text-2xs focus:outline-none focus:border-accent/50" />
                </div>
                <div>
                  <label class="text-2xs font-bold text-muted mb-1 block">工作月數</label>
                  <input
                    type="number" min="0"
                    :value="a.work_months ?? ''"
                    @change="patchAuthor(a, 'work_months', ($event.target as HTMLInputElement).value === '' ? null : Number(($event.target as HTMLInputElement).value))"
                    class="w-full px-3 py-2 rounded-lg bg-sunken border border-hairline text-fg text-2xs font-mono focus:outline-none focus:border-accent/50" />
                </div>
                <div class="col-span-2">
                  <label class="text-2xs font-bold text-muted mb-1 block">期刊 author contribution</label>
                  <input
                    :value="a.contribution ?? ''"
                    @change="patchAuthor(a, 'contribution', ($event.target as HTMLInputElement).value || null)"
                    placeholder="Conceptualization, Writing – original draft…"
                    class="w-full px-3 py-2 rounded-lg bg-sunken border border-hairline text-fg text-2xs focus:outline-none focus:border-accent/50" />
                </div>
                <div class="col-span-4">
                  <label class="text-2xs font-bold text-muted mb-1 block">IRB 具體工作性質、項目及範圍</label>
                  <textarea
                    rows="2"
                    :value="a.work_scope ?? ''"
                    @change="patchAuthor(a, 'work_scope', ($event.target as HTMLTextAreaElement).value || null)"
                    placeholder="負責病歷資料收集與整理、文獻查閱、論文撰寫及投稿作業。"
                    class="w-full px-3 py-2 rounded-lg bg-sunken border border-hairline text-fg text-2xs leading-relaxed focus:outline-none focus:border-accent/50 resize-y"></textarea>
                </div>
              </div>
            </div>
          </div>

          <datalist id="irb-categories">
            <option v-for="c in IRB_CATEGORIES" :key="c" :value="c" />
          </datalist>
        </div>

        <!-- ══ 尚未實作的頁籤 ══════════════════════════════════════ -->
        <div v-else class="text-center py-20 rounded-2xl border border-dashed border-hairline bg-surface">
          <div class="text-3xl mb-2 opacity-20">
            {{ tab === "submission" ? "📮" : tab === "checklist" ? "☑" : "💬" }}
          </div>
          <p class="text-fg-secondary text-xs font-semibold">
            {{ tab === "submission" ? "投稿記錄" : tab === "checklist" ? "送件檢核" : "審稿回覆" }}
          </p>
          <p class="text-muted text-2xs mt-1">
            資料表已建好，介面待
            {{ tab === "submission" ? "Phase 5" : tab === "checklist" ? "Phase 4" : "Phase 7" }}
            實作
          </p>
        </div>

      </div>
    </template>
  </div>

  <!-- IRB 文字 Modal -->
  <Teleport to="body">
    <div v-if="showIrbModal"
      class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-sunken/60 backdrop-blur-sm"
      @click.self="showIrbModal = false">
      <div class="accent-fuchsia w-full max-w-xl bg-surface border border-hairline rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
        <div class="flex items-center justify-between px-5 py-4 border-b border-hairline shrink-0">
          <h3 class="text-fg font-black text-xs">IRB 工作範圍文字</h3>
          <button @click="showIrbModal = false" class="text-muted hover:text-fg-secondary text-xl leading-none cursor-pointer">×</button>
        </div>
        <div class="px-5 py-4 overflow-y-auto">
          <textarea v-model="irbPreview" rows="14"
            class="w-full px-3.5 py-3 rounded-xl bg-sunken border border-hairline text-fg text-xs leading-relaxed focus:outline-none focus:border-accent/50 resize-y"></textarea>
          <p class="text-2xs text-muted mt-2">可直接貼進醫院表格；有需要也可在此微調後再複製。</p>
        </div>
        <div class="flex justify-end gap-2.5 px-5 py-3.5 border-t border-hairline shrink-0">
          <button @click="showIrbModal = false"
            class="px-4 py-2 text-xs font-bold bg-elevated border border-hairline text-fg-secondary rounded-xl hover:bg-raised cursor-pointer">關閉</button>
          <button @click="copyIrb"
            class="px-5 py-2 text-xs font-bold bg-accent text-white rounded-xl hover:bg-accent-hover shadow-lg cursor-pointer">複製</button>
        </div>
      </div>
    </div>
  </Teleport>

  <!-- 名冊清單 Modal -->
  <Teleport to="body">
    <div v-if="showRosterList"
      class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-sunken/60 backdrop-blur-sm"
      @click.self="showRosterList = false">
      <div class="accent-fuchsia w-full max-w-2xl bg-surface border border-hairline rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
        <div class="flex items-center justify-between px-5 py-4 border-b border-hairline shrink-0">
          <h3 class="text-fg font-black text-xs">作者名冊（跨專案共用）</h3>
          <div class="flex items-center gap-2">
            <button @click="showRosterList = false; openRosterAdd()"
              class="px-3 py-1.5 rounded-lg bg-accent text-white text-2xs font-bold hover:bg-accent-hover cursor-pointer">＋ 新增</button>
            <button @click="showRosterList = false" class="text-muted hover:text-fg-secondary text-xl leading-none cursor-pointer">×</button>
          </div>
        </div>
        <div class="overflow-y-auto">
          <div v-if="!roster.length" class="text-center py-16 text-muted text-xs">名冊還是空的</div>
          <table v-else class="w-full text-left border-collapse">
            <thead class="sticky top-0 bg-surface">
              <tr class="border-b border-hairline">
                <th class="px-5 py-2 text-2xs font-bold text-muted uppercase tracking-widest">姓名</th>
                <th class="px-3 py-2 text-2xs font-bold text-muted uppercase tracking-widest">職稱 / 科別</th>
                <th class="px-3 py-2 text-2xs font-bold text-muted uppercase tracking-widest">預設角色</th>
                <th class="px-5 py-2 text-2xs font-bold text-muted uppercase tracking-widest w-28"></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="a in roster" :key="a.id" class="border-b border-hairline hover:bg-elevated/60">
                <td class="px-5 py-2.5">
                  <div class="text-xs text-fg font-semibold">{{ a.name_zh }}</div>
                  <div v-if="a.name_en" class="text-2xs text-muted">{{ a.name_en }}</div>
                </td>
                <td class="px-3 py-2.5 text-2xs text-fg-secondary">
                  {{ [a.title, a.department].filter(Boolean).join(" · ") || "—" }}
                </td>
                <td class="px-3 py-2.5 text-2xs text-fg-secondary">{{ a.default_role || "—" }}</td>
                <td class="px-5 py-2.5 text-right">
                  <button @click="showRosterList = false; openRosterEdit(a)"
                    class="text-2xs font-bold px-2 py-1 rounded bg-elevated border border-hairline text-fg-secondary hover:text-accent cursor-pointer">編輯</button>
                  <button @click="removeFromRoster(a)"
                    class="ml-1.5 text-2xs font-bold px-2 py-1 rounded bg-danger/10 border border-danger/20 text-danger hover:bg-danger/20 cursor-pointer">刪除</button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </Teleport>

  <!-- 名冊新增 / 編輯 Modal -->
  <Teleport to="body">
    <div v-if="showRoster"
      class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-sunken/60 backdrop-blur-sm"
      @click.self="showRoster = false">
      <div class="accent-fuchsia w-full max-w-lg bg-surface border border-hairline rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        <div class="flex items-center justify-between px-5 py-4 border-b border-hairline shrink-0">
          <h3 class="text-fg font-black text-xs">{{ rosterMode === "add" ? "新增作者到名冊" : "編輯名冊資料" }}</h3>
          <button @click="showRoster = false" class="text-muted hover:text-fg-secondary text-xl leading-none cursor-pointer">×</button>
        </div>
        <div class="px-5 py-4 grid grid-cols-2 gap-3 overflow-y-auto">
          <div>
            <label class="text-2xs font-bold text-muted mb-1 block">中文姓名 *</label>
            <input v-model="rosterForm.name_zh" autofocus
              class="w-full px-3.5 py-2.5 rounded-xl bg-sunken border border-hairline text-fg text-xs focus:outline-none focus:border-accent/50" />
          </div>
          <div>
            <label class="text-2xs font-bold text-muted mb-1 block">英文名（投稿用）</label>
            <input v-model="rosterForm.name_en"
              class="w-full px-3.5 py-2.5 rounded-xl bg-sunken border border-hairline text-fg text-xs focus:outline-none focus:border-accent/50" />
          </div>
          <div>
            <label class="text-2xs font-bold text-muted mb-1 block">職稱</label>
            <input v-model="rosterForm.title"
              class="w-full px-3.5 py-2.5 rounded-xl bg-sunken border border-hairline text-fg text-xs focus:outline-none focus:border-accent/50"
              placeholder="主治醫師 / 專科護理師" />
          </div>
          <div>
            <label class="text-2xs font-bold text-muted mb-1 block">科別</label>
            <input v-model="rosterForm.department"
              class="w-full px-3.5 py-2.5 rounded-xl bg-sunken border border-hairline text-fg text-xs focus:outline-none focus:border-accent/50" />
          </div>
          <div class="col-span-2">
            <label class="text-2xs font-bold text-muted mb-1 block">服務機構全名（投稿用）</label>
            <input v-model="rosterForm.affiliation"
              class="w-full px-3.5 py-2.5 rounded-xl bg-sunken border border-hairline text-fg text-xs focus:outline-none focus:border-accent/50" />
          </div>
          <div>
            <label class="text-2xs font-bold text-muted mb-1 block">Email</label>
            <input v-model="rosterForm.email"
              class="w-full px-3.5 py-2.5 rounded-xl bg-sunken border border-hairline text-fg text-xs focus:outline-none focus:border-accent/50" />
          </div>
          <div>
            <label class="text-2xs font-bold text-muted mb-1 block">ORCID</label>
            <input v-model="rosterForm.orcid"
              class="w-full px-3.5 py-2.5 rounded-xl bg-sunken border border-hairline text-fg text-xs font-mono focus:outline-none focus:border-accent/50" />
          </div>
          <div class="col-span-2">
            <label class="text-2xs font-bold text-muted mb-1 block">預設 IRB 角色（加入專案時預帶）</label>
            <input v-model="rosterForm.default_role" list="irb-categories-roster"
              class="w-full px-3.5 py-2.5 rounded-xl bg-sunken border border-hairline text-fg text-xs focus:outline-none focus:border-accent/50" />
            <datalist id="irb-categories-roster">
              <option v-for="c in IRB_CATEGORIES" :key="c" :value="c" />
            </datalist>
          </div>
        </div>
        <div class="flex justify-end gap-2.5 px-5 py-3.5 border-t border-hairline shrink-0">
          <button @click="showRoster = false"
            class="px-4 py-2 text-xs font-bold bg-elevated border border-hairline text-fg-secondary rounded-xl hover:bg-raised cursor-pointer">取消</button>
          <button @click="saveRoster"
            class="px-5 py-2 text-xs font-bold bg-accent text-white rounded-xl hover:bg-accent-hover shadow-lg cursor-pointer">儲存</button>
        </div>
      </div>
    </div>
  </Teleport>

  <!-- 刪除確認 -->
  <Teleport to="body">
    <div v-if="showDeleteConfirm"
      class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-sunken/60 backdrop-blur-sm"
      @click.self="showDeleteConfirm = false">
      <div class="w-full max-w-xs bg-surface border border-hairline rounded-2xl shadow-2xl p-5 text-center">
        <p class="text-fg text-sm font-semibold mb-1">確定刪除此專案？</p>
        <p class="text-xs text-muted mb-6">作者掛名、投稿記錄、檢核與審稿意見會一併刪除，無法復原。</p>
        <div class="flex gap-2.5 justify-center">
          <button @click="showDeleteConfirm = false"
            class="px-4 py-2 text-xs font-bold bg-elevated border border-hairline text-fg-secondary rounded-xl hover:bg-raised cursor-pointer">取消</button>
          <button @click="doDelete"
            class="px-4 py-2 text-xs font-bold bg-danger text-white rounded-xl shadow-lg shadow-danger/10 cursor-pointer">確認刪除</button>
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
