# 技術決策紀錄（Architecture Decision Records）

> **模板說明：** 記錄「為什麼這樣做」，防止未來重複討論已決定的事。
> 每筆格式：背景 → 決策 → 理由 → 被否決的替代方案。

---

## ADR-001　手機端採用獨立 Netlify Vue PWA，而非 GAS HTML

**背景：** 排班系統需要讓員工用手機查看班表、提交預約。
**決策：** 手機端獨立為 `mobile/` Vue 3 專案，部署於 Netlify。
**理由：**
- GAS HTML Service 有嚴格的 CORS 限制，fetch 到外部 API 需要複雜的 workaround
- Vue 元件化開發體驗遠優於 GAS HTML 模板
- Netlify 免費方案足夠使用，CI/CD 自動化

**否決方案：**
- GAS `HtmlService`：CORS 問題難以解決，且 UI 開發體驗差
- 整合進桌機 Tauri App：員工不一定有桌機，手機優先

---

## ADR-002　員工名單存於 `app_settings` JSON，而非獨立 table

**背景：** 需要在本地儲存排班員工清單。
**決策：** 員工清單序列化為 JSON，存入 `app_settings` 表的 `staff` key。
**理由：**
- 排班員工清單為「整批讀寫」操作，不需要逐筆查詢
- 初期開發速度優先，避免過度設計
- 雲端同步以整批上傳為主，JSON 格式天然契合

**否決方案：**
- 獨立 `scheduler_staff` table：增加 JOIN 複雜度，且不帶來實質查詢效益
- 未來若需要逐筆查詢（如搜尋、統計），再考慮遷移

---

## ADR-003　密碼雜湊使用 SHA-256，而非 bcrypt

**背景：** 員工帳號密碼需要雜湊儲存。
**決策：** 使用瀏覽器原生 Web Crypto API 實作 SHA-256（`src/utils/sha256.ts`）。
**理由：**
- Tauri v2 WASM 環境對 Node.js crypto 套件支援受限
- bcrypt 在此環境無法直接使用
- 系統為院內區域網路使用，風險等級可接受

**否決方案：**
- bcrypt：WASM 環境限制，目前無法使用（列為技術債 #3）
- argon2：同上

**已知風險：** SHA-256 無 salt，為已知技術債（`project.md` Section 7 #3）。

---

## ADR-004　雲端層使用 Google Apps Script，而非自建後端

**背景：** 需要雲端儲存班表、員工資料，並支援手機端讀取。
**決策：** 以 GAS Web App 作為唯一雲端後端（`gas/scheduler.gs`）。
**理由：**
- 院內環境不便架設外部伺服器
- Google Workspace 為院內現有工具，無額外費用
- GAS 部署簡單，維護成本低
- Google Sheets 同時作為可視化的資料檢視介面

**否決方案：**
- Firebase：需要額外帳號管理與費用
- Supabase / PlanetScale：需要外部網路，院內環境不穩定

---

## ADR-005　狀態管理使用 Composables，而非 Pinia

**背景：** 需要管理排班系統的複雜狀態（員工、班別、班表、輪序等）。
**決策：** 主要業務邏輯拆為 Composables（`useShifts.ts`、`useStaff.ts`），不引入 Pinia。
**理由：**
- 各 composable 職責明確，依賴關係清楚
- 狀態主要集中在 `SchedulerView.vue`，不需要跨頁面共享
- 減少全域狀態帶來的隱性耦合

**否決方案：**
- 全 Pinia store：過度設計，跨頁狀態共享需求不多
- 全部塞在單一 View：已遇到此問題（`SchedulerView.vue` 過大），已拆分

---

## ADR-006　登入識別碼由「代號」改為「員工編號」

**背景：** 原始設計以員工代號（`code`，如 `A01`）作為登入帳號，但代號主要用於班表顯示，使用者對「員工編號」概念更熟悉。
**決策：** 新增 `employee_id` 欄位至 `scheduler_users`，改以員工編號登入。`code` 保留用於班表識別。
**理由：**
- 員工編號為院內通用識別碼，員工更易記憶
- `code` 與 `employee_id` 職責分離，語意更清晰
- 向下相容：舊帳號自動以 `code` 值回填 `employee_id`
