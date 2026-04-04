<script setup lang="ts">
import { ref } from "vue";
import { getDb } from "@/db";
import { sha256 } from "@/utils/sha256";

export interface SessionUser {
  code: string;
  name: string;
  role: string;
}

const emit = defineEmits<{ "logged-in": [user: SessionUser] }>();

const employeeId = ref("");
const password   = ref("");
const error      = ref("");
const loading    = ref(false);

async function login() {
  error.value = "";
  const eid = employeeId.value.trim();
  const p   = password.value;
  if (!eid || !p) { error.value = "請輸入員工編號與密碼"; return; }

  loading.value = true;
  try {
    const hash = await sha256(p);
    const db   = await getDb();
    const rows = await db.select<SessionUser[]>(
      "SELECT code, name, role FROM scheduler_users WHERE employee_id = ? AND pw_hash = ? AND is_active = 1",
      [eid, hash]
    );
    if (rows.length === 0) {
      error.value = "員工編號或密碼錯誤";
    } else {
      emit("logged-in", rows[0]);
    }
  } catch (e) {
    error.value = `登入失敗：${(e as Error).message}`;
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-gray-950/90 backdrop-blur-sm">
    <div class="w-80 bg-gray-900 border border-gray-800 rounded-xl shadow-2xl p-8">
      <!-- Logo / Title -->
      <div class="mb-7 text-center">
        <div class="text-2xl font-bold text-white tracking-tight">排班系統</div>
        <div class="text-xs text-gray-600 mt-1">登入以繼續</div>
      </div>

      <!-- Form -->
      <div class="space-y-3">
        <div>
          <label class="block text-xs text-gray-500 mb-1">員工編號</label>
          <input
            v-model="employeeId"
            @keyup.enter="login"
            placeholder="例：E001"
            autocomplete="username"
            class="w-full text-sm px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-200 font-mono outline-none focus:border-blue-500 transition-colors"
          />
        </div>
        <div>
          <label class="block text-xs text-gray-500 mb-1">密碼</label>
          <input
            v-model="password"
            type="password"
            @keyup.enter="login"
            placeholder="••••••••"
            autocomplete="current-password"
            class="w-full text-sm px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-200 outline-none focus:border-blue-500 transition-colors"
          />
        </div>

        <!-- Error -->
        <p v-if="error" class="text-xs text-red-400">{{ error }}</p>

        <!-- Submit -->
        <button
          @click="login"
          :disabled="loading"
          class="w-full mt-1 py-2 bg-blue-700 hover:bg-blue-600 disabled:opacity-50 text-white text-sm font-semibold rounded-lg transition-colors"
        >
          {{ loading ? "驗證中…" : "登入" }}
        </button>
      </div>

      <!-- Hint -->
      <p class="mt-5 text-center text-xs text-gray-700">
        預設超級帳號：員工編號 <span class="font-mono text-gray-600">super</span> ／ 密碼 <span class="font-mono text-gray-600">Admin0000</span>
      </p>
    </div>
  </div>
</template>
