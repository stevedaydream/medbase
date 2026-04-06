<script setup lang="ts">
import { ref, onMounted, onUnmounted } from "vue";
import { useRoute, useRouter } from "vue-router";
import { check as checkUpdate } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

const route  = useRoute();
const router = useRouter();

interface NavItem { path: string; icon: string; label: string }

const DEFAULT_NAV: NavItem[] = [
  { path: "/medications", icon: "💊", label: "藥物字典" },
  { path: "/prescriptions", icon: "📋", label: "處方套組" },
  { path: "/surgery",     icon: "🔪", label: "手術處置" },
  { path: "/disease",     icon: "🏥", label: "疾病常規" },
  { path: "/examination", icon: "🔬", label: "檢查處置" },
  { path: "/items",       icon: "📦", label: "自費品項" },
  { path: "/sets",        icon: "🗂️", label: "套組管理" },
  { path: "/acp",         icon: "📜", label: "ACP 評估" },
  { path: "/physicians",  icon: "👨‍⚕️", label: "醫師通訊錄" },
  { path: "/schedule",    icon: "📅", label: "排班表" },
  { path: "/tools",       icon: "🧮", label: "臨床工具" },
];

const navItems = ref<NavItem[]>([...DEFAULT_NAV]);

const bottomNav: NavItem[] = [
  { path: "/ahk",  icon: "⌨",  label: "AHK 管理" },
  { path: "/data", icon: "⚙️", label: "資料管理" },
];

// ── Persist order ──────────────────────────────────────────────────────
const STORAGE_KEY = "sidebar-nav-order";

onMounted(() => {
  try {
    const saved: string[] = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
    if (!saved.length) return;
    const ordered = saved
      .map(p => DEFAULT_NAV.find(n => n.path === p))
      .filter(Boolean) as NavItem[];
    DEFAULT_NAV.forEach(item => {
      if (!ordered.find(o => o.path === item.path)) ordered.push(item);
    });
    navItems.value = ordered;
  } catch { /* ignore */ }
});

function saveOrder() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(navItems.value.map(n => n.path)));
}

// ── Pointer-based drag ─────────────────────────────────────────────────
const dragFrom   = ref<number | null>(null);
const dragTo     = ref<number | null>(null);
const isDragging = ref(false);
const ghost      = ref({ visible: false, y: 0, label: "", icon: "" });

function onItemPointerDown(e: PointerEvent, index: number) {
  // Only main button
  if (e.button !== 0) return;
  e.preventDefault();

  dragFrom.value   = index;
  dragTo.value     = index;
  isDragging.value = false; // only set true after slight movement
  ghost.value      = { visible: false, y: e.clientY, label: navItems.value[index].label, icon: navItems.value[index].icon };

  document.addEventListener("pointermove", onDocPointerMove);
  document.addEventListener("pointerup",   onDocPointerUp);
}

function onDocPointerMove(e: PointerEvent) {
  if (dragFrom.value === null) return;

  // Activate drag after 4px movement
  if (!isDragging.value) {
    isDragging.value = true;
    ghost.value.visible = true;
  }

  ghost.value.y = e.clientY;

  // Find which nav item is under the cursor
  const els = document.querySelectorAll<HTMLElement>("[data-nav-index]");
  let found: number | null = null;
  els.forEach(el => {
    const rect = el.getBoundingClientRect();
    if (e.clientY >= rect.top && e.clientY < rect.bottom) {
      found = parseInt(el.dataset.navIndex ?? "-1");
    }
  });
  if (found !== null && found >= 0) dragTo.value = found;
}

function onDocPointerUp(_e: PointerEvent) {
  document.removeEventListener("pointermove", onDocPointerMove);
  document.removeEventListener("pointerup",   onDocPointerUp);

  const from = dragFrom.value;
  const to   = dragTo.value;

  // If we actually dragged (not just clicked) and moved to different position
  if (isDragging.value && from !== null && to !== null && from !== to) {
    const items = [...navItems.value];
    const [moved] = items.splice(from, 1);
    items.splice(to, 0, moved);
    navItems.value = items;
    saveOrder();
  } else if (!isDragging.value && from !== null) {
    // It was a click — navigate
    router.push(navItems.value[from].path);
  }

  dragFrom.value   = null;
  dragTo.value     = null;
  isDragging.value = false;
  ghost.value.visible = false;
}

onUnmounted(() => {
  document.removeEventListener("pointermove", onDocPointerMove);
  document.removeEventListener("pointerup",   onDocPointerUp);
});

// ── Updater ───────────────────────────────────────────────────────────
const updateAvailable   = ref(false);
const updateVersion     = ref("");
const updateDownloading = ref(false);
const updateToast       = ref("");
let _updateObj: Awaited<ReturnType<typeof checkUpdate>> | null = null;
let _toastTimer: ReturnType<typeof setTimeout> | null = null;

function showUpdateToast(msg: string) {
  updateToast.value = msg;
  if (_toastTimer) clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => { updateToast.value = ""; }, 2500);
}

async function checkForUpdate() {
  try {
    const update = await checkUpdate();
    if (update?.available) {
      _updateObj          = update;
      updateVersion.value = update.version ?? "";
      updateAvailable.value = true;
    } else {
      showUpdateToast("已是最新版本");
    }
  } catch {
    showUpdateToast("檢查更新失敗，請確認網路連線");
  }
}

async function installUpdate() {
  if (!_updateObj) return;
  updateDownloading.value = true;
  try {
    await _updateObj.downloadAndInstall();
    await relaunch();
  } catch {
    showUpdateToast("更新安裝失敗");
    updateDownloading.value = false;
  }
}
</script>

<template>
  <aside class="flex flex-col w-52 min-h-screen border-r bg-gray-950 border-gray-800 relative">

    <!-- Logo -->
    <div class="px-4 py-5 border-b border-gray-800">
      <span class="text-lg font-bold tracking-tight text-white">MedBase</span>
      <p class="text-xs mt-0.5 text-gray-500">臨床醫囑查詢系統</p>
    </div>

    <!-- Emergency protocol link (fixed) -->
    <div class="px-3 pt-4">
      <RouterLink
        to="/emergency"
        class="flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm font-semibold transition-colors"
        :class="route.path === '/emergency'
          ? 'bg-red-700 text-white'
          : 'bg-red-950/50 text-red-400 hover:bg-red-900/50'"
      >
        <span class="text-base">🚨</span>
        <span>危急情境</span>
      </RouterLink>
    </div>

    <!-- Divider -->
    <div class="mx-4 mt-4 mb-2 border-t border-gray-800"></div>

    <!-- Nav items -->
    <nav class="flex-1 px-3 space-y-0.5 overflow-y-auto">
      <div
        v-for="(item, index) in navItems"
        :key="item.path"
        :data-nav-index="index"
        @pointerdown="onItemPointerDown($event, index)"
        class="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm select-none cursor-grab active:cursor-grabbing transition-colors"
        :class="[
          route.path === item.path ? 'bg-gray-800 text-white' : 'text-gray-400 hover:bg-gray-800 hover:text-gray-200',
          dragFrom === index && isDragging ? 'opacity-30 bg-gray-800/30' : '',
          dragTo === index && isDragging && dragFrom !== index ? 'ring-1 ring-blue-500 ring-inset' : '',
        ]"
      >
        <span class="text-base leading-none shrink-0">{{ item.icon }}</span>
        <span class="truncate">{{ item.label }}</span>
      </div>
    </nav>

    <!-- 底部：資料管理 -->
    <div class="px-3 pb-2 border-t border-gray-800 mt-2 pt-2">
      <RouterLink
        v-for="item in bottomNav" :key="item.path"
        :to="item.path"
        class="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors"
        :class="route.path === item.path
          ? 'bg-gray-800 text-white'
          : 'text-gray-400 hover:bg-gray-800 hover:text-gray-200'"
      >
        <span class="text-base leading-none">{{ item.icon }}</span>
        <span>{{ item.label }}</span>
      </RouterLink>
    </div>

    <!-- 版本與更新 -->
    <div class="px-3 pb-3 space-y-2">
      <div class="flex items-center gap-2">
        <span class="text-xs text-gray-600">v0.1.2</span>
        <button @click="checkForUpdate"
          class="text-xs px-2 py-1 bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-gray-200 rounded transition-colors">
          檢查更新
        </button>
      </div>
      <div v-if="updateAvailable"
        class="flex items-center gap-2 px-2 py-1.5 bg-emerald-900/40 border border-emerald-700/50 rounded text-xs text-emerald-300">
        <span>🎉 v{{ updateVersion }}</span>
        <button @click="installUpdate" :disabled="updateDownloading"
          class="px-2 py-0.5 bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 text-white rounded">
          {{ updateDownloading ? '安裝中…' : '立即更新' }}
        </button>
      </div>
      <p v-if="updateToast" class="text-xs text-gray-500">{{ updateToast }}</p>
    </div>

    <!-- Drag ghost -->
    <Teleport to="body">
      <div
        v-if="ghost.visible"
        class="fixed left-2 z-50 flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm bg-gray-700 text-white shadow-xl border border-gray-600 pointer-events-none"
        :style="{ top: `${ghost.y - 16}px`, width: '180px' }"
      >
        <span class="text-base leading-none shrink-0">{{ ghost.icon }}</span>
        <span class="truncate">{{ ghost.label }}</span>
      </div>
    </Teleport>

  </aside>
</template>
