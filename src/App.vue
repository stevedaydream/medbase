<script setup lang="ts">
import { ref, onMounted } from "vue";
import { useEventListener } from "@vueuse/core";
import Sidebar from "@/components/layout/Sidebar.vue";
import TopBar from "@/components/layout/TopBar.vue";
import OmniSearch from "@/components/OmniSearch.vue";
import DebugPanel from "@/components/DebugPanel.vue";
import { useUiSettings } from "@/stores/uiSettings";
import { check as checkUpdate } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

const searchOpen = ref(false);
const debugOpen = ref(false);
const uiSettings = useUiSettings();
onMounted(() => uiSettings.load());

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

// ── 啟動自動更新檢查 ──────────────────────────────────────────────────
const toast = ref("");
let toastTimer: ReturnType<typeof setTimeout> | null = null;
function showToast(msg: string) {
  toast.value = msg;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.value = ""; }, 2500);
}

const updateDialogOpen   = ref(false);
const updateVersion      = ref("");
const updateNotes        = ref("");
const updateDownloading  = ref(false);
let _updateObj: Awaited<ReturnType<typeof checkUpdate>> | null = null;

onMounted(async () => {
  try {
    const update = await checkUpdate();
    if (update?.available) {
      _updateObj          = update;
      updateVersion.value = update.version ?? "";
      updateNotes.value   = update.body ?? "";
      updateDialogOpen.value = true;
    } else {
      showToast("已是最新版本");
    }
  } catch {
    // 開發模式或網路失敗：靜默略過，不打擾使用者
  }
});

async function installUpdate() {
  if (!_updateObj) return;
  updateDownloading.value = true;
  try {
    await _updateObj.downloadAndInstall();
    await relaunch();
  } catch {
    showToast("更新安裝失敗");
    updateDownloading.value = false;
  }
}

function dismissUpdate() {
  updateDialogOpen.value = false;
}
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

    <!-- 啟動更新確認對話框 -->
    <Transition name="modal">
      <div v-if="updateDialogOpen"
        class="fixed inset-0 z-[9000] flex items-center justify-center bg-black/60 backdrop-blur-sm"
        @click.self="dismissUpdate">
        <div class="bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl w-[420px] max-w-[90vw] p-6 space-y-4">
          <!-- Header -->
          <div class="flex items-start gap-3">
            <div class="text-2xl leading-none">🎉</div>
            <div>
              <p class="text-white font-semibold text-base">發現新版本</p>
              <p class="text-emerald-400 font-mono text-sm font-bold mt-0.5">v{{ updateVersion }}</p>
            </div>
          </div>

          <!-- Release notes -->
          <pre v-if="updateNotes"
            class="text-xs text-gray-400 whitespace-pre-wrap font-sans leading-relaxed bg-gray-800 rounded-lg p-3 max-h-48 overflow-y-auto">{{ updateNotes }}</pre>

          <!-- Actions -->
          <div class="flex gap-3 justify-end pt-1">
            <button @click="dismissUpdate" :disabled="updateDownloading"
              class="text-sm px-4 py-2 bg-gray-700 hover:bg-gray-600 disabled:opacity-40 text-gray-300 rounded-lg transition-colors">
              稍後再說
            </button>
            <button @click="installUpdate" :disabled="updateDownloading"
              class="text-sm px-5 py-2 bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 text-white rounded-lg font-semibold transition-colors flex items-center gap-2">
              <span v-if="updateDownloading" class="inline-block w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              {{ updateDownloading ? '安裝中…' : '立即更新' }}
            </button>
          </div>
        </div>
      </div>
    </Transition>

    <!-- Toast -->
    <Transition name="toast">
      <div v-if="toast"
        class="fixed bottom-6 left-1/2 -translate-x-1/2 px-4 py-2 bg-gray-700 text-white text-sm rounded-lg shadow-xl z-[9999] pointer-events-none">
        {{ toast }}
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.toast-enter-active, .toast-leave-active { transition: opacity .25s, transform .25s; }
.toast-enter-from, .toast-leave-to { opacity: 0; transform: translateX(-50%) translateY(8px); }

.modal-enter-active, .modal-leave-active { transition: opacity .2s; }
.modal-enter-from, .modal-leave-to { opacity: 0; }
</style>
