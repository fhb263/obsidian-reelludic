@echo off
cd /d "%~dp0"

echo ============================================
echo  ReelLudic Build
echo ============================================
echo.

call npm run build
if errorlevel 1 (
    echo [FAIL] Build failed
    pause
    exit /b 1
)

:: Copy output to build folder
if not exist "%~dp0build" mkdir "%~dp0build"
copy /y "%~dp0main.js" "%~dp0build\main.js" >nul
copy /y "%~dp0styles.css" "%~dp0build\styles.css" >nul
copy /y "%~dp0manifest.json" "%~dp0build\manifest.json" >nul

echo.
echo [OK] Output:
echo   build\main.js
echo   build\styles.css
echo   build\manifest.json
echo.
echo Copy these 3 files to your Obsidian plugin folder manually.
echo.
pause
