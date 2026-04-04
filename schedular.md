# 排班系統重新設計 — 修改流程文件

> 版本：v2.1
> 日期：2026-04-03
> 狀態：細節確認完畢，待實作

### 已確認細節

| 項目 | 決定 |
|---|---|
| 密碼 Hash | **SHA-256** |
| 輪序每日人數 | **可設定**（scheduler 以上可調整，預設 1） |
| 員工預約班別 | **多順序志願**（第 1 / 2 / 3 志願） |
| 手機端 PWA | **是**（可加至主畫面，離線查看已發布班表） |
| 投影值顯示 | **常駐**（班表格永遠顯示，不需切換模式） |

---

## 一、設計目標

整合兩種使用場景：

| 場景 | 介面 | 說明 |
|---|---|---|
| 員工 | 手機瀏覽器（GAS Web App） | 查看班表、提交預約班別 |
| 排班者 / 管理者 | 桌面 Tauri App | 排班編輯、輪序管理、預約控制、人員管理 |

---

## 二、角色系統（更新）

### 角色定義

| 角色 | 說明 |
|---|---|
| `super` | 超級帳號，全域設定、GAS 部署、帳號管理 |
| `admin` | 管理者，人員管理、班別設定、輪序設定 |
| `scheduler` | 排班者，排班編輯、輪序管理、預約視窗控制 |
| `employee` | 員工，查看班表、提交預約班別（手機） |

### 權限矩陣（修正：scheduler 可管理輪序）

| 功能 | super | admin | scheduler | employee |
|---|:---:|:---:|:---:|:---:|
| 查看班表 | ✓ | ✓ | ✓ | ✓ |
| 提交預約班別 | — | — | — | ✓ |
| 編輯排班格 | ✓ | ✓ | ✓ | — |
| 套用輪序至班表 | ✓ | ✓ | ✓ | — |
| 確定/發布班表 | ✓ | ✓ | ✓ | — |
| **輪序池管理** | ✓ | ✓ | **✓** | — |
| **輪序預測預覽** | ✓ | ✓ | **✓** | — |
| 開放/關閉預約視窗 | ✓ | ✓ | ✓ | — |
| 審核員工預約請求 | ✓ | ✓ | ✓ | — |
| 人員管理（新增/刪除） | ✓ | ✓ | — | — |
| 密碼重設 | ✓ | ✓ | — | — |
| 班別設定（顏色/配額） | ✓ | ✓ | — | — |
| GAS / Sheets 技術設定 | ✓ | — | — | — |

---

## 三、資料模型

### 3.1 SQLite — 新增 `scheduler_users` 資料表

```sql
CREATE TABLE IF NOT EXISTS scheduler_users (
  code       TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  role       TEXT NOT NULL DEFAULT 'employee',
  pw_hash    TEXT NOT NULL,
  is_active  INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0
);
```

> `pw_hash`：SHA-256（前期）或 bcrypt（後期）

現有 `app_settings` 繼續使用，新增 key：
- `scheduler_booking_open`：`'true'` / `'false'`
- `scheduler_booking_month`：`'202606'`
- `scheduler_booking_from`：`'2026-05-15'`
- `scheduler_booking_until`：`'2026-05-31'`
- `scheduler_rotation_pools`：JSON，輪序池完整狀態
- `scheduler_session_role`：目前登入角色（記憶體即可，勿持久化）

---

### 3.2 Google Sheets 分頁結構

| 分頁名稱 | 欄位 | 說明 |
|---|---|---|
| `Staff` | code, name, role, pw_hash | 人員清單（同步用，含密碼 hash） |
| `Rotation` | poolName, order (JSON), lastIndex | 輪序池狀態 |
| `Config` | key, value | booking_open, booking_month 等 |
| `Schedule_YYYYMM` | 姓名, 1日…31日 | 最終發布班表（現有） |
| `Requests_YYYYMM` | code, name, 1日_v1, 1日_v2, 1日_v3…31日_v3 | 員工多順序志願請求（新增） |

---

### 3.3 輪序池資料結構

```typescript
interface RotationPool {
  poolName: string;     // 例：'satD', 'sunN', 'holD'
  label: string;        // 例：'週六白班', '週日夜班'
  shiftCode: string;    // 對應班別代碼，例：'D', 'N', 'AM'
  quota: number;        // 每日應派人數（預設 1，scheduler+ 可調整）
  order: string[];      // 員工 code 順序陣列
  lastIndex: number;    // 上次指派到的 index（下次從 lastIndex+1 開始）
  skipQueue: string[];  // 暫時跳過的員工 code
}
```

預設池（可由 scheduler/admin 自訂名稱、成員、每日人數）：
```
satD  週六白班  quota:1 | satN  週六夜班  quota:1
sunD  週日白班  quota:1 | sunN  週日夜班  quota:1
holD  假日白班  quota:1 | holN  假日夜班  quota:1
wdOff 平日Off   quota:1 | （可新增自訂池）
```

> `quota > 1` 時，同一池在同一天會依序指派 quota 位員工（circular 推進 quota 次）

---

## 四、Desktop App UI 架構

### 4.1 整體佈局

```
┌────────────────────────────────────────────────────────────────┐
│  排班表   2026/05  ‹ ›  ● 草稿             [王○○ scheduler ▾]  │
│──────────────────────────────────────────────────────────────  │
│  班表 │ 輪序 │ 請求 │ 人員 │ 設定                               │
├────────────────────────────────────────────────────────────────┤
│                                                                │
│  [選中 Tab 的內容區]                                            │
│                                                                │
└────────────────────────────────────────────────────────────────┘
```

- **Header**：月份切換、班表狀態標籤（草稿 / 已發布）、登入者資訊
- **登入 Modal**：首次進入排班頁或未登入時顯示，輸入代號 + 密碼
- **Tab Bar**：水平排列，無權限的 Tab 隱藏（不顯示）

---

### 4.2 Tab 1：班表

**Toolbar**
```
[↓ 從雲端同步]  [套用輪序]  [↑ 發布班表]
```

**班表格（保留現有所有功能，新增視覺層）**

| 儲存格狀態 | 外觀 |
|---|---|
| 空白 | 灰點 `·` |
| 已排班別（草稿） | 實心色塊（現有） |
| 輪序投影（常駐顯示） | 色塊 + 50% 透明 + 虛線邊框，永遠顯示直到該格有實際值 |
| 投影值與實際值相同 | 實心色塊（投影隱藏，以實際值為準） |
| 員工有預約請求 | 右上角志願角標（1 / 2 / 3，橘色） |
| 請求第 1 志願已採納 | 右上角綠色角標 |
| 請求志願被覆蓋 | 右上角灰色角標 |

**操作流程**
```
新月份建立
  → 輪序投影自動計算，格子顯示半透明預測值
  → 員工提交預約 → 橘點出現
  → Scheduler 手動調整格子（環狀選單 / 拖選）
  → 點「套用輪序」→ 投影值轉為草稿實心值（仍可手動改）
  → 點「發布班表」→ 狀態=已發布，推至 Schedule_YYYYMM，自動關閉預約視窗
```

---

### 4.3 Tab 2：輪序

> 角色：admin、scheduler

**左側：輪序池列表（可拖拽重排成員）**

```
┌──────────────────┬────────────────────────────────────────────────────┐
│ 池               │ 成員順序與設定                                       │
├──────────────────┤                                                    │
│ ▶ 週六白班 satD  │ 班別：[D ▾]  每日人數：[1 ↑↓]                       │
│   週六夜班 satN  │                                                    │
│   週日白班 sunD  │ [A01 王○] [B02 李○] ▶[C03 張○] [D04 陳○]          │
│   週日夜班 sunN  │  （▶ = 下次輪到的人；拖拽調整順序）                   │
│   假日白班 holD  │                                                    │
│   假日夜班 holN  │  [+ 加入成員]  [× 移除成員]  「設為起點」(hover)      │
│   平日 Off wdOff │                                                    │
│   [+ 新增自訂池] │                                                    │
└──────────────────┴────────────────────────────────────────────────────┘
```

- **班別**：對應的班別代碼（D / N / AM / Off / 自訂），決定投影時填入的值
- **每日人數（quota）**：同一天從此池連續取幾人，quota > 1 時 lastIndex 推進 quota 次

**右側：月份投影預覽（唯讀）**

```
預覽月份：[2026/06 ▾]   [計算預測]

日期     星期  類型      指派（每格顯示 quota 人）
06/01    日    sunD×2   C03 張○  A01 王○
06/07    六    satD×1   D04 陳○
06/07    六    satN×1   B02 李○
06/08    日    sunD×2   B02 李○  C03 張○
...

（計算不影響實際池狀態，點「套用至班表」才寫入班表 Tab）
```

**跨月連貫性**
- 發布班表時同步儲存 `proposedPools`（lastIndex 快照）到 `app_settings`
- 次月計算從快照開始，確保輪序不斷層
- 若中間有月份缺口，向前模擬補算後再投影

**操作**：
- 拖拽成員調整順序
- 點 `▶` 設為輪序起點
- 調整 quota（每日人數）：spinner 輸入，scheduler+ 可改
- `+ 新增池`：輸入池名稱 + label + 班別 + quota，選擇成員
- `× 移除池`：自訂池才可刪除

---

### 4.4 Tab 3：請求

> 角色：admin、scheduler

**頂部：預約視窗控制**
```
預約月份：[2026/06]
開放期間：[2026-05-15] 至 [2026-05-31]
[● 開放預約]  ←切換→  [○ 關閉預約]

手機端 URL：https://script.google.com/.../exec?month=202606
[複製連結]  [顯示 QR Code]
```

**請求列表**
```
篩選：[全部 ▾]  排序：[提交時間 ▾]

姓名   代號  提交時間  狀態     預約天數概覽
王○○   A01   05/16    ○ 待審   D×8 N×5 Off×6
李○○   B02   05/17    ✓ 已採納  D×9 Off×6
張○○   C03   （未提交）—        —
[查看詳情] [採納至班表] [標記忽略]
```

**詳情展開**：顯示該員工完整 31 天預約格（唯讀），可逐格採納

---

### 4.5 Tab 4：人員

> 角色：admin、super

**人員列表（現有 Staff Tab + 擴充欄位）**

| 欄位 | 說明 | 可編輯角色 |
|---|---|---|
| 代號 | 唯一，英數 | admin+ |
| 姓名 | 顯示名 | admin+ |
| 角色 | employee / scheduler / admin | admin+（super 才能設 super） |
| 密碼 | 不顯示明文，[重設] 按鈕 | admin+ |
| 狀態 | 啟用 / 停用 | admin+ |
| 排序 | 拖拽（影響班表行序） | admin+ |

**雲端同步行為**
- 上傳：同步 code, name, role, pw_hash → `Staff` 分頁
- 拉取：更新 name, role（本地密碼優先，不被雲端覆蓋）

---

### 4.6 Tab 5：設定

> 角色：super（技術設定）；admin 可看 Sheets 設定

- Spreadsheet ID、API Key、GAS Web App URL
- Sheet 前綴（預設 `Schedule_`）
- 本地 XLSX 路徑（建立範本 / 選擇現有）
- 班別設定（代碼、顏色、每月目標天數）
- GAS 部署說明（步驟 1–3，現有內容）

---

## 五、手機端（GAS Web App + PWA）

### 5.0 PWA 支援

GAS `doGet()` 回傳的 HTML 頁面嵌入 PWA 必要元素：

```html
<link rel="manifest" href="?manifest=1">
<meta name="theme-color" content="#111827">
<meta name="apple-mobile-web-app-capable" content="yes">
```

`doGet(e)` 分支：
- `e.parameter.manifest === '1'` → 回傳 `manifest.json`（Content-Type: application/json）
- 其餘 → 回傳主 HTML

**manifest.json 內容**
```json
{
  "name": "排班系統",
  "short_name": "排班",
  "start_url": "?pwa=1",
  "display": "standalone",
  "background_color": "#111827",
  "theme_color": "#111827",
  "icons": [
    { "src": "?icon=192", "sizes": "192x192", "type": "image/png" },
    { "src": "?icon=512", "sizes": "512x512", "type": "image/png" }
  ]
}
```

- icon 由 GAS `doGet` 依 `e.parameter.icon` 回傳內嵌的 base64 PNG
- **離線快取**：Service Worker 快取最後一次取得的已發布班表（Schedule_YYYYMM），無網路時可查看

---

### 5.1 doGet() HTML 流程

```
啟動
  ↓
[登入頁] 代號 + 密碼 → GAS 驗證 Staff 分頁 pw_hash
  ↓ 成功
[首頁]
  ├── Tab: 班表        → 查看 Schedule_YYYYMM（唯讀，所有人）
  └── Tab: 預約班別   → 填寫個人偏好（預約開放時才可提交）

  若 role = scheduler：
  └── Tab: 預約管理   → 開關預約視窗、查看所有人請求概覽
```

### 5.2 「預約班別」Tab（員工）

多順序志願設計：每格可填最多 3 個志願，依優先度排列。

```
2026年06月 預約班別
（開放期間：05/15 — 05/31）

      1      2      3      4   ...
      一     二     三     四
    [D    ] [    ] [N    ] [   ]
    [N    ] [    ] [     ] [   ]   ← 第 2 志願列
    [     ] [    ] [     ] [   ]   ← 第 3 志願列（可選填）

    格子點擊 → 底部滑出選單：
    [D]  [N]  [AM]  [Off]  [✕ 清除]
    （各列依序填入，未填視為無志願）

[儲存草稿]   [確認送出]
```

- **儲存草稿**：不送出，僅存手機本地
- **確認送出**：POST 至 GAS saveRequest，送出後可在視窗關閉前修改
- 預約視窗關閉後顯示「班表排班中，請等待發布」
- 班表發布後「預約班別」tab 改為灰色唯讀，顯示志願對應採納結果

### 5.3 Scheduler 手機端額外功能

- 查看所有員工請求狀態（名單 + 提交率）
- 開關預約視窗（緊急需要時）

---

## 六、GAS 修改

### 6.1 新增 doGet()

```javascript
function doGet(e) {
  return HtmlService
    .createHtmlOutput(buildMobileHtml())
    .setTitle('排班系統');
}
```

### 6.2 doPost() 新增 actions

| action | 說明 | 呼叫方 |
|---|---|---|
| `login` | 驗證代號 + pw_hash | 手機端 |
| `saveStaff` | 現有，加 role/pw_hash | Desktop |
| `saveSchedule` | 原 `batchSaveShifts`，改名 | Desktop |
| `saveRotation` | 寫入 Rotation 分頁 | Desktop |
| `saveConfig` | 更新 Config 分頁 | Desktop / 手機 Scheduler |
| `saveRequest` | 員工提交多順序志願 | 手機 Employee |
| `getRequests` | 拉取 Requests_YYYYMM（或走 Sheets API） | Desktop |
| `manifest` | 回傳 PWA manifest JSON | 手機瀏覽器 |
| `icon` | 回傳 PWA icon PNG (base64) | 手機瀏覽器 |

---

## 七、實作順序

### Phase A：基礎架構

1. **`scheduler_users` 資料表建立**
   - 執行 SQL migration（`getDb()` 初始化時 CREATE TABLE IF NOT EXISTS）
   - 預設建立 super 帳號（固定代號 + 初始密碼）

2. **登入 Modal 元件**
   - 帳號 / 密碼輸入
   - 查詢 `scheduler_users`，比對 pw_hash
   - 登入成功：session ref 儲存 `{ code, name, role }`
   - 未登入 → 鎖定頁面

3. **水平 Tab 框架**
   - 依 session.role 決定顯示哪些 Tab
   - 現有 showSettings / showGuide / showStaff panels → 遷移至各 Tab

---

### Phase B：Tab 重構

4. **Tab 5 設定**
   - 現有 Settings Panel 內容搬入
   - 現有 Guide Panel 內容搬入（步驟說明）

5. **Tab 4 人員**
   - 現有 Staff Panel 搬入
   - 新增 role 欄位、pw_hash 重設按鈕
   - 同步 schema 更新（pushStaffToCloud 帶 role/pw_hash）

6. **Tab 1 班表**
   - 保留現有所有邏輯
   - 新增班表狀態（草稿 / 已發布）ref
   - 發布按鈕：上傳 + 寫 Config.booking_open=false

---

### Phase C：輪序系統

7. **輪序引擎**（移植 `rotationEngine.js` 為 TypeScript）
   - `getNextInPool(pool, quota, skipIds)` — 連續取 quota 人
   - `runProjection(pools, year, month, holidays)` — 唯讀月份投影
   - `advancePool(pool, steps)` — lastIndex 推進 steps 次
   - quota 欄位整合至 RotationPool 介面

8. **Tab 2 輪序**
   - 池列表（從 `app_settings.scheduler_rotation_pools` 讀取）
   - 成員拖拽排序
   - **quota（每日人數）** spinner 輸入，scheduler+ 可修改
   - 投影預覽表格（含 quota 展開多人）

9. **班表格輪序投影層（常駐）**
   - computed `projectedCells`：`Map<'ri-di', { code: string, fromPool: string }>`
   - 格子邏輯：`有實際值 → 顯示實際值；僅有投影 → 顯示半透明投影`
   - 投影層永遠計算，無需切換模式

---

### Phase D：預約系統

10. **Tab 3 請求**
    - 預約視窗控制（讀寫 `app_settings` + GAS Config 分頁）
    - 從雲端拉取 `Requests_YYYYMM`
    - 請求列表 + 採納功能（採納時寫入 scheduleData）

11. **員工請求 badge（志願角標）**
    - `requestMap`：`Map<'ri-di', { v1, v2, v3 }>` 三志願格式
    - 格子右上角顯示志願序號角標（1 / 2 / 3）
    - hover tooltip：`第 1 志願：D，第 2 志願：N`
    - 採納後角標轉綠；實際值與志願不符轉灰

12. **GAS doPost `saveRequest`**
    - `Requests_YYYYMM` 欄位：`code, name, d1_v1, d1_v2, d1_v3, d2_v1, …, d31_v3`
    - 每日三欄（v1/v2/v3）儲存三個志願班別（空白 = 無此志願）

---

### Phase E：手機端

13. **GAS doGet HTML + PWA**
    - `manifest` / `icon` 路由（`e.parameter` 分支）
    - Service Worker 內嵌（`<script>` 內 blob URL 或 inline）
    - 離線快取：最後一次成功的 Schedule_YYYYMM JSON

14. **手機登入 + 班表查看**
    - 代號 + 密碼 → SHA-256 hash → 對比 Staff 分頁 pw_hash
    - 已發布班表唯讀格（色塊樣式與 Desktop 一致）

15. **「預約班別」Tab（多志願）**
    - 每格 3 列志願輸入
    - 底部選班滑出選單
    - 儲存草稿（localStorage）/ 確認送出（POST saveRequest）
    - 視窗關閉後唯讀，顯示採納結果角標

16. **GAS 手機 Scheduler 功能**
    - 查看請求列表（員工名稱 + 提交率）
    - 開關預約視窗（寫 Config 分頁）

---

### Phase F：收尾

17. **跨月輪序連貫**
    - 發布時儲存 `proposedPools` 快照至 `app_settings`
    - 次月讀取快照作為投影起點
    - 缺口月份自動向前模擬補算

18. **投影 × 請求衝突視覺化**
    - 若投影值與員工第 1 志願相符 → 角標顯示「✓ 吻合」
    - 若不符 → 角標顯示志願序號（排班者參考決策）

19. **測試流程驗證**
    - super → 設定 GAS / Sheets
    - admin → 建立人員帳號、設定輪序池（含 quota）
    - scheduler → 開放預約（設定月份 + 期限）、計算投影、套用輪序
    - employee（手機 PWA）→ 安裝至主畫面、登入、填寫三志願、確認送出
    - scheduler → 拉取請求、審核、採納、手動微調、發布
    - employee → 查看最終班表（PWA 離線可查）

---

## 八、保留不變的部分

- 班表格拖選 + batch picker
- 單格環狀選單（radial menu）
- XLSX 讀寫（讀取 / 存為）
- no-cors POST 至 GAS
- Google Sheets API Key 讀取模式
- SQLite `app_settings` key-value 儲存
- `fullHeight` 路由 meta
- 月份切換、新月份自動建立邏輯
- 班別自訂（顏色、代碼、目標天數）
- 每日人力 summary row
- 配額統計欄

---

## 九、設計決策紀錄

| 項目 | 決定 | 說明 |
|---|---|---|
| 密碼 hash | SHA-256 | 前端計算後再送出，不傳明文 |
| 每日輪序人數 | 可設定（quota 欄位） | scheduler+ 可調整，預設 1，quota > 1 時連續取人 |
| 員工預約 | 最多 3 志願 | v1/v2/v3 欄位，空白視為無志願 |
| 手機 PWA | 支援 | manifest + icon 由 GAS doGet 路由回傳，SW 快取離線班表 |
| 投影顯示 | 常駐 | 有實際值蓋過投影；投影層永遠計算，無切換按鈕 |
