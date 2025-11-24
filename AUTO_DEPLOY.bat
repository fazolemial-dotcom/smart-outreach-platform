@echo off
echo ================================================
echo 🚀 SMART OUTREACH PLATFORM - AUTO DEPLOY
echo ================================================
echo.

echo [STEP 1/8] Checking Node.js...
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo ❌ Node.js not found! Please install from https://nodejs.org
    echo Install Node.js 18+ then run this script again.
    pause
    exit /b 1
)
echo ✅ Node.js found
node --version
echo.

echo [STEP 2/8] Installing CLI Tools...
echo Installing Railway CLI...
npm install -g @railway/cli
echo Installing Vercel CLI...
npm install -g vercel
echo ✅ CLI Tools installed
echo.

echo [STEP 3/8] Cleaning old files...
if exist node_modules rmdir /s /q node_modules
if exist package-lock.json del package-lock.json
if exist .next rmdir /s /q .next
if exist dist rmdir /s /q dist
echo ✅ Old files cleaned
echo.

echo [STEP 4/8] Installing dependencies...
echo This may take 5-15 minutes...
npm install --legacy-peer-deps --force
if %errorlevel% neq 0 (
    echo ❌ Failed to install dependencies
    echo Trying with different approach...
    npm install --force
    if %errorlevel% neq 0 (
        echo ❌ Installation failed. Please check internet connection.
        pause
        exit /b 1
    )
)
echo ✅ Dependencies installed
echo.

echo [STEP 5/8] Generating Prisma client...
npx prisma generate
if %errorlevel% neq 0 (
    echo ❌ Prisma generation failed
    pause
    exit /b 1
)
echo ✅ Prisma client generated
echo.

echo [STEP 6/8] Building application...
echo This may take 2-5 minutes...
set NODE_OPTIONS=--max-old-space-size=4096
npm run build
if %errorlevel% neq 0 (
    echo ❌ Build failed
    echo Trying development mode...
    echo npm install next@13.5.6 react@18.2.0 react-dom@18.2.0 --force
    npm install next@13.5.6 react@18.2.0 react-dom@18.2.0 --force
    npm run build
    if %errorlevel% neq 0 (
        echo ❌ Build still failed. You can use dev mode instead.
        echo Run: npm run dev
        pause
        exit /b 1
    )
)
echo ✅ Application built successfully!
echo.

echo [STEP 7/8] Creating .env file...
if not exist .env (
    echo DATABASE_URL=your_postgresql_url_here > .env
    echo REDIS_URL=your_redis_url_here >> .env
    echo JWT_SECRET=your_jwt_secret_32_chars >> .env
    echo GMAIL_CLIENT_ID=your_gmail_client_id >> .env
    echo GMAIL_CLIENT_SECRET=your_gmail_client_secret >> .env
    echo NODE_ENV=production >> .env
    echo CUSTOM_KEY=smart_outreach_platform >> .env
    echo ✅ .env file created
) else (
    echo ✅ .env file already exists
)
echo.

echo [STEP 8/8] Setup complete! 
echo ================================================
echo ✅ ALL STEPS COMPLETED SUCCESSFULLY!
echo ================================================
echo.
echo 🎯 NEXT STEPS:
echo 1. Create Google OAuth credentials at console.cloud.google.com
echo 2. Login to services:
echo    railway login
echo    vercel login
echo 3. Deploy backend:
echo    railway new
echo    railway add postgresql  
echo    railway add redis
echo    railway up
echo 4. Deploy frontend:
echo    vercel --prod
echo.
echo 🚀 Your Smart Outreach Platform is ready for deployment!
echo.
pause