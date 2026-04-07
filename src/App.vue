<script setup lang="ts">
import { ref } from "vue";
import { useEventListener } from "@vueuse/core";
import Sidebar from "@/components/layout/Sidebar.vue";
import TopBar from "@/components/layout/TopBar.vue";
import OmniSearch from "@/components/OmniSearch.vue";
import DebugPanel from "@/components/DebugPanel.vue";

const searchOpen = ref(false);
const debugOpen = ref(false);

useEventListener("keydown", (e: KeyboardEvent) => {
  if ((e.ctrlKey || e.metaKey) && e.key === "k") {
    e.preventDefault();
    searchOpen.value = !searchOpen.value;
  }
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === "D") {
    e.preventDefault();
    debugOpen.value = !debugOpen.value;
  }
  if (e.key === "Escape") {
    searchOpen.value = false;
    debugOpen.value = false;
  }
});
</script>

<template>
  <div class="flex h-screen overflow-hidden bg-gray-950">
    <Sidebar />

    <div class="flex flex-col flex-1 overflow-hidden">
      <TopBar @open-search="searchOpen = true" />

      <main
        class="flex-1 min-h-0"
        :class="$route.meta.fullHeight ? 'overflow-hidden' : 'overflow-y-auto p-5'"
      >
        <RouterView />
      </main>
    </div>

    <!-- Omnibar overlay -->
    <OmniSearch v-if="searchOpen" @close="searchOpen = false" />

    <!-- Debug panel -->
    <DebugPanel v-if="debugOpen" />
  </div>
</template>
