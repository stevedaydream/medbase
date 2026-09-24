<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from "vue";
import { ensureSchedLoaded, useSchedStore } from "@/composables/useSchedStore";
import { useSchedSession, schedLogin, schedLogout } from "@/composables/useSchedSession";
import { useSchedSync, startAutoSync, syncSched } from "@/composables/useSchedSync";
import { markNoticesRead } from "@/composables/useSchedFlow";
import PeopleTab from "@/components/sched/PeopleTab.vue";
import SettingsTab from "@/components/sched/SettingsTab.vue";
import ImportTab from "@/components/sched/ImportTab.vue";
import RotaTab from "@/components/sched/RotaTab.vue";
import ScheduleTab from "@/components/sched/ScheduleTab.vue";
import "@/components/sched/sched.css";

type TabKey = "schedule" | "rota" | "people" | "settings" | "import";
const TABS: { key: TabKey; label: string; roles: string[] }[] = [
  { key: "schedule", label: "班表",       roles: ["super", "scheduler", "employee"] },
  { key: "rota",     label: "月份與輪值", roles: ["super", "scheduler"] },
  { key: "people",   label: "人員名單",   roles: ["super", "scheduler"] },
  { key: "settings", label: "班別與規則", roles: ["super", "scheduler"] },
  { key: "import",   label: "Excel 匯入", roles: ["super"] },
];

const store = useSchedStore();
const session = useSchedSession();
const sync = useSchedSync();
const isSuper = computed(() => session.role === "super");
const visibleTabs = computed(() => TABS.filter(t => t.roles.includes(session.role)));
const tab = ref<TabKey>("schedule");
const loadError = ref("");

const toast = ref("");
let toastTimer: ReturnType<typeof setTimeout> | null = null;
function showToast(msg: string) {
  toast.value = msg;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.value = ""; }, 3000);
}

// ── 登入 ─────────────────────────────────────────────────────
const his = ref("");
const pw = ref("");
const loginError = ref("");
const loggingIn = ref(false);
async function onLogin() {
  loginError.value = "";
  loggingIn.value = true;
  try {
    await schedLogin(his.value, pw.value, store.people);
    pw.value = "";
    tab.value = "schedule";
  } catch (e) {
    loginError.value = (e as Error).message;
  } finally {
    loggingIn.value = false;
  }
}
function onLogout() {
  schedLogout();
  showBell.value = false;
}

// ── 通知 ─────────────────────────────────────────────────────
const showBell = ref(false);
const myNotices = computed(() => session.personId
  ? [...store.notices].filter(n => n.personId === session.personId).reverse() : []);
const unread = computed(() => myNotices.value.filter(n => !n.read).length);
async function openBell() {
  showBell.value = !showBell.value;
  if (!showBell.value && session.personId) await markNoticesRead(session.personId);
}

// ── 同步狀態 ─────────────────────────────────────────────────
const syncLabel = computed(() => {
  if (sync.status === "offline") return "☁ 單機模式";
  if (sync.status === "syncing") return "☁ 同步中…";
  if (sync.status === "error") return "☁ 同步失敗";
  if (sync.status === "ok" && sync.lastAt) {
    const d = new Date(sync.lastAt);
    return `☁ 已同步 ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  }
  return "☁";
});

let stopSync: (() => void) | null = null;
onMounted(async () => {
  try {
    await ensureSchedLoaded();
    stopSync = startAutoSync();
  } catch (e) {
    loadError.value = `載入排班資料失敗：${(e as Error).message}`;
  }
});
onUnmounted(() => {
  stopSync?.();
  if (toastTimer) clearTimeout(toastTimer);
});
</script>

<template>
  <div class="h-full flex flex-col overflow-hidden bg-surface">
    <div v-if="loadError" class="p-6 text-sm text-danger">{{ loadError }}</div>
    <div v-else-if="!store.loaded" class="p-6 text-sm text-muted">載入中…</div>

    <!-- 登入 -->
    <div v-else-if="!session.loggedIn" class="flex-1 flex items-center justify-center">
      <form class="w-80 bg-elevated border border-hairline rounded-xl p-6 space-y-3 text-sm" @submit.prevent="onLogin">
        <h2 class="font-semibold text-fg">排班系統登入</h2>
        <p class="text-xs text-muted">使用通訊錄的 HIS 帳號與密碼。尚未匯入人員時，可用舊系統的 super 帳號登入。</p>
        <input v-model="his" placeholder="HIS 帳號" autocomplete="username" class="sched-input w-full py-1.5" />
        <input v-model="pw" type="password" placeholder="HIS 密碼" autocomplete="current-password" class="sched-input w-full py-1.5" />
        <div v-if="loginError" class="text-xs text-danger">{{ loginError }}</div>
        <button type="submit" class="w-full py-1.5 bg-accent hover:bg-accent-hover text-white rounded disabled:opacity-50" :disabled="loggingIn">登入</button>
      </form>
    </div>

    <template v-else>
      <div class="flex items-center gap-1 px-3 border-b border-hairline flex-shrink-0 text-xs">
        <button v-for="t in visibleTabs" :key="t.key"
          class="px-3 py-2 border-b-2 -mb-px transition-colors"
          :class="tab === t.key ? 'border-accent text-fg font-semibold' : 'border-transparent text-muted hover:text-fg-secondary'"
          @click="tab = t.key">{{ t.label }}</button>
        <div class="ml-auto flex items-center gap-3 relative">
          <button class="hover:text-fg" :class="sync.status === 'error' ? 'text-danger' : 'text-muted'"
            :title="sync.message || '點一下立即同步'" @click="syncSched()">{{ syncLabel }}</button>
          <button v-if="session.personId" class="relative text-base leading-none" title="通知" @click="openBell">
            🔔<span v-if="unread" class="absolute -top-1 -right-2 text-2xs bg-danger text-white rounded-full px-1">{{ unread }}</span>
          </button>
          <span class="text-fg-secondary">{{ session.name }}（{{ { super: "super", scheduler: "排班者", employee: "員工" }[session.role] }}）</span>
          <button class="text-muted hover:text-fg" @click="onLogout">登出</button>
          <div v-if="showBell" class="absolute right-0 top-8 z-50 w-96 max-h-96 overflow-y-auto bg-surface border border-hairline rounded-lg shadow-2xl p-2 space-y-1">
            <div v-if="!myNotices.length" class="p-3 text-center text-muted">沒有通知</div>
            <div v-for="n in myNotices" :key="n.id" class="px-2 py-1.5 rounded" :class="n.read ? 'text-muted' : 'bg-elevated text-fg'">
              {{ n.text }}<div class="text-2xs text-muted">{{ new Date(n.at).toLocaleString() }}</div>
            </div>
          </div>
        </div>
      </div>
      <div v-if="sync.conflicts.length" class="px-3 py-1.5 text-xs bg-warning/10 text-warning border-b border-warning/40">{{ sync.message }}</div>

      <div class="flex-1 overflow-hidden">
        <ScheduleTab v-if="tab === 'schedule'" @toast="showToast" />
        <RotaTab v-else-if="tab === 'rota'" @toast="showToast" />
        <PeopleTab v-else-if="tab === 'people'" @toast="showToast" />
        <SettingsTab v-else-if="tab === 'settings'" :can-edit="isSuper" @toast="showToast" />
        <ImportTab v-else-if="tab === 'import'" @toast="showToast" />
      </div>
    </template>

    <div v-if="toast"
      class="fixed bottom-4 right-4 z-50 px-4 py-2 bg-elevated text-fg text-sm rounded-lg shadow-lg border border-hairline">
      {{ toast }}
    </div>
  </div>
</template>
