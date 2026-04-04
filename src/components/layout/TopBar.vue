<script setup lang="ts">
import { useRoute } from "vue-router";

const route = useRoute();

const emit = defineEmits<{ openSearch: [] }>();
</script>

<template>
  <header class="flex items-center justify-between h-12 px-5 border-b shrink-0 bg-gray-950 border-gray-800">
    <!-- Page title -->
    <h1 class="text-sm font-medium text-gray-200">
      {{ route.meta.title as string ?? 'MedBase' }}
    </h1>

    <div class="flex items-center gap-3">
      <!-- Omnibar hint -->
      <button
        @click="emit('openSearch')"
        class="flex items-center gap-2 px-3 py-1.5 rounded-md text-xs bg-gray-800 text-gray-400 hover:bg-gray-700 transition-colors cursor-pointer"
      >
        <span>🔍 全域搜尋</span>
        <kbd class="font-mono px-1 py-0.5 rounded text-xs bg-gray-700">Ctrl K</kbd>
      </button>
    </div>
  </header>
</template>
