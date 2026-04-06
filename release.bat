@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul

echo ========================================
echo   MedBase Release Tool
echo ========================================
echo.

:: ── 取得目前版本（從 tauri.conf.json）──────────────────────────────
for /f "tokens=2 delims=:, " %%a in ('findstr /i "\"version\"" src-tauri\tauri.conf.json') do (
    set CURRENT_VER=%%~a
    goto :got_ver
)
:got_ver

echo 目前版本：%CURRENT_VER%
echo.
set /p NEW_VER=輸入新版本號（例如 0.1.3）：

if "%NEW_VER%"=="" (
    echo 錯誤：版本號不能為空
    pause & exit /b 1
)

echo.
echo 即將發布 v%NEW_VER%，將執行以下步驟：
echo   1. 更新 tauri.conf.json / Cargo.toml / Sidebar.vue 版本號
echo   2. git add + commit
echo   3. git tag v%NEW_VER%
echo   4. git push origin main + tag
echo.
set /p CONFIRM=確認繼續？(y/N)：
if /i not "%CONFIRM%"=="y" (
    echo 已取消。
    pause & exit /b 0
)

echo.
echo [1/4] 更新版本號...

:: tauri.conf.json
powershell -Command "(Get-Content 'src-tauri\tauri.conf.json' -Raw) -replace '\"version\": \"%CURRENT_VER%\"', '\"version\": \"%NEW_VER%\"' | Set-Content 'src-tauri\tauri.conf.json' -NoNewline"
if errorlevel 1 goto :err

:: Cargo.toml（只換第一個 version = "..." 避免相依套件版本被誤改）
powershell -Command "$content = Get-Content 'src-tauri\Cargo.toml' -Raw; $content = $content -replace '^version = \"[^\"]+\"', 'version = \"%NEW_VER%\"'; Set-Content 'src-tauri\Cargo.toml' $content -NoNewline"
if errorlevel 1 goto :err

:: Sidebar.vue（hardcode 版本字串）
powershell -Command "(Get-Content 'src\components\layout\Sidebar.vue' -Raw) -replace 'v%CURRENT_VER%', 'v%NEW_VER%' | Set-Content 'src\components\layout\Sidebar.vue' -NoNewline"
if errorlevel 1 goto :err

echo   完成。

echo.
echo [2/4] Git commit...
git add src-tauri/tauri.conf.json src-tauri/Cargo.toml src/components/layout/Sidebar.vue
git commit -m "chore: bump version to %NEW_VER%"
if errorlevel 1 goto :err

echo.
echo [3/4] 建立 tag v%NEW_VER%...
git tag v%NEW_VER%
if errorlevel 1 (
    echo 錯誤：tag 可能已存在，請先執行：git tag -d v%NEW_VER%
    goto :err
)

echo.
echo [4/4] 推送到 GitHub...
git push origin main
if errorlevel 1 goto :err
git push origin v%NEW_VER%
if errorlevel 1 goto :err

echo.
echo ========================================
echo   成功！v%NEW_VER% 已推送
echo   GitHub Actions 正在 Build 中...
echo   前往 Actions 頁面查看進度：
echo   https://github.com/stevedaydream/medbase/actions
echo ========================================
echo.
pause
exit /b 0

:err
echo.
echo ========================================
echo   發生錯誤，請檢查上方訊息
echo ========================================
pause
exit /b 1
