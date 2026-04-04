# MedBase

> 臨床醫囑查詢 + 排班系統｜Tauri v2 + Vue 3 + SQLite

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
#   msi/MedBase_x.x.x_x64_en-US.msi
#   nsis/MedBase_x.x.x_x64-setup.exe
```

---

## 自動更新（GitHub Releases）

### 運作原理

```
推送 tag v*
  → GitHub Actions 自動 build + 簽章
  → 建立 GitHub Release，上傳安裝檔與 latest.json
  → 使用者在 App 設定頁點「檢查更新」
  → 發現新版本 → 下載 → 安裝 → 重啟
```

---

### 初次設定（只需做一次）

#### 1. 產生簽章金鑰對

```bash
npm run tauri signer generate -- -w ./src-tauri/medbase.key
```

輸出範例：
```
pubkey: dW50cnVzdGVkIGNvbW1lbnQ...（這串是公鑰）
```

> ⚠️ `medbase.key` 已加入 `.gitignore`，請勿 commit。

---

#### 2. 將公鑰填入 tauri.conf.json

```json
"plugins": {
  "updater": {
    "pubkey": "貼上上面產生的公鑰字串",
    "endpoints": [
      "https://github.com/stevedaydream/medbase/releases/latest/download/latest.json"
    ]
  }
}
```

---

#### 3. 設定 GitHub Secrets

前往 `https://github.com/stevedaydream/medbase/settings/secrets/actions`，新增：

| Secret 名稱 | 值 |
|------------|---|
| `TAURI_SIGNING_PRIVATE_KEY` | `medbase.key` 檔案的完整內容（貼上全文） |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | 產生金鑰時設定的密碼（若無則留空） |

---

### 發布新版本

#### 1. 修改版本號

`src-tauri/tauri.conf.json`：
```json
{
  "version": "0.2.0"
}
```

#### 2. Commit 並推送 tag

```bash
git add -A
git commit -m "release: v0.2.0"
git tag v0.2.0
git push origin main --tags
```

#### 3. 等待 GitHub Actions 完成

Actions 頁面：`https://github.com/stevedaydream/medbase/actions`

完成後 GitHub Release 會自動建立，包含：
- `MedBase_x.x.x_x64_en-US.msi`
- `MedBase_x.x.x_x64-setup.exe`
- `latest.json`（App 更新檢查端點）

---

### App 內更新流程（使用者端）

1. 開啟 MedBase → 排班系統 → 設定 Tab
2. 點「**檢查更新**」
3. 若有新版本，顯示版本號與「**立即更新**」按鈕
4. 點「立即更新」→ 自動下載安裝 → 重啟 App

---

## 手機端 PWA 部署（Netlify）

```bash
cd mobile
# 設定環境變數
echo "VITE_GAS_URL=https://script.google.com/macros/s/.../exec" > .env

npm run build
netlify deploy --prod --dir=dist --site=c0cf9c01-b6bc-4168-af03-d76fc853fbff
```

**站台網址：** `https://dapper-travesseiro-256d2b.netlify.app`

---

## GAS 後端更新

```bash
cd gas
clasp push --force
clasp deploy \
  --deploymentId AKfycbxORGI_XtO-2_fnWJZMvSm74Aj8pp0NfqQUhCsp-gVdDltoDFoyv0VYdiTbVEa0YwXNzw \
  --description "更新說明"
```

---

## 相關文件

| 文件 | 說明 |
|------|------|
| `project.md` | 系統架構、功能清單、已知問題 |
| `project_conventions.md` | 程式碼慣例 |
| `project_decisions.md` | 技術決策紀錄 |
| `project_api.md` | API 合約 |
| `project_bugfix.md` | Bug 修復紀錄 |
