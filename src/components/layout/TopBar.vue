<script setup lang="ts">
import { useRoute } from "vue-router";
import { useEmergencyStore } from "@/stores/emergency";

const route = useRoute();
const emergency = useEmergencyStore();

const emit = defineEmits<{ openSearch: [] }>();
</script>

<template>
  <header
    class="flex items-center justify-between h-12 px-5 border-b shrink-0 transition-colors duration-200"
    :class="emergency.isActive
      ? 'bg-zinc-950 border-red-800'
      : 'bg-gray-950 border-gray-800'"
  >
    <!-- Page title -->
    <h1 class="text-sm font-medium" :class="emergency.isActive ? 'text-red-200' : 'text-gray-200'">
      {{ route.meta.title as string ?? 'MedBase' }}
    </h1>

    <div class="flex items-center gap-3">
      <!-- Omnibar hint -->
      <button
        @click="emit('openSearch')"
        class="flex items-center gap-2 px-3 py-1.5 rounded-md text-xs transition-colors cursor-pointer"
        :class="emergency.isActive
          ? 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
          : 'bg-gray-800 text-gray-400 hover:bg-gray-700'"
      >
        <span>🔍 全域搜尋</span>
        <kbd class="font-mono px-1 py-0.5 rounded text-xs" :class="emergency.isActive ? 'bg-zinc-700' : 'bg-gray-700'">Ctrl K</kbd>
      </button>

      <!-- Emergency toggle -->
      <button
        @click="emergency.toggle()"
        class="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-all duration-200 cursor-pointer"
        :class="emergency.isActive
          ? 'bg-red-600 text-white hover:bg-red-500 animate-pulse'
          : 'bg-red-950 text-red-400 border border-red-900 hover:bg-red-900 hover:text-red-300'"
      >
        <span>🚨</span>
        <span>{{ emergency.isActive ? '急救模式 ON' : '急救模式' }}</span>
      </button>
    </div>
  </header>
</template>
