@echo off
cd /d "%~dp0"
setlocal enabledelayedexpansion

:: ============================================================
:MENU
:: Re-read version each loop (version may have changed)
set CURRENT_VER=
for /f "tokens=2 delims=:, " %%a in ('findstr "version" src-tauri\tauri.conf.json') do (
    if "!CURRENT_VER!"=="" set CURRENT_VER=%%~a
)

cls
echo ========================================
echo   MedBase Release Tool
echo ========================================
echo.
echo Current version: %CURRENT_VER%

if "%CURRENT_VER%"=="" (
    echo ERROR: Cannot read version from src-tauri\tauri.conf.json
    pause & exit /b 1
)

echo.
echo [1] New release  (bump version, commit, tag, push)
echo [2] Re-push tag  (delete + recreate tag to retrigger Actions)
echo [3] Deploy mobile to Netlify
echo [4] Deploy GAS   (clasp push)
echo [5] Exit
echo.
set /p MODE=Choose (1/2/3/4/5):
if "%MODE%"=="1" goto NEW_RELEASE
if "%MODE%"=="2" goto REPUSH
if "%MODE%"=="3" goto NETLIFY
if "%MODE%"=="4" goto GAS
if "%MODE%"=="5" goto EXIT
echo Invalid choice, try again.
pause
goto MENU

:: ============================================================
:: --- NEW RELEASE ---
:NEW_RELEASE
set /p NEW_VER=Enter new version (e.g. 0.1.3):
if "%NEW_VER%"=="" (
    echo ERROR: Version cannot be empty
    pause & goto MENU
)

echo.
echo Will release v%NEW_VER% ^(current: v%CURRENT_VER%^)
set /p CONFIRM=Continue? (y/N):
if /i not "%CONFIRM%"=="y" (
    echo Cancelled.
    pause & goto MENU
)

echo.
echo [1/4] Updating version numbers...

:: Use [System.IO.File] to avoid UTF-8 BOM corruption
powershell -NoProfile -Command "$enc = New-Object System.Text.UTF8Encoding($false); $f = 'package.json'; [System.IO.File]::WriteAllText($f, ([System.IO.File]::ReadAllText($f) -replace '\"version\": \"%CURRENT_VER%\"', '\"version\": \"%NEW_VER%\"'), $enc)"
if errorlevel 1 ( echo ERROR: package.json failed & pause & goto MENU )

powershell -NoProfile -Command "$enc = New-Object System.Text.UTF8Encoding($false); $f = 'src-tauri\tauri.conf.json'; [System.IO.File]::WriteAllText($f, ([System.IO.File]::ReadAllText($f) -replace '\"version\": \"%CURRENT_VER%\"', '\"version\": \"%NEW_VER%\"'), $enc)"
if errorlevel 1 ( echo ERROR: tauri.conf.json failed & pause & goto MENU )

powershell -NoProfile -Command "$enc = New-Object System.Text.UTF8Encoding($false); $f = 'src-tauri\Cargo.toml'; [System.IO.File]::WriteAllText($f, ([System.IO.File]::ReadAllText($f) -replace '(?m)^version = \"%CURRENT_VER%\"', 'version = \"%NEW_VER%\"'), $enc)"
if errorlevel 1 ( echo ERROR: Cargo.toml failed & pause & goto MENU )

powershell -NoProfile -Command "$enc = New-Object System.Text.UTF8Encoding($false); $f = 'src\components\layout\Sidebar.vue'; [System.IO.File]::WriteAllText($f, ([System.IO.File]::ReadAllText($f) -replace 'v%CURRENT_VER%', 'v%NEW_VER%'), $enc)"
if errorlevel 1 ( echo ERROR: Sidebar.vue failed & pause & goto MENU )

echo   Done.

echo.
echo [2/4] Git commit...
git add package.json src-tauri/tauri.conf.json src-tauri/Cargo.toml src/components/layout/Sidebar.vue
:: Note: SettingView.vue reads version dynamically via getVersion() - no manual update needed
git commit -m "chore: bump version to %NEW_VER%"
if errorlevel 1 ( echo ERROR: git commit failed & pause & goto MENU )

echo.
echo [3/4] Creating tag v%NEW_VER%...
git tag v%NEW_VER%
if errorlevel 1 ( echo ERROR: tag exists? Run: git tag -d v%NEW_VER% & pause & goto MENU )

echo.
echo [4/4] Pushing to GitHub...
git push origin main
if errorlevel 1 ( echo ERROR: push main failed & pause & goto MENU )
git push origin v%NEW_VER%
if errorlevel 1 ( echo ERROR: push tag failed & pause & goto MENU )

echo.
echo ========================================
echo   Done! v%NEW_VER% pushed.
echo   Actions: https://github.com/stevedaydream/medbase/actions
echo ========================================
pause
goto MENU

:: ============================================================
:: --- NETLIFY DEPLOY ---
:NETLIFY
echo.
echo ========================================
echo   Deploy mobile to Netlify
echo ========================================
echo.
echo [1/2] Building mobile...
cd /d "%~dp0mobile"
call npm run build
if errorlevel 1 ( echo ERROR: build failed & cd /d "%~dp0" & pause & goto MENU )

echo.
echo [2/2] Deploying to Netlify (production)...
call netlify deploy --prod --dir=dist --site=c0cf9c01-b6bc-4168-af03-d76fc853fbff
if errorlevel 1 ( echo ERROR: netlify deploy failed & cd /d "%~dp0" & pause & goto MENU )

cd /d "%~dp0"
echo.
echo ========================================
echo   Done! https://dapper-travesseiro-256d2b.netlify.app
echo ========================================
pause
goto MENU

:: ============================================================
:: --- GAS DEPLOY ---
:GAS
echo.
echo ========================================
echo   Deploy GAS (clasp push + deploy)
echo ========================================
echo.
cd /d "%~dp0gas"

echo [1/2] Pushing code...
call clasp push
if errorlevel 1 ( echo ERROR: clasp push failed & cd /d "%~dp0" & pause & goto MENU )

echo.
echo [2/2] Updating Web App deployment...
call clasp deploy --deploymentId AKfycbxORGI_XtO-2_fnWJZMvSm74Aj8pp0NfqQUhCsp-gVdDltoDFoyv0VYdiTbVEa0YwXNzw --description "update"
if errorlevel 1 ( echo ERROR: clasp deploy failed & cd /d "%~dp0" & pause & goto MENU )

cd /d "%~dp0"
echo.
echo ========================================
echo   Done! GAS deployed.
echo   Script: https://script.google.com/d/1wHwoBoh_HrhrliBnTW4AvDZK1AVlIv2zATthbAogiIgcDDqRUZB9sC8f/edit
echo ========================================
pause
goto MENU

:: ============================================================
:: --- RE-PUSH ---
:REPUSH
echo.
set /p REPUSH_VER=Tag to re-push (leave blank for current v%CURRENT_VER%):
if "%REPUSH_VER%"=="" set REPUSH_VER=%CURRENT_VER%

echo.
echo Will delete and re-push tag v%REPUSH_VER%
set /p CONFIRM2=Continue? (y/N):
if /i not "%CONFIRM2%"=="y" ( echo Cancelled. & pause & goto MENU )

echo.
echo [1/3] Deleting local tag v%REPUSH_VER%...
git tag -d v%REPUSH_VER%
if errorlevel 1 ( echo WARNING: local tag not found, continuing... )

echo.
echo [2/3] Deleting remote tag v%REPUSH_VER%...
git push origin --delete v%REPUSH_VER%
if errorlevel 1 ( echo WARNING: remote tag not found, continuing... )

echo.
echo [3/3] Creating and pushing tag v%REPUSH_VER%...
git tag v%REPUSH_VER%
if errorlevel 1 ( echo ERROR: failed to create tag & pause & goto MENU )
git push origin v%REPUSH_VER%
if errorlevel 1 ( echo ERROR: push tag failed & pause & goto MENU )

echo.
echo ========================================
echo   Done! v%REPUSH_VER% re-pushed.
echo   Actions: https://github.com/stevedaydream/medbase/actions
echo ========================================
pause
goto MENU

:: ============================================================
:EXIT
echo Bye.
exit /b 0
