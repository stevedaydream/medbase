@echo off
cd /d "%~dp0"
setlocal enabledelayedexpansion

:: Read current version from tauri.conf.json
set CURRENT_VER=
for /f "tokens=2 delims=:, " %%a in ('findstr "version" src-tauri\tauri.conf.json') do (
    if "!CURRENT_VER!"=="" set CURRENT_VER=%%~a
)

echo ========================================
echo   MedBase Release Tool
echo ========================================
echo.
echo Current version: %CURRENT_VER%

if "%CURRENT_VER%"=="" (
    echo ERROR: Cannot read version from src-tauri\tauri.conf.json
    pause & exit /b 1
)

set /p NEW_VER=Enter new version (e.g. 0.1.3):
if "%NEW_VER%"=="" (
    echo ERROR: Version cannot be empty
    pause & exit /b 1
)

echo.
echo Will release v%NEW_VER% ^(current: v%CURRENT_VER%^)
set /p CONFIRM=Continue? (y/N):
if /i not "%CONFIRM%"=="y" (
    echo Cancelled.
    pause & exit /b 0
)

echo.
echo [1/4] Updating version numbers...

:: Use [System.IO.File] to avoid UTF-8 BOM corruption
powershell -NoProfile -Command "$enc = New-Object System.Text.UTF8Encoding($false); $f = 'src-tauri\tauri.conf.json'; [System.IO.File]::WriteAllText($f, ([System.IO.File]::ReadAllText($f) -replace '\"version\": \"%CURRENT_VER%\"', '\"version\": \"%NEW_VER%\"'), $enc)"
if errorlevel 1 ( echo ERROR: tauri.conf.json failed & pause & exit /b 1 )

powershell -NoProfile -Command "$enc = New-Object System.Text.UTF8Encoding($false); $f = 'src-tauri\Cargo.toml'; [System.IO.File]::WriteAllText($f, ([System.IO.File]::ReadAllText($f) -replace '(?m)^version = \"%CURRENT_VER%\"', 'version = \"%NEW_VER%\"'), $enc)"
if errorlevel 1 ( echo ERROR: Cargo.toml failed & pause & exit /b 1 )

powershell -NoProfile -Command "$enc = New-Object System.Text.UTF8Encoding($false); $f = 'src\components\layout\Sidebar.vue'; [System.IO.File]::WriteAllText($f, ([System.IO.File]::ReadAllText($f) -replace 'v%CURRENT_VER%', 'v%NEW_VER%'), $enc)"
if errorlevel 1 ( echo ERROR: Sidebar.vue failed & pause & exit /b 1 )

echo   Done.

echo.
echo [2/4] Git commit...
git add src-tauri/tauri.conf.json src-tauri/Cargo.toml src/components/layout/Sidebar.vue
git commit -m "chore: bump version to %NEW_VER%"
if errorlevel 1 ( echo ERROR: git commit failed & pause & exit /b 1 )

echo.
echo [3/4] Creating tag v%NEW_VER%...
git tag v%NEW_VER%
if errorlevel 1 ( echo ERROR: tag exists? Run: git tag -d v%NEW_VER% & pause & exit /b 1 )

echo.
echo [4/4] Pushing to GitHub...
git push origin main
if errorlevel 1 ( echo ERROR: push main failed & pause & exit /b 1 )
git push origin v%NEW_VER%
if errorlevel 1 ( echo ERROR: push tag failed & pause & exit /b 1 )

echo.
echo ========================================
echo   Done! v%NEW_VER% pushed.
echo   Actions: https://github.com/stevedaydream/medbase/actions
echo ========================================
pause
exit /b 0
