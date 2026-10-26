<script setup lang="ts">
import { ref, onMounted } from "vue";
import QRCode from "qrcode";

/** 手機版安裝 QR code：掃描後進入 /install，依 Android / iOS 引導加入主畫面 */
const emit = defineEmits<{ close: [] }>();

// 若 Vercel 專案名稱改了，請一併修改 mobile/netlify.toml
const MOBILE_ORIGIN = "https://medbase-mobile.vercel.app";
// openExternalBrowser=1：用 LINE 掃描時改用系統瀏覽器開啟（LINE 內建瀏覽器無法安裝 PWA）
const INSTALL_URL = `${MOBILE_ORIGIN}/install?openExternalBrowser=1`;

const qrSrc  = ref("");
const copied = ref(false);

onMounted(async () => {
  qrSrc.value = await QRCode.toDataURL(INSTALL_URL, { width: 480, margin: 1, errorCorrectionLevel: "M" });
});

async function copyUrl() {
  await navigator.clipboard.writeText(`${MOBILE_ORIGIN}/install`);
  copied.value = true;
  setTimeout(() => (copied.value = false), 1500);
}
</script>

<template>
  <Teleport to="body">
    <div class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-sunken/60 backdrop-blur-sm" @click.self="emit('close')">
      <div class="w-[340px] bg-surface border border-hairline rounded-2xl p-6 space-y-4 text-sm">
        <div class="flex items-center justify-between">
          <p class="font-bold text-fg">安裝手機版</p>
          <button class="text-muted hover:text-fg" @click="emit('close')">✕</button>
        </div>
        <div class="mx-auto w-56 h-56 rounded-xl bg-white p-2 flex items-center justify-center">
          <img v-if="qrSrc" :src="qrSrc" alt="手機版 QR code" class="w-full h-full" />
        </div>
        <ol class="space-y-1 text-fg-secondary text-xs leading-relaxed list-decimal pl-4">
          <li>用手機相機掃描（iPhone 請用相機，會以 Safari 開啟）</li>
          <li>頁面會自動判斷 Android / iPhone，照步驟加入主畫面</li>
          <li>從主畫面圖示開啟，以 HIS 帳密登入</li>
        </ol>
        <div class="flex items-center gap-2">
          <code class="flex-1 truncate px-2 py-1.5 rounded-lg bg-sunken text-xs text-muted">{{ MOBILE_ORIGIN }}/install</code>
          <button class="px-3 py-1.5 rounded-lg border border-hairline text-xs hover:bg-elevated" @click="copyUrl">
            {{ copied ? "已複製" : "複製" }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
