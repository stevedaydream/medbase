<script setup lang="ts">
import { ref, onMounted, onUnmounted } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useUiSettings } from "@/stores/uiSettings";

const emit = defineEmits<{ "enter-compact": [] }>();

const route  = useRoute();
const router = useRouter();
const ui     = useUiSettings();

interface NavItem { path: string; icon: string; label: string }

const DEFAULT_NAV: NavItem[] = [
  { path: "/prescriptions", icon: "📋", label: "處方套組" },
  { path: "/surgery",     icon: "🔪", label: "手術處置" },
  { path: "/disease",     icon: "🏥", label: "疾病常規" },
  { path: "/examination", icon: "🔬", label: "檢查處置" },
  { path: "/items",       icon: "📦", label: "自費品項" },
  { path: "/sets",        icon: "🗂️", label: "套組管理" },
  { path: "/acp",         icon: "📜", label: "ACP 評估" },
  { path: "/physicians",  icon: "👤", label: "通訊錄" },
  { path: "/contacts",    icon: "📞", label: "常用分機" },
  { path: "/schedule",    icon: "📅", label: "排班表" },
  { path: "/shift-memos", icon: "📝", label: "規則備忘錄" },
  { path: "/tools",       icon: "🧮", label: "臨床工具" },
  { path: "/note-polish", icon: "✍️", label: "病歷潤飾" },
];

const navItems = ref<NavItem[]>([...DEFAULT_NAV]);

const bottomNav: NavItem[] = [
  { path: "/ahk",      icon: "⌨",  label: "AHK 管理" },
  { path: "/data",     icon: "⚙️", label: "資料管理" },
  { path: "/settings", icon: "🔧", label: "設定" },
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

</script>

<template>
  <aside class="flex flex-col w-52 min-h-screen border-r bg-sunken border-hairline relative">

    <!-- Logo -->
    <div class="px-4 py-5 border-b border-hairline">
      <span class="text-lg font-bold tracking-tight text-fg">MedBase</span>
      <p class="text-xs mt-0.5 text-muted">臨床醫囑查詢系統</p>
    </div>

    <!-- Emergency protocol link (fixed) -->
    <div class="px-3 pt-4">
      <RouterLink
        to="/emergency"
        class="flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm font-semibold transition-colors"
        :class="route.path === '/emergency'
          ? 'bg-danger text-white'
          : 'bg-danger/10 text-danger hover:bg-danger/20'"
      >
        <span class="text-base">🚨</span>
        <span>危急情境</span>
      </RouterLink>
    </div>

    <!-- Divider -->
    <div class="mx-4 mt-4 mb-2 border-t border-hairline"></div>

    <!-- Nav items -->
    <nav class="flex-1 px-3 space-y-0.5 overflow-y-auto">
      <div
        v-for="(item, index) in navItems"
        :key="item.path"
        :data-nav-index="index"
        @pointerdown="onItemPointerDown($event, index)"
        class="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm select-none cursor-grab active:cursor-grabbing transition-colors"
        :class="[
          route.path === item.path ? 'bg-elevated text-fg' : 'text-fg-secondary hover:bg-elevated hover:text-fg',
          dragFrom === index && isDragging ? 'opacity-30 bg-elevated' : '',
          dragTo === index && isDragging && dragFrom !== index ? 'ring-1 ring-accent/30 ring-inset' : '',
        ]"
      >
        <span class="text-base leading-none shrink-0">{{ item.icon }}</span>
        <span class="truncate">{{ item.label }}</span>
      </div>
    </nav>

    <!-- 底部：資料管理 -->
    <div class="px-3 pb-2 border-t border-hairline mt-2 pt-2">
      <RouterLink
        v-for="item in bottomNav" :key="item.path"
        :to="item.path"
        class="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors"
        :class="route.path === item.path
          ? 'bg-elevated text-fg'
          : 'text-fg-secondary hover:bg-elevated hover:text-fg'"
      >
        <span class="text-base leading-none">{{ item.icon }}</span>
        <span>{{ item.label }}</span>
      </RouterLink>
    </div>

    <!-- 收合按鈕 + 版本號 -->
    <div class="px-3 pb-3 flex items-center gap-2">
      <button
        @click="emit('enter-compact')"
        title="精簡模式（吸附右側）"
        class="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs text-muted hover:bg-elevated hover:text-fg-secondary transition-colors"
      >
        <span class="text-sm">⇥</span>
        <span>精簡模式</span>
      </button>
      <button
        @click="ui.toggleTheme()"
        :title="ui.resolvedDark ? '切換為淺色' : '切換為深色'"
        class="px-2 py-1.5 rounded-lg text-xs text-muted hover:bg-elevated hover:text-fg-secondary transition-colors"
      >
        <span class="text-sm">{{ ui.resolvedDark ? "☀" : "☾" }}</span>
      </button>
      <span class="ml-auto text-xs text-muted">v0.3.4</span>
    </div>

    <!-- Drag ghost -->
    <Teleport to="body">
      <div
        v-if="ghost.visible"
        class="fixed left-2 z-50 flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm bg-raised text-fg shadow-xl border border-hairline pointer-events-none"
        :style="{ top: `${ghost.y - 16}px`, width: '180px' }"
      >
        <span class="text-base leading-none shrink-0">{{ ghost.icon }}</span>
        <span class="truncate">{{ ghost.label }}</span>
      </div>
    </Teleport>

  </aside>
</template>
