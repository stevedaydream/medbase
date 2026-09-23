<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted } from "vue";
import {
  useResearchSession, login, setupPin, logout, lookupPerson, claimUnownedData,
  backupNow, listBackups, restoreDay, PIN_PATTERN, type LoginResult,
} from "@/composables/useResearchSession";

/**
 * 論文專案外層（ADR-012）：未登入時只顯示登入畫面，子頁面（清單／詳情）不會掛載，
 * 因此也不會在未登入時讀到任何論文資料。登入後上方顯示登入者與備份狀態。
 */
const session = useResearchSession();

// 子頁面重新載入（還原、認領資料後）
const viewKey = ref(0);

// ── 登入表單 ─────────────────────────────────────────────────────
const mode = ref<"login" | "setup">("login");
const his = ref(session.his);
const pin = ref("");
const pin2 = ref("");
const busy = ref(false);
const error = ref("");
const personName = ref<string | null>(null);
const pinInput = ref<HTMLInputElement | null>(null);
const hisInput = ref<HTMLInputElement | null>(null);

watch(his, async (v) => {
  personName.value = v.trim() ? await lookupPerson(v) : null;
}, { immediate: true });

// 被鎖定後回到登入畫面：帶入上次的 HIS 帳號，游標直接放在 PIN
watch(() => session.unlocked, async (unlocked) => {
  if (unlocked) return;
  his.value = session.his;
  pin.value = ""; pin2.value = ""; error.value = ""; mode.value = "login";
  await nextTick();
  (session.his ? pinInput.value : hisInput.value)?.focus();
});
onMounted(() => (session.his ? pinInput.value : hisInput.value)?.focus());

const canSubmit = computed(() =>
  !!personName.value && PIN_PATTERN.test(pin.value) && (mode.value === "login" || pin.value === pin2.value));

async function submit() {
  if (!canSubmit.value || busy.value) return;
  busy.value = true; error.value = "";
  try {
    const r = mode.value === "login" ? await login(his.value, pin.value) : await setupPin(his.value, pin.value);
    if (r.status === "need_setup") {
      mode.value = "setup";
      pin2.value = "";
      error.value = "";
      return;
    }
    if (r.status === "error") { error.value = r.message ?? "登入失敗"; return; }
    pin.value = ""; pin2.value = "";
    afterLogin(r);
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}

// ── 登入後的提示 ─────────────────────────────────────────────────
const unownedCount = ref(0);
const conflict = ref<{ day: string; updated_at: string } | null>(null);
const notice = ref("");

function afterLogin(r: LoginResult) {
  unownedCount.value = r.unowned ?? 0;
  conflict.value = r.conflict ?? null;
  if (r.restored) { notice.value = "已載入雲端最新的備份"; viewKey.value++; }
}

async function claim(yes: boolean) {
  if (yes) { await claimUnownedData(); viewKey.value++; notice.value = "已將本機既有的論文資料歸到你名下"; }
  unownedCount.value = 0;
}

async function resolveConflict(useCloud: boolean) {
  const c = conflict.value;
  conflict.value = null;
  if (!c) return;
  try {
    if (useCloud) { await restoreDay(c.day); viewKey.value++; notice.value = "已改用雲端的版本"; }
    else { await backupNow(); notice.value = "已保留本機資料並上傳為最新備份"; }
  } catch (e) { notice.value = (e as Error).message; }
}

// ── 備份狀態 ─────────────────────────────────────────────────────
function fmtTime(iso: string) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const sameDay = d.toDateString() === new Date().toDateString();
  return d.toLocaleString("zh-TW", sameDay ? { hour: "2-digit", minute: "2-digit" } : { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

const status = computed(() => {
  switch (session.backupStatus) {
    case "pending":   return { text: "有修改，稍後自動備份", tone: "text-muted" };
    case "uploading": return { text: "備份中…", tone: "text-muted" };
    case "offline":   return { text: "離線中，修改會在下次連線登入時備份", tone: "text-warning" };
    case "auth":      return { text: "登入憑證已過期，重新登入後會補上傳", tone: "text-warning" };
    case "error":     return { text: `備份失敗：${session.message}`, tone: "text-danger" };
    default:          return { text: session.lastBackupAt ? `已備份 ${fmtTime(session.lastBackupAt)}` : "尚未備份", tone: "text-muted" };
  }
});

async function doLogout() {
  await logout();
  notice.value = "";
}

// ── 從雲端還原 ───────────────────────────────────────────────────
const restoreOpen = ref(false);
const backups = ref<{ day: string; updated_at: string }[]>([]);
const restoreError = ref("");
const restoreBusy = ref(false);
const restoreTarget = ref<string | null>(null);

async function openRestore() {
  restoreOpen.value = true; restoreTarget.value = null; restoreError.value = ""; backups.value = [];
  try { backups.value = await listBackups(); }
  catch (e) { restoreError.value = (e as Error).message; }
}

async function confirmRestore() {
  if (!restoreTarget.value) return;
  restoreBusy.value = true; restoreError.value = "";
  try {
    await restoreDay(restoreTarget.value);
    restoreOpen.value = false;
    viewKey.value++;
    notice.value = `已還原 ${restoreTarget.value} 的備份`;
  } catch (e) {
    restoreError.value = (e as Error).message;
  } finally {
    restoreBusy.value = false;
  }
}
</script>

<template>
  <div class="accent-fuchsia flex flex-col h-full gap-2">

    <!-- ── 未登入：你是誰？ ───────────────────────────────────── -->
    <div v-if="!session.unlocked" class="flex-1 flex items-center justify-center bg-sunken rounded-2xl border border-hairline">
      <form @submit.prevent="submit" class="w-80 bg-surface border border-hairline rounded-2xl shadow-2xl p-6 space-y-4">
        <div>
          <h2 class="text-base font-black text-fg">🎓 論文專案</h2>
          <p class="text-sm text-fg-secondary mt-1">
            {{ mode === 'setup' ? '第一次使用，請設定 PIN' : '你是誰？請輸入 HIS 帳號與 PIN' }}
          </p>
        </div>

        <div>
          <label class="text-xs font-bold text-muted mb-1 block">HIS 帳號</label>
          <input ref="hisInput" v-model="his" autocomplete="off" :disabled="mode === 'setup'"
            class="w-full px-3 py-2 rounded-xl bg-sunken border border-hairline text-fg text-sm font-mono outline-none focus:border-accent/50 disabled:opacity-60" />
          <p class="mt-1 text-xs min-h-4" :class="personName ? 'text-accent font-bold' : 'text-muted'">
            {{ his.trim() ? (personName ? `${personName}，你好` : '通訊錄中找不到這個 HIS 帳號') : '' }}
          </p>
        </div>

        <div>
          <label class="text-xs font-bold text-muted mb-1 block">{{ mode === 'setup' ? '設定 PIN（4～6 碼數字）' : 'PIN' }}</label>
          <input ref="pinInput" v-model="pin" type="password" inputmode="numeric" maxlength="6" autocomplete="off"
            class="w-full px-3 py-2 rounded-xl bg-sunken border border-hairline text-fg text-sm font-mono tracking-widest outline-none focus:border-accent/50" />
        </div>
        <div v-if="mode === 'setup'">
          <label class="text-xs font-bold text-muted mb-1 block">再輸入一次 PIN</label>
          <input v-model="pin2" type="password" inputmode="numeric" maxlength="6" autocomplete="off"
            class="w-full px-3 py-2 rounded-xl bg-sunken border border-hairline text-fg text-sm font-mono tracking-widest outline-none focus:border-accent/50" />
          <p v-if="pin2 && pin !== pin2" class="mt-1 text-xs text-danger">兩次輸入的 PIN 不一致</p>
        </div>

        <p v-if="error" class="text-xs text-danger font-bold">{{ error }}</p>

        <div class="flex gap-2">
          <button v-if="mode === 'setup'" type="button" @click="mode = 'login'; error = ''"
            class="px-4 py-2 rounded-xl text-xs font-bold bg-elevated border border-hairline text-fg-secondary hover:text-fg cursor-pointer">返回</button>
          <button type="submit" :disabled="!canSubmit || busy"
            class="flex-1 py-2 rounded-xl text-sm font-bold bg-accent text-white hover:bg-accent-hover disabled:opacity-40 transition-colors cursor-pointer">
            {{ busy ? '驗證中…' : mode === 'setup' ? '設定並進入' : '進入' }}
          </button>
        </div>
        <p class="text-2xs text-muted leading-relaxed">
          離開論文專案超過 30 分鐘需重新輸入 PIN；關閉 MedBase 後需重新登入。修改會自動備份到你的雲端空間，其他人無法讀取。
        </p>
      </form>
    </div>

    <!-- ── 已登入 ─────────────────────────────────────────────── -->
    <template v-else>
      <div class="shrink-0 flex items-center gap-3 flex-wrap px-4 py-2 bg-surface border border-hairline rounded-2xl text-xs">
        <span class="font-bold text-fg">👤 {{ session.name }}</span>
        <span class="font-mono text-muted">HIS {{ session.his }}</span>
        <span class="w-px h-4 bg-hairline" />
        <span :class="status.tone">☁ {{ status.text }}</span>
        <button v-if="session.backupStatus === 'error'" @click="backupNow()"
          class="text-accent hover:underline cursor-pointer">重試</button>
        <span v-if="notice" class="text-success font-bold">{{ notice }}</span>
        <div class="flex-1" />
        <button @click="openRestore" :disabled="!session.token"
          :title="session.token ? '從雲端最近 3 天的備份還原' : '離線登入時無法讀取雲端備份'"
          class="px-3 py-1 rounded-lg bg-sunken border border-hairline text-fg-secondary hover:text-fg disabled:opacity-40 cursor-pointer">
          從雲端還原
        </button>
        <button @click="doLogout"
          class="px-3 py-1 rounded-lg bg-sunken border border-hairline text-fg-secondary hover:text-fg cursor-pointer">
          登出／切換人員
        </button>
      </div>
      <div class="flex-1 min-h-0">
        <RouterView :key="viewKey" />
      </div>
    </template>
  </div>

  <Teleport to="body">
    <!-- 認領升級前的資料 -->
    <div v-if="session.unlocked && unownedCount > 0 && !conflict" class="fixed inset-0 z-50 flex items-center justify-center bg-sunken/60 backdrop-blur-sm">
      <div class="w-96 bg-surface border border-hairline rounded-2xl shadow-2xl p-6 space-y-4">
        <h3 class="text-sm font-black text-fg">本機有尚未歸屬的論文資料</h3>
        <p class="text-sm text-fg-secondary leading-relaxed">
          這台電腦有 {{ unownedCount }} 筆論文資料（專案、作者或期刊）是在加入人員登入之前建立的，目前不屬於任何人。要歸到你（{{ session.name }}）名下嗎？
        </p>
        <p class="text-xs text-muted">若這些不是你的資料，請選「不是我的」，讓資料的主人登入時再認領。</p>
        <div class="flex gap-2 justify-end">
          <button @click="claim(false)" class="px-4 py-2 rounded-xl text-xs font-bold bg-elevated border border-hairline text-fg-secondary hover:text-fg cursor-pointer">不是我的</button>
          <button @click="claim(true)" class="px-4 py-2 rounded-xl text-xs font-bold bg-accent text-white hover:bg-accent-hover cursor-pointer">歸到我名下</button>
        </div>
      </div>
    </div>

    <!-- 雲端與本機都有修改 -->
    <div v-if="session.unlocked && conflict" class="fixed inset-0 z-50 flex items-center justify-center bg-sunken/60 backdrop-blur-sm">
      <div class="w-96 bg-surface border border-hairline rounded-2xl shadow-2xl p-6 space-y-4">
        <h3 class="text-sm font-black text-fg">雲端有較新的備份</h3>
        <p class="text-sm text-fg-secondary leading-relaxed">
          你在其他電腦的修改已於 {{ fmtTime(conflict.updated_at) }} 備份到雲端，但這台電腦也有尚未上傳的修改。要保留哪一邊？
        </p>
        <p class="text-xs text-muted">沒被選的那一邊的修改會被取代（雲端仍保留最近 3 天的備份可還原）。</p>
        <div class="flex gap-2 justify-end">
          <button @click="resolveConflict(false)" class="px-4 py-2 rounded-xl text-xs font-bold bg-elevated border border-hairline text-fg-secondary hover:text-fg cursor-pointer">保留這台電腦的</button>
          <button @click="resolveConflict(true)" class="px-4 py-2 rounded-xl text-xs font-bold bg-accent text-white hover:bg-accent-hover cursor-pointer">使用雲端的</button>
        </div>
      </div>
    </div>

    <!-- 從雲端還原 -->
    <div v-if="restoreOpen" class="fixed inset-0 z-50 flex items-center justify-center bg-sunken/60 backdrop-blur-sm" @click.self="restoreOpen = false">
      <div class="w-96 bg-surface border border-hairline rounded-2xl shadow-2xl p-6 space-y-4">
        <h3 class="text-sm font-black text-fg">從雲端還原</h3>
        <p class="text-xs text-muted">選擇一份備份，會取代你在這台電腦的論文資料，不影響其他人。</p>
        <p v-if="!backups.length && !restoreError" class="text-sm text-muted">讀取中…</p>
        <div class="space-y-1.5">
          <label v-for="b in backups" :key="b.day"
            class="flex items-center gap-2 px-3 py-2 rounded-xl border cursor-pointer text-sm"
            :class="restoreTarget === b.day ? 'border-accent/50 bg-accent/10' : 'border-hairline hover:bg-overlay/5'">
            <input type="radio" v-model="restoreTarget" :value="b.day" class="accent-accent" />
            <span class="font-bold text-fg">{{ b.day }}</span>
            <span class="text-xs text-muted">最後備份 {{ fmtTime(b.updated_at) }}</span>
          </label>
        </div>
        <p v-if="restoreError" class="text-xs text-danger font-bold">{{ restoreError }}</p>
        <div class="flex gap-2 justify-end">
          <button @click="restoreOpen = false" class="px-4 py-2 rounded-xl text-xs font-bold bg-elevated border border-hairline text-fg-secondary hover:text-fg cursor-pointer">取消</button>
          <button @click="confirmRestore" :disabled="!restoreTarget || restoreBusy"
            class="px-4 py-2 rounded-xl text-xs font-bold bg-accent text-white hover:bg-accent-hover disabled:opacity-40 cursor-pointer">
            {{ restoreBusy ? '還原中…' : '還原' }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
