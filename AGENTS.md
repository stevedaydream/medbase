# MedBase — 臨床知識庫 + 排班系統（Tauri 桌面 + 手機 PWA + GAS）

## 技術棧
- 桌機：Vue 3 `<script setup>` + TS + Tailwind v4（暗色）+ Tauri v2 + SQLite（`@tauri-apps/plugin-sql`）
- 手機：`mobile/` 獨立 Vue PWA，Vercel 部署；`mobile/api/` 為 Vercel Functions 代理 GAS
- 雲端：Google Apps Script（`gas/`，clasp）；共用程式在 `src/shared/`（`@shared`）

## 常用指令
| 用途 | 指令 |
|------|------|
| 桌機開發 | `npm run tauri dev` |
| 網頁版開發 | `npm run dev` |
| 型別檢查 + 建置 | `npm run build` |
| 測試 | `npm test`（vitest） |
| 手機建置 | `cd mobile && npm run build` |
| 發版 / 部署手機 / 部署 GAS | `release.bat`（選項 1 / 3 / 4） |

## 驗證方式
- 改 `src/`：`npm run build` + `npm test` 通過
- 改 `mobile/`：`cd mobile && npm run build` 通過
- 改 `src-tauri/`：`cd src-tauri && cargo check`
- UI 用 `npm run dev` 的網頁版檢查；Tauri 專屬功能（fs、dialog、SQL）網頁版無法執行，需回報「未在 Tauri 內實測」

## 專案禁忌
- DB 寫入必須用 `dbWrite()`，不可直接 `db.execute()`（SQLITE_BUSY，BF-006）
- 拖曳用 Pointer Events，不用 HTML5 Drag & Drop（BF-001）
- 新增資料表要在 `src/utils/backupRegistry.ts` 歸到備份群組（測試會擋，ADR-023）
- 新功能要能被 Ctrl+K 搜到：在 `src/search/providers/` 加一個檔案（測試會擋，ADR-024）
- 細節慣例見 `project_conventions.md`，待辦見 `project_pending.md`

## Git 設定
- remote：`origin` → https://github.com/stevedaydream/medbase （**公開 repo**）
- 預設分支：`main`；推送：`git push origin main`
- `release.bat` 選項 1、3 會自動推送
- 因公開 repo，只有 `AGENTS.md`、`README.md` 進 git；`project*.md` 僅存本機（`.gitignore` 的 `*.md`）

## 敏感資訊
GAS Script ID / Deployment ID、金鑰、院內帳密：見 `secret.md`（不進 git）。`data/` 含院內原始資料，永不進 git。
