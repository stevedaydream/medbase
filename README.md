# MedBase

> 臨床醫囑查詢 + 排班系統｜Tauri v2 + Vue 3 + SQLite

---

## 功能概覽

| 模組 | 說明 |
|------|------|
| 自費耗材 | 品項查詢、套組管理、科別篩選 |
| 醫師通訊錄 | 帳密查詢複製、雲端同步（GAS） |
| 常用分機 | 分機快查、分類管理 |
| 排班系統 | 班表編輯、人員管理、3 志願預約（手機 PWA） |
| 臨床知識庫 | 藥物、處方、術式、疾病、檢查 |
| 危急情境 | ACLS / 急救流程卡 |
| 資料管理 | 選擇性 XLSX 備份/還原、整體 DB 備份/還原 |

---

## 開發環境

```bash
npm install
npm run tauri dev
```

## 打包

```bash
npm run tauri build
# 輸出：src-tauri/target/release/bundle/
#   nsis/MedBase_x.x.x_x64-setup.exe
#   msi/MedBase_x.x.x_x64_en-US.msi
```

---

## 發布新版本

執行專案根目錄的 `release.bat`，選擇 **[1] New release**：

```
[1] New release  (bump version, commit, tag, push)
[2] Re-push tag  (delete + recreate tag to retrigger Actions)
```

腳本會自動：
1. 更新 `tauri.conf.json`、`package.json`、`Cargo.toml` 版本號
2. Git commit + tag + push
3. 觸發 GitHub Actions 自動 build 並建立 Release

> Actions 頁面：`https://github.com/stevedaydream/medbase/actions`

完成後 Release Assets 包含：
- `MedBase_x.x.x_x64-setup.exe`
- `MedBase_x.x.x_x64_en-US.msi`
- `latest.json`（自動更新端點）

---

## 自動更新設定（初次或換機時）

### 1. 產生簽章金鑰對

```bash
npx tauri signer generate -w medbase.key
```

產生的 `medbase.key.pub` 內容填入 `src-tauri/tauri.conf.json`：

```json
"plugins": {
  "updater": {
    "pubkey": "（貼上 .pub 檔案內容）",
    "endpoints": [
      "https://github.com/stevedaydream/medbase/releases/latest/download/latest.json"
    ]
  }
}
```

> ⚠️ `medbase.key` 已加入 `.gitignore`，請勿 commit。

### 2. 設定 GitHub Secrets

前往 `Settings → Secrets → Actions`，新增：

| Secret | 值 |
|--------|---|
| `TAURI_SIGNING_PRIVATE_KEY` | `medbase.key` 檔案的完整內容 |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | 金鑰密碼（無密碼請刪除此 Secret） |

### 3. App 內更新流程

設定頁 → 點「**檢查更新**」→ 發現新版本 → 「**立即更新**」→ 自動下載安裝 → 重啟

---

## 資料備份與遷移

所有資料儲存於單一 SQLite 檔案：

```
%APPDATA%\com.medbase.app\medbase.db
```

### 整體備份（推薦）

資料管理頁 → **備份 / 還原** → **備份 DB 檔 / 還原 DB 檔**

單一 `.db` 檔包含全部資料與設定，適合搬機或重裝時使用。還原後 App 自動重新啟動。

### 選擇性備份（XLSX）

資料管理頁 → 勾選備份群組 → **備份選取項目 (XLSX)**

每個 Sheet 對應一張資料表，可用 Excel 瀏覽與編輯。

---

## 手機端 PWA 部署（Netlify）

```bash
cd mobile
echo "VITE_GAS_URL=https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec" > .env
npm run build
netlify deploy --prod --dir=dist
```

---

## GAS 後端更新

```bash
cd gas
clasp push --force
clasp deploy --deploymentId YOUR_DEPLOYMENT_ID --description "更新說明"
```

---

## 開發輔助

| 快速鍵 | 功能 |
|--------|------|
| `Ctrl+K` | 全域搜尋（Omnibar） |
| `Ctrl+Shift+D` | Debug 日誌面板（開發/除錯用） |

---

## 相關文件

| 文件 | 說明 |
|------|------|
| `project.md` | 系統架構、功能清單、已知問題 |
| `project_conventions.md` | 程式碼慣例 |
| `project_decisions.md` | 技術決策紀錄 |
| `project_api.md` | API 合約 |
| `project_bugfix.md` | Bug 修復紀錄 |
