<script setup lang="ts">
import { useRoute } from "vue-router";
import { useEmergencyStore } from "@/stores/emergency";

const route = useRoute();
const emergency = useEmergencyStore();

const navItems = [
  { path: "/medications", icon: "💊", label: "藥物字典" },
  { path: "/prescriptions", icon: "📋", label: "處方套組" },
  { path: "/surgery", icon: "🔪", label: "手術處置" },
  { path: "/disease", icon: "🏥", label: "疾病常規" },
  { path: "/examination", icon: "🔬", label: "檢查處置" },
  { path: "/items",      icon: "📦",  label: "自費品項" },
  { path: "/sets",       icon: "🗂️",  label: "套組管理" },
  { path: "/acp",        icon: "📜",  label: "ACP 評估" },
  { path: "/physicians", icon: "👨‍⚕️", label: "醫師通訊錄" },
  { path: "/schedule",   icon: "📅",  label: "排班表" },
];

const bottomNav = [
  { path: "/ahk",  icon: "⌨",  label: "AHK 管理" },
  { path: "/data", icon: "⚙️", label: "資料管理" },
];
</script>

<template>
  <aside
    class="flex flex-col w-52 min-h-screen border-r transition-colors duration-200"
    :class="emergency.isActive
      ? 'bg-zinc-950 border-red-700'
      : 'bg-gray-950 border-gray-800'"
  >
    <!-- Logo -->
    <div class="px-4 py-5 border-b" :class="emergency.isActive ? 'border-red-900' : 'border-gray-800'">
      <span class="text-lg font-bold tracking-tight" :class="emergency.isActive ? 'text-red-400' : 'text-white'">
        MedBase
      </span>
      <p class="text-xs mt-0.5" :class="emergency.isActive ? 'text-red-600' : 'text-gray-500'">臨床醫囑查詢系統</p>
    </div>

    <!-- Emergency protocol link -->
    <div class="px-3 pt-4">
      <RouterLink
        to="/emergency"
        class="flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm font-semibold transition-colors"
        :class="route.path === '/emergency'
          ? 'bg-red-700 text-white'
          : emergency.isActive
            ? 'bg-red-950 text-red-300 hover:bg-red-900'
            : 'bg-red-950/50 text-red-400 hover:bg-red-900/50'"
      >
        <span class="text-base">🚨</span>
        <span>危急情境</span>
      </RouterLink>
    </div>

    <!-- Divider -->
    <div class="mx-4 mt-4 mb-2 border-t" :class="emergency.isActive ? 'border-red-900' : 'border-gray-800'"></div>

    <!-- Nav items -->
    <nav class="flex-1 px-3 space-y-0.5">
      <RouterLink
        v-for="item in navItems"
        :key="item.path"
        :to="item.path"
        class="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors"
        :class="route.path === item.path
          ? emergency.isActive
            ? 'bg-red-900/40 text-red-200'
            : 'bg-gray-800 text-white'
          : emergency.isActive
            ? 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200'
            : 'text-gray-400 hover:bg-gray-800 hover:text-gray-200'"
      >
        <span class="text-base leading-none">{{ item.icon }}</span>
        <span>{{ item.label }}</span>
      </RouterLink>
    </nav>

    <!-- 底部：資料管理 -->
    <div class="px-3 pb-2 border-t mt-2 pt-2" :class="emergency.isActive ? 'border-red-900' : 'border-gray-800'">
      <RouterLink
        v-for="item in bottomNav" :key="item.path"
        :to="item.path"
        class="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors"
        :class="route.path === item.path
          ? emergency.isActive ? 'bg-red-900/40 text-red-200' : 'bg-gray-800 text-white'
          : emergency.isActive ? 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200'
                               : 'text-gray-400 hover:bg-gray-800 hover:text-gray-200'"
      >
        <span class="text-base leading-none">{{ item.icon }}</span>
        <span>{{ item.label }}</span>
      </RouterLink>
    </div>

    <!-- Footer -->
    <div class="px-4 py-3 text-xs" :class="emergency.isActive ? 'text-red-900' : 'text-gray-700'">
      v0.1.0
    </div>
  </aside>
</template>
