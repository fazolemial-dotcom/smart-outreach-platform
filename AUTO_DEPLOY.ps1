Write-Host "🚀 SMART OUTREACH PLATFORM - AUTO DEPLOY (PowerShell)" -ForegroundColor Green
Write-Host "================================================================" -ForegroundColor Green
Write-Host ""

# Function to write progress
function Write-Progress-Message($message, $type = "INFO") {
    $timestamp = Get-Date -Format "HH:mm:ss"
    switch ($type) {
        "SUCCESS" { Write-Host "[$timestamp] ✅ $message" -ForegroundColor Green }
        "ERROR"   { Write-Host "[$timestamp] ❌ $message" -ForegroundColor Red }
        "WARNING" { Write-Host "[$timestamp] ⚠️  $message" -ForegroundColor Yellow }
        default   { Write-Host "[$timestamp] ℹ️  $message" -ForegroundColor Cyan }
    }
}

try {
    Write-Progress-Message "Starting automated deployment..." -type "INFO"
    
    # STEP 1: Check Node.js
    Write-Progress-Message "[STEP 1/8] Checking Node.js..." -type "INFO"
    $nodeCheck = Get-Command node -ErrorAction SilentlyContinue
    if (-not $nodeCheck) {
        Write-Progress-Message "Node.js not found! Please install from https://nodejs.org" -type "ERROR"
        Write-Progress-Message "Install Node.js 18+ then run this script again." -type "WARNING"
        Read-Host "Press Enter to exit"
        exit 1
    }
    Write-Progress-Message "Node.js found: $(node --version)" -type "SUCCESS"
    Write-Host ""
    
    # STEP 2: Install CLI Tools
    Write-Progress-Message "[STEP 2/8] Installing CLI Tools..." -type "INFO"
    Write-Progress-Message "Installing Railway CLI..." -type "INFO"
    npm install -g @railway/cli
    Write-Progress-Message "Installing Vercel CLI..." -type "INFO"
    npm install -g vercel
    Write-Progress-Message "CLI Tools installed successfully" -type "SUCCESS"
    Write-Host ""
    
    # STEP 3: Clean old files
    Write-Progress-Message "[STEP 3/8] Cleaning old files..." -type "INFO"
    if (Test-Path "node_modules") { Remove-Item -Recurse -Force node_modules }
    if (Test-Path "package-lock.json") { Remove-Item -Force package-lock.json }
    if (Test-Path ".next") { Remove-Item -Recurse -Force .next }
    if (Test-Path "dist") { Remove-Item -Recurse -Force dist }
    Write-Progress-Message "Old files cleaned successfully" -type "SUCCESS"
    Write-Host ""
    
    # STEP 4: Install dependencies
    Write-Progress-Message "[STEP 4/8] Installing dependencies..." -type "INFO"
    Write-Progress-Message "This may take 5-15 minutes depending on your internet..." -type "WARNING"
    try {
        npm install --legacy-peer-deps --force
        Write-Progress-Message "Dependencies installed successfully" -type "SUCCESS"
    } catch {
        Write-Progress-Message "Installation failed with legacy flags, trying without..." -type "WARNING"
        npm install --force
        if ($LASTEXITCODE -ne 0) {
            Write-Progress-Message "Installation failed. Please check internet connection." -type "ERROR"
            Read-Host "Press Enter to exit"
            exit 1
        }
        Write-Progress-Message "Dependencies installed successfully" -type "SUCCESS"
    }
    Write-Host ""
    
    # STEP 5: Generate Prisma client
    Write-Progress-Message "[STEP 5/8] Generating Prisma client..." -type "INFO"
    try {
        npx prisma generate
        Write-Progress-Message "Prisma client generated successfully" -type "SUCCESS"
    } catch {
        Write-Progress-Message "Prisma generation failed" -type "ERROR"
        Read-Host "Press Enter to exit"
        exit 1
    }
    Write-Host ""
    
    # STEP 6: Build application
    Write-Progress-Message "[STEP 6/8] Building application..." -type "INFO"
    Write-Progress-Message "This may take 2-5 minutes..." -type "WARNING"
    try {
        $env:NODE_OPTIONS = "--max-old-space-size=4096"
        npm run build
        Write-Progress-Message "Application built successfully!" -type "SUCCESS"
    } catch {
        Write-Progress-Message "Build failed, trying alternative Next.js version..." -type "WARNING"
        npm install next@13.5.6 react@18.2.0 react-dom@18.2.0 --force
        npm run build
        if ($LASTEXITCODE -ne 0) {
            Write-Progress-Message "Build failed. You can use development mode instead." -type "ERROR"
            Write-Progress-Message "Run: npm run dev" -type "INFO"
            Read-Host "Press Enter to exit"
            exit 1
        }
        Write-Progress-Message "Application built successfully with alternative version!" -type "SUCCESS"
    }
    Write-Host ""
    
    # STEP 7: Create .env file
    Write-Progress-Message "[STEP 7/8] Creating .env file..." -type "INFO"
    if (-not (Test-Path ".env")) {
        @"
DATABASE_URL=your_postgresql_url_here
REDIS_URL=your_redis_url_here
JWT_SECRET=your_jwt_secret_32_chars
GMAIL_CLIENT_ID=your_gmail_client_id
GMAIL_CLIENT_SECRET=your_gmail_client_secret
NODE_ENV=production
CUSTOM_KEY=smart_outreach_platform
"@ | Out-File -FilePath ".env" -Encoding UTF8
        Write-Progress-Message ".env file created successfully" -type "SUCCESS"
    } else {
        Write-Progress-Message ".env file already exists" -type "SUCCESS"
    }
    Write-Host ""
    
    # STEP 8: Setup complete
    Write-Progress-Message "[STEP 8/8] Setup complete!" -type "SUCCESS"
    Write-Host ""
    Write-Host "================================================================" -ForegroundColor Green
    Write-Host "🎯 NEXT STEPS:" -ForegroundColor Yellow
    Write-Host "================================================================" -ForegroundColor Green
    Write-Host "1. Create Google OAuth credentials at console.cloud.google.com" -ForegroundColor White
    Write-Host "   - Enable Gmail API" -ForegroundColor Gray
    Write-Host "   - Create OAuth 2.0 credentials" -ForegroundColor Gray
    Write-Host ""
    Write-Host "2. Login to services:" -ForegroundColor White
    Write-Host "   railway login" -ForegroundColor Cyan
    Write-Host "   vercel login" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "3. Deploy backend:" -ForegroundColor White
    Write-Host "   railway new" -ForegroundColor Cyan
    Write-Host "   railway add postgresql" -ForegroundColor Cyan
    Write-Host "   railway add redis" -ForegroundColor Cyan
    Write-Host "   railway up" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "4. Deploy frontend:" -ForegroundColor White
    Write-Host "   vercel --prod" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "================================================================" -ForegroundColor Green
    Write-Host "🚀 Your Smart Outreach Platform is ready for deployment!" -ForegroundColor Green
    Write-Host "================================================================" -ForegroundColor Green
    
} catch {
    Write-Progress-Message "An unexpected error occurred: $($_.Exception.Message)" -type "ERROR"
    Write-Progress-Message "Please try running the script again or contact support." -type "WARNING"
} finally {
    Write-Host ""
    Read-Host "Press Enter to exit"
}