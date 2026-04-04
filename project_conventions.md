# 程式碼慣例（Code Conventions）

> **模板說明：** 本文件記錄專案內約定俗成的程式碼模式。
> 換新專案時，保留章節結構，替換各節內容。

---

## 1. 技術棧快速索引

| 層級 | 技術 |
|------|------|
| UI 框架 | Vue 3 `<script setup>` + TypeScript |
| 樣式 | Tailwind CSS v4（暗色主題為主） |
| 桌機殼層 | Tauri v2（Rust） |
| 資料庫 | SQLite via `@tauri-apps/plugin-sql` |
| 手機端 | 獨立 Vue PWA（`mobile/`），部署於 Netlify |
| 雲端後端 | Google Apps Script Web App（`gas/scheduler.gs`） |
| 狀態管理 | Composables（無 Pinia，僅排班用 Pinia store） |

---

## 2. 檔案結構慣例

```
src/
├── views/          # 頁面級元件（一路由一檔案）
├── components/     # 共用元件；子系統放子資料夾（scheduler/）
├── composables/    # 可重用邏輯（useXxx.ts）
├── utils/          # 純函式工具（sha256.ts、rotationEngine.ts）
├── db/             # index.ts 唯一入口，含 schema + seed
└── router/         # index.ts
```

**命名規則**
- 元件：`PascalCase.vue`
- Composable：`useXxx.ts`，回傳物件
- 工具函式：`camelCase.ts`

---

## 3. 資料庫操作慣例

**永遠透過 `getDb()` 取得單例連線，操作包在 try/catch。**

```typescript
// ✅ 標準寫法
import { getDb } from "@/db";

async function loadData() {
  try {
    const db = await getDb();
    const rows = await db.select<MyType[]>("SELECT ...", [param]);
    // ...
  } catch (e) {
    showToast(`載入失敗：${(e as Error).message}`);
  }
}
```

**全域 key-value 設定** 統一存 `app_settings` 表，透過 `setSetting()` 讀寫：

```typescript
// 寫入
await setSetting("my_key", JSON.stringify(value));

// 讀取
const row = await db.select<{value: string}[]>(
  "SELECT value FROM app_settings WHERE key = ?", ["my_key"]
);
```

---

## 4. Toast 通知慣例

**SchedulerView** 有完整 toast 實作，其他 View 視需要自行 local 實作相同模式：

```typescript
const toast = ref("");
let toastTimer: ReturnType<typeof setTimeout> | null = null;

function showToast(msg: string) {
  toast.value = msg;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.value = ""; }, 2500);
}

onUnmounted(() => { if (toastTimer) clearTimeout(toastTimer); });
```

Template 中固定放在畫面右下角：
```html
<div v-if="toast"
  class="fixed bottom-4 right-4 z-50 px-4 py-2 bg-gray-800 text-gray-200 text-sm rounded-lg shadow-lg border border-gray-700">
  {{ toast }}
</div>
```

---

## 5. Composable 慣例

- 接收 `deps` 物件（避免參數列過長）
- 內部 `ref` 不對外暴露實作細節
- 統一從 `return {}` 一次暴露所有公開成員

```typescript
export function useXxx(deps: {
  settings: Ref<Settings>;
  showToast: (msg: string) => void;
}) {
  const { settings, showToast } = deps;
  const data = ref([]);

  async function load() { ... }

  return { data, load };
}
```

---

## 6. 樣式慣例（Tailwind 暗色主題層次）

| 用途 | class |
|------|-------|
| 最深背景（App 殼） | `bg-gray-950` |
| 頁面 / 側邊欄背景 | `bg-gray-900` |
| 卡片 / 區塊背景 | `bg-gray-800` |
| 邊框 | `border-gray-800` / `border-gray-700` |
| 主要文字 | `text-white` / `text-gray-200` |
| 次要文字 | `text-gray-400` / `text-gray-500` |
| 說明文字 | `text-gray-600` / `text-gray-700` |
| 強調色（互動） | `blue-600` / `blue-700` |
| 危險 / 刪除 | `red-600` / `red-700` |

---

## 7. Tauri 平台注意事項

- **HTML5 Drag & Drop API 在 Tauri WebView 不可靠**，改用 Pointer Events（詳見 `project_bugfix.md` BF-001）
- 檔案讀寫用 `@tauri-apps/plugin-fs`，不用 Node.js `fs`
- 對話框用 `@tauri-apps/plugin-dialog`（`open` / `save`）
- SHA-256 用自實作的 Web Crypto API（`src/utils/sha256.ts`），因 Tauri WASM 環境限制無法用 bcrypt
