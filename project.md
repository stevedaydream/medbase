# MedBase — 臨床醫囑查詢 + 排班系統

> 最後更新：2026-04-04（員工編號登入；急救模式移除；臨床工具集新增）

---

## 1. 專案概述

MedBase 是一個雙系統整合的醫療工具：

| 子系統 | 介面 | 主要使用者 |
|--------|------|-----------|
| **臨床知識庫** | Tauri 桌面 App | 醫師、護理師（查閱藥物、處方、手術） |
| **排班系統（桌機端）** | Tauri 桌面 App | 排班者、管理員（編輯班表、輪序管理） |
| **排班系統（手機端）** | Vue PWA on Netlify | 員工（查看班表、送出 3 志願預約） |

---

## 2. 技術架構

### 2.1 桌機端（Tauri App）
- **框架：** Vue 3 + Vite + Tailwind CSS v4 + TypeScript
- **引擎：** Tauri v2 (Rust)
- **資料庫：** SQLite via `@tauri-apps/plugin-sql`
- **檔案 I/O：** `@tauri-apps/plugin-fs`（AHK 腳本讀寫）
- **工具：** VueUse、xlsx (SheetJS)、Tiptap（富文本）、qrcode

### 2.2 手機端 PWA（`mobile/`）
- **框架：** Vue 3 + Vite + Tailwind CSS v4 + TypeScript
- **部署：** Netlify（`mobile/netlify.toml` 已配置）
- **資料來源：** Google Apps Script Web App（`gas/scheduler.gs`）
- **API 通訊：** `fetch()` POST + `Content-Type: text/plain`（繞過 CORS preflight）
- **本機狀態：** `localStorage`（session、草稿）

### 2.3 雲端層（Google Apps Script）
- **部署方式：** GAS Web App（clasp CLI）
- **Script ID：** `1wHwoBoh_HrhrliBnTW4AvDZK1AVlIv2zATthbAogiIgcDDqRUZB9sC8f`
- **Deployment ID：** `AKfycbxORGI_XtO-2_fnWJZMvSm74Aj8pp0NfqQUhCsp-gVdDltoDFoyv0VYdiTbVEa0YwXNzw`
- **目前版本：** @8
- **功能：** login、getSchedule、getConfig、getShifts、saveRequest（手機端）；saveStaff、saveSchedule、saveRotation（桌機端同步）

---

## 3. 目錄結構

```
medbase/
├── src/                    # 桌機端 Vue
│   ├── views/              # 各功能頁面（15 個 View）
│   ├── components/         # 共用元件 + scheduler/ 子元件
│   ├── composables/        # useShifts.ts、useStaff.ts
│   ├── utils/              # sha256.ts、rotationEngine.ts
│   ├── db/                 # index.ts（schema + 初始化）
│   └── router/
├── src-tauri/              # Tauri Rust 層
├── gas/                    # Google Apps Script
│   ├── scheduler.gs        # 全部後端邏輯（~680 行）
│   └── appsscript.json
├── mobile/                 # 手機端 Vue PWA（獨立專案）
│   ├── src/views/          # Login / Main / Schedule / Booking
│   ├── src/api.ts          # GAS fetch wrapper
│   ├── netlify.toml
│   └── .env                # VITE_GAS_URL（勿提交 git）
└── project.md
```

---

## 4. 資料庫 Schema（SQLite）

### 4.1 臨床知識庫
| 表格 | 說明 |
|------|------|
| `medications` | 藥物字典（IV 速度、警示、同義詞） |
| `prescriptions` | 處方套組 |
| `surgery` / `disease` / `examination` | 臨床常規 CRUD |
| `items` + `item_depts` | 自費品項與院內碼 |
| `sets` + `set_items` | 耗材套組 |
| `physicians` | 醫師通訊錄（本地儲存帳密供複製） |
| `emergency_protocols` | 危急情境純查閱 |

### 4.2 排班系統
| 表格 | 說明 |
|------|------|
| `scheduler_users` | 員工帳號 + pw_hash + role + employee_id（登入帳號）|
| `scheduler_staff` | 排班用員工清單（名稱、代號） |
| `scheduler_shifts` | 班別定義（代碼、顏色） |
| `scheduler_schedule_YYYYMM` | 每月草稿班表 |
| `app_settings` | 全域 key-value（booking_open、booking_month 等） |

### 4.3 其他
| 表格 | 說明 |
|------|------|
| `ahk_scripts` + `ahk_groups` + `ahk_group_scripts` | AHK 腳本管理 |
| `acp_sets` + `acp_items` + `acp_records` | ACP 評估系統 |
| `contacts` | 常用分機通訊錄 |

---

## 5. 排班系統角色與權限

| 功能 | super | admin | scheduler | employee |
|------|:-----:|:-----:|:---------:|:--------:|
| 查看班表 | ✓ | ✓ | ✓ | ✓（手機） |
| 編輯排班格 | ✓ | ✓ | ✓ | — |
| 輪序池管理 | ✓ | ✓ | ✓ | — |
| 發布班表 | ✓ | ✓ | ✓ | — |
| 開放/關閉預約 | ✓ | ✓ | ✓ | — |
| 審核預約請求 | ✓ | ✓ | ✓ | — |
| 人員管理 | ✓ | ✓ | — | — |
| 密碼重設 | ✓ | ✓ | — | — |
| GAS 技術設定 | ✓ | — | — | — |

---

## 6. 已實作功能

### 6.1 臨床知識庫
- ✅ 藥物字典、處方套組、手術/疾病/檢查 CRUD
- ✅ 危急情境純查閱（紅字標示）
- ✅ 全域搜尋 Ctrl+K（快取索引，跨模組）
- ✅ 自費品項院內碼一鍵複製
- ✅ AHK 腳本管理（CRUD、套組、自動 Reload）
- ✅ ACP 評估系統
- ✅ xlsx 匯入（自費品項、醫師通訊錄、健保藥典）
- ✅ 臨床工具集（`/tools`）：校正鈣、ABG 判讀、血糖胰島素試算、每日營養需求、FiO₂ 換算

### 6.2 排班系統（桌機）
- ✅ 角色登入（super/admin/scheduler/employee）、Tab 權限控制
- ✅ 班表 CRUD（月份切換、拖曳多選、批次填班）
- ✅ 輪序引擎（`rotationEngine.ts`：quota、circular pick、month projection）
- ✅ RotationTab：池管理、成員拖曳排序、投影預覽
- ✅ 跨月輪序連續性（publish 儲存 proposedPools snapshot，下月載入）
- ✅ RequestsTab：開放/關閉預約視窗、雲端拉取請求、adopt/ignore
- ✅ 請求 badge 覆蓋在班表格（orange=pending、green=match、gray=mismatch）
- ✅ 班表發布（status → published、保存快照、關閉預約）
- ✅ QR Code 顯示手機端連結（RequestsTab，改為輸入 Netlify 站點 URL，儲存至 `scheduler_mobile_app_url`）
- ✅ 同步到 Google Sheets（Staff、Schedule、Rotation、Config）
- ✅ XLSX 匯出格式對應參考班表（5 列表頭、日期序列、星期標示、班別統計、放假人數、國假註記）
- ✅ XLSX 日期列預填公式（C4=`DATE($G$2,$J$2,1)`，後續欄=前格+1）
- ✅ 資料新鮮度追蹤：Dirty flag、來源標示、自動存檔 SQLite（debounce 2s）、月份切換自動還原
- ✅ BookingTab：桌機端預約登記（所有角色可用）；左側人員清單點選變色啟用；橫向日期格點選設定 v1/v2/v3；草稿自動存 SQLite `scheduler_booking_drafts_YYYYMM`；一鍵同步雲端（GAS `saveRequest`）

### 6.3 排班系統（手機 PWA）
- ✅ 獨立 Vue 3 專案（`mobile/`），部署在 Netlify
- ✅ 登入（SHA-256 + GAS verify）
- ✅ 查看班表（月份切換、色碼顯示）
- ✅ 預約頁改為橫向總表（日期為欄、單人列）；點格子底部滑出設定當日 v1/v2/v3；v1 藍色 badge、v2 紫點、v3 橘點；草稿 localStorage、確認送出
- ✅ 說明卡 + 志願欄位標籤（第1/2/3 志願色碼提示）

---

## 7. 已知問題與待辦

### 🔴 必須修復（上線前）

| # | 問題 | 位置 | 處理方式 |
|---|------|------|---------|
| 1 | **Dev 模式 super 預設登入未還原** | `SchedulerView.vue:56` | `session = ref(null)` |
| 2 | **mobile/.env 無 .gitignore** | `mobile/` | 新增 `.gitignore` 含 `.env` |
| 3 | **SHA-256 無鹽值** | `scheduler_users.pw_hash` | 升級為 bcrypt 或加 salt prefix |

### 🟡 技術債（Phase 4）

| # | 問題 | 影響 | 狀態 |
|---|------|------|------|
| 4 | **SchedulerView.vue 過大** | 維護困難 | ✅ 已拆出 `useShifts.ts`、`useStaff.ts` composable |
| 5 | **sha256.ts 重複** | `src/utils/` 與 `mobile/src/utils/` 各一份 | ⚪ 暫接受（各自獨立） |
| 6 | **GAS `buildMobileHtml()` 死代碼** | 手機端已改 Netlify Vue | ✅ 已移除（~437 行），縮減至 ~237 行 |
| 7 | **AcpView / AcpSettingsView / SetsView / ItemsView 無 try/catch** | DB 操作失敗時無提示 | ✅ 已補 try/catch + toast 提示 |
| 8 | **手機端班表無快取** | 每次切月份都重新 fetch | ✅ 已加 `sessionStorage` 快取 + 強制重整按鈕 |
| 9 | **mobile/ 無 PWA Service Worker** | 離線功能缺失 | ✅ 已新增 `public/sw.js`（cache-first + GAS network-only） |
| 10 | **列表無分頁** | 資料量大時效能下降（目前小資料量暫可接受） | ⚪ 保留 |
| 11 | **`created_at` 無時區標準化** | 跨時區部署時資料混亂 | ⚪ 保留 |
| 12 | **動態班別每日目標** | `DayTarget = number \| DerivedTarget`，支援平日/週六/週日/國假分開設定 | ✅ 已完成 |
| 13 | **國定假日管理** | API（TaiwanCalendar）/ CSV 匯入 / 手動新增；休息日(A0)/例假日(B0)/國假三色區分；「特殊日期標註」列自動填假日名稱，Sat/Sun自動補休息日/例假日；XLSX班表格COUNTIF公式 | ✅ 已完成 |

### 🟢 優化建議（Nice to have）

| # | 建議 | 說明 |
|---|------|------|
| 14 | **手機端 schedule 色碼對應表從 GAS 取** | 目前硬寫 D=blue/N=indigo/AM=amber，應從 Shifts 表動態載入 |
| 15 | **GAS `handleApi` 加 rate limiting** | 防止員工惡意刷 saveRequest |
| 16 | **排班者採用請求後無 undo** | adopt 操作不可逆，建議加確認對話框 |
| 17 | **Zod 輸入驗證** | 防止非預期資料進 SQLite |
| 18 | **Windows 打包 (.exe)** | 尚未實機測試 |

---

## 8. 開發階段歷程

| 階段 | 狀態 | 內容 |
|------|------|------|
| Phase 1 | ✅ | Tauri + Vue 3 環境、SQLite schema、xlsx 匯入 |
| Phase 2 | ✅ | 藥物字典、處方、通訊錄、手術/疾病/檢查 CRUD |
| Phase 3 | ✅ | AHK 模組、危急情境純查閱、CSP 修正、OmniSearch 快取、DB 索引 |
| Phase A | ✅ | 排班系統基底：角色登入、班表 CRUD、班別設定 |
| Phase B | ✅ | Tab 4 人員管理（密碼重設）、Tab 1 發布按鈕 |
| Phase C | ✅ | rotationEngine.ts、RotationTab、投影覆蓋層 |
| Phase D | ✅ | RequestsTab（預約視窗控制、pull/adopt/ignore、badge） |
| Phase E | ✅ | GAS Web App（doPost API、clasp 部署） |
| Phase F | ✅ | 跨月輪序連續性、QR code |
| Phase G | ✅ | 手機端改為獨立 Netlify Vue PWA（解決 GAS CORS 問題） |
| Phase 4 | ✅ | 技術債修復：composable 拆分、GAS 死碼清除、try/catch 補全、手機快取、PWA SW |

---

## 9. 部署快速參考

### 桌機端
```bash
cd G:/project/medbase
npm run tauri build
```

### 手機端（Netlify）
```bash
# 設定環境變數
echo "VITE_GAS_URL=https://script.google.com/macros/s/.../exec" > mobile/.env

cd mobile && npm run build
# 推到 GitHub → Netlify 自動部署
# Build command: npm run build | Publish dir: dist | Base: mobile
```

### GAS 更新
```bash
cd G:/project/medbase/gas
clasp push --force
clasp deploy --deploymentId AKfycbxORGI_XtO-2_fnWJZMvSm74Aj8pp0NfqQUhCsp-gVdDltoDFoyv0VYdiTbVEa0YwXNzw --description "描述"
```
