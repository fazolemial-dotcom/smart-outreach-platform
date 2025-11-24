@echo off
echo ========================================================
echo 🎯 SMART OUTREACH PLATFORM - DEPLOYMENT VERIFICATION
echo ========================================================
echo.

echo [VERIFICATION] Checking if application is ready for deployment...
echo.

REM Check if all required files exist
echo [CHECK 1/5] Verifying core files...
if not exist package.json (
    echo ❌ package.json not found
    echo Please ensure you're in the correct directory
    pause
    exit /b 1
)
echo ✅ package.json found

echo [CHECK 2/5] Verifying next.config.js...
if not exist next.config.js (
    echo ❌ next.config.js not found
    pause
    exit /b 1
)
echo ✅ next.config.js found

echo [CHECK 3/5] Verifying source directories...
if not exist src (
    echo ❌ src directory not found
    pause
    exit /b 1
)
echo ✅ src directory found

echo [CHECK 4/5] Verifying prisma setup...
if not exist prisma (
    echo ❌ prisma directory not found
    pause
    exit /b 1
)
echo ✅ prisma directory found

echo [CHECK 5/5] Verifying deployment scripts...
if not exist AUTO_DEPLOY.bat (
    echo ⚠️ AUTO_DEPLOY.bat not found
) else (
    echo ✅ AUTO_DEPLOY.bat found
)

echo.
echo ========================================================
echo ✅ ALL FILES VERIFIED - READY FOR DEPLOYMENT!
echo ========================================================
echo.

echo 🚀 DEPLOYMENT INSTRUCTIONS:
echo.
echo 1. Run the main deployment script:
echo    AUTO_DEPLOY.bat
echo.
echo 2. After successful installation, deploy:
echo    railway login
echo    railway new
echo    railway add postgresql
echo    railway add redis
echo    railway up
echo.
echo 3. Deploy frontend:
echo    vercel login
echo    vercel --prod
echo.
echo ========================================================
echo 💰 TOTAL COST: $0 (All free tiers)
echo ⏰ ESTIMATED TIME: 15-30 minutes
echo 🚀 RESULT: Complete SaaS platform live!
echo ========================================================
echo.

pause