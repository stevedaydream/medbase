# API 合約文件（API Contract）

> **模板說明：** 記錄系統各層之間的介面合約。
> 換新專案時，保留章節結構（內部 API、外部 API、資料格式），替換內容。

---

## 1. GAS Web App API（雲端層）

**端點：** `POST {VITE_GAS_URL}`
**Content-Type：** `text/plain`（繞過 CORS preflight）
**Body 格式：** JSON 字串，包含 `action` 欄位

```typescript
// 通用請求格式
{
  action: string;
  // ... action 專屬參數
}

// 通用回應格式
{
  ok: boolean;
  data?: any;
  error?: string;
}
```

---

### `login` — 員工登入驗證（手機端）

```typescript
// Request
{ action: "login", code: string, pwHash: string }
// code 欄位傳員工編號（employee_id）

// Response
{ ok: true,  data: { code: string, name: string, role: string } }
{ ok: false, error: "員工編號或密碼錯誤" }
```

---

### `getSchedule` — 取得班表（手機端）

```typescript
// Request
{ action: "getSchedule", sheetName: string }
// sheetName 格式："{prefix}YYYYMM"，例如 "Schedule_202504"

// Response
{ ok: true,  data: string[][] }  // 原始 Sheets 二維陣列
{ ok: false, error: "班表分頁不存在" }
```

---

### `getConfig` — 取得 Config 設定

```typescript
// Request
{ action: "getConfig" }

// Response
{ ok: true, data: Record<string, string> }
// 常用 keys: booking_open, booking_month, mobile_url
```

---

### `saveConfig` — 寫入單一 Config 值

```typescript
// Request
{ action: "saveConfig", key: string, value: string }

// Response
{ ok: true }
```

---

### `saveStaff` — 同步員工名單（桌機端）

```typescript
// Request
{
  action: "saveStaff",
  data: Array<{
    code:        string;   // 班表代號（顯示用）
    name:        string;
    role:        string;   // "super" | "admin" | "scheduler" | "employee"
    pw_hash:     string;   // SHA-256 雜湊
    employee_id: string;   // 登入帳號
  }>
}

// Response
{ ok: true }

// Sheets 欄位順序（Staff 分頁）
// [0]代號  [1]姓名  [2]角色  [3]pw_hash  [4]啟用  [5]員工編號
```

---

### `saveSchedule` / `batchSaveShifts` — 同步班表

```typescript
// Request
{
  action: "saveSchedule",
  sheetName: string,
  data: Array<{
    name: string;
    days: (string | null)[];  // length 31，index 0 = 1日
  }>
}

// Response
{ ok: true }
```

---

### `saveRotation` — 同步輪序池

```typescript
// Request
{
  action: "saveRotation",
  pools: Array<{
    poolName:  string;
    label:     string;
    shiftCode: string;
    quota:     number;
    order:     string[];   // JSON stringify
    lastIndex: number;
  }>
}

// Response
{ ok: true }
```

---

### `saveRequest` — 員工提交預約（手機端）

```typescript
// Request
{
  action:  "saveRequest",
  yyyyMM:  string,   // "202504"
  code:    string,   // 員工代號
  name:    string,
  days: Array<{ v1: string|null, v2: string|null, v3: string|null }>
  // length 31，index 0 = 1日
}

// Response
{ ok: true }
// 存入 Requests_YYYYMM 分頁，相同 code 的資料會覆蓋
```

---

### `getRequests` — 拉取預約請求（桌機端）

```typescript
// Request
{ action: "getRequests", yyyyMM: string }

// Response
{ ok: true, data: string[][] }  // 原始二維陣列
```

---

## 2. 內部 Composable 介面

### `useStaff(deps)`

```typescript
// deps
{
  settings:     Ref<{ spreadsheetId, apiKey, gasUrl }>;
  setSetting:   (key: string, value: string) => Promise<void>;
  showToast:    (msg: string) => void;
  scheduleData: Ref<ScheduleRow[]>;
  yyyyMM:       ComputedRef<string>;
}

// returns
{
  staff, filteredStaff,
  newStaffCode, newStaffName, newStaffEmployeeId,
  staffFilter, isStaffLoading,
  resetPwTarget, resetPwInput,
  saveStaffLocal, addStaff, removeStaff,
  importStaffFromSchedule, pullStaffFromCloud, pushStaffToCloud,
  resetUserPassword, addRowFromStaff, initScheduleFromStaff,
  onStaffNameFocus, onStaffNameBlur, onEmployeeIdChange,
}
```

### `useShifts(setSetting)`

```typescript
// returns
{
  shifts, isShiftLoading, expandedShiftIdx,
  loadShifts, saveShiftsLocal,
  isDerived,  // (shift) => boolean
}
```

---

## 3. SQLite 資料格式備忘

### `scheduler_users`
```
code TEXT PK | name | role | pw_hash | is_active | sort_order | employee_id UNIQUE
```
- `employee_id`：登入帳號，舊帳號自動以 `code` 回填

### `app_settings`（重要 keys）
```
staff                      → StaffMember[] JSON
shifts                     → Shift[] JSON
rotation_pools             → RotationPool[] JSON
schedule_data_YYYYMM       → ScheduleRow[] JSON
schedule_source_YYYYMM     → "cloud" | "local" | "manual"
holidays_YYYY              → HolidayEntry[] JSON
scheduler_mobile_app_url   → Netlify 網址
booking_open               → "1" | "0"
booking_month              → "YYYYMM"
```
