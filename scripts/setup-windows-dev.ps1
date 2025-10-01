# PowerShell script for complete Windows development environment setup
# Sets up RaceTagger Desktop for Windows development and building

param(
    [Parameter()]
    [ValidateSet("x64", "arm64", "both")]
    [string]$Architecture = "both",
    
    [Parameter()]
    [switch]$SkipImageMagick,
    
    [Parameter()]
    [switch]$SkipNodeModules,
    
    [Parameter()]
    [switch]$Force
)

$ErrorActionPreference = "Stop"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "   RaceTagger Windows Development Setup" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Colors for different message types
$Colors = @{
    Success = "Green"
    Warning = "Yellow"
    Error = "Red"
    Info = "Cyan"
    Step = "Magenta"
}

function Write-Step($message) {
    Write-Host "➤ $message" -ForegroundColor $Colors.Step
}

function Write-Success($message) {
    Write-Host "✓ $message" -ForegroundColor $Colors.Success
}

function Write-Warning($message) {
    Write-Host "⚠ $message" -ForegroundColor $Colors.Warning
}

function Write-Info($message) {
    Write-Host "ℹ $message" -ForegroundColor $Colors.Info
}

function Test-Command($command) {
    try {
        Get-Command $command -ErrorAction Stop | Out-Null
        return $true
    }
    catch {
        return $false
    }
}

function Test-NodeVersion() {
    try {
        $nodeVersion = node --version 2>$null
        if ($nodeVersion -match "v(\d+)\.") {
            $majorVersion = [int]$matches[1]
            return $majorVersion -ge 16
        }
        return $false
    }
    catch {
        return $false
    }
}

# 1. System Requirements Check
Write-Step "Checking system requirements..."

# Check Node.js
if (-not (Test-Command "node")) {
    Write-Warning "Node.js not found. Please install Node.js 16+ from https://nodejs.org/"
    Write-Info "Recommended: Node.js LTS version"
    exit 1
}

if (-not (Test-NodeVersion)) {
    Write-Warning "Node.js version is too old. Please update to Node.js 16+"
    exit 1
}

$nodeVersion = node --version
Write-Success "Node.js $nodeVersion detected"

# Check npm
if (-not (Test-Command "npm")) {
    Write-Warning "npm not found. Please ensure npm is installed with Node.js"
    exit 1
}

$npmVersion = npm --version
Write-Success "npm $npmVersion detected"

# Check Python (for node-gyp)
if (-not (Test-Command "python")) {
    Write-Warning "Python not found. Installing Python is recommended for native module compilation"
    Write-Info "You can install Python from: https://www.python.org/downloads/"
}
else {
    $pythonVersion = python --version 2>$null
    Write-Success "Python $pythonVersion detected"
}

# Check Visual Studio Build Tools
$vsWhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
if (Test-Path $vsWhere) {
    $vsInstalls = & $vsWhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64
    if ($vsInstalls) {
        Write-Success "Visual Studio Build Tools detected"
    }
    else {
        Write-Warning "Visual Studio Build Tools not found. Some native modules may fail to compile"
        Write-Info "Install from: https://visualstudio.microsoft.com/visual-cpp-build-tools/"
    }
}

# 2. Project Dependencies
Write-Step "Installing project dependencies..."

if (-not $SkipNodeModules) {
    Write-Info "Running npm install..."
    try {
        npm install
        Write-Success "Dependencies installed successfully"
    }
    catch {
        Write-Error "Failed to install dependencies: $($_.Exception.Message)"
        exit 1
    }
}
else {
    Write-Info "Skipping npm install (--SkipNodeModules specified)"
}

# 3. Native Module Rebuilding
Write-Step "Rebuilding native modules for Electron..."

try {
    Write-Info "Rebuilding Sharp.js for Electron..."
    npm run rebuild:sharp
    Write-Success "Sharp.js rebuilt successfully"
}
catch {
    Write-Warning "Sharp.js rebuild failed. This may cause image processing issues."
    Write-Info "Try running: npm run rebuild:debug"
}

try {
    Write-Info "Rebuilding all native modules..."
    npm run rebuild
    Write-Success "Native modules rebuilt successfully"
}
catch {
    Write-Warning "Some native modules failed to rebuild. Check the output above for details."
}

# 4. Vendor Directory Setup
Write-Step "Setting up vendor directory structure..."

$VendorDirs = @(
    "vendor\win32\x64",
    "vendor\win32\arm64",
    "vendor\win32\x64\imagemagick",
    "vendor\win32\arm64\imagemagick"
)

foreach ($dir in $VendorDirs) {
    if (-not (Test-Path $dir)) {
        New-Item -ItemType Directory -Path $dir -Force | Out-Null
        Write-Success "Created directory: $dir"
    }
}

# 5. ImageMagick Setup
if (-not $SkipImageMagick) {
    Write-Step "Setting up ImageMagick portable..."
    
    $imageMagickScript = "scripts\setup-imagemagick-windows.ps1"
    if (Test-Path $imageMagickScript) {
        try {
            $params = @{
                Architecture = $Architecture
            }
            if ($Force) { $params.Force = $true }
            
            & $imageMagickScript @params
            Write-Success "ImageMagick setup completed"
        }
        catch {
            Write-Warning "ImageMagick setup failed: $($_.Exception.Message)"
            Write-Info "You can run the setup manually later: .\scripts\setup-imagemagick-windows.ps1"
        }
    }
    else {
        Write-Warning "ImageMagick setup script not found at $imageMagickScript"
    }
}
else {
    Write-Info "Skipping ImageMagick setup (--SkipImageMagick specified)"
}

# 6. TypeScript Compilation
Write-Step "Compiling TypeScript..."

try {
    npm run compile
    Write-Success "TypeScript compiled successfully"
}
catch {
    Write-Warning "TypeScript compilation failed. Check for syntax errors."
    Write-Info "Try running: npm run compile"
}

# 7. Development Environment Test
Write-Step "Testing development environment..."

try {
    Write-Info "Testing Electron startup..."
    $electronTest = Start-Process -FilePath "npm" -ArgumentList "start" -NoNewWindow -PassThru
    Start-Sleep -Seconds 3
    
    if (-not $electronTest.HasExited) {
        $electronTest.Kill()
        Write-Success "Electron test passed"
    }
    else {
        Write-Warning "Electron failed to start properly"
    }
}
catch {
    Write-Warning "Could not test Electron startup: $($_.Exception.Message)"
}

# 8. Build Test (optional)
Write-Step "Testing Windows build process..."

try {
    Write-Info "Testing build configuration..."
    # Just validate the configuration without actually building
    $buildConfig = Get-Content "package.json" | ConvertFrom-Json
    if ($buildConfig.build.win) {
        Write-Success "Windows build configuration found"
        
        if ($buildConfig.build.win.target) {
            $targets = $buildConfig.build.win.target
            Write-Info "Configured targets: $($targets | ForEach-Object { $_.target } | Join-String ', ')"
            Write-Info "Configured architectures: $($targets | ForEach-Object { $_.arch -join ', ' } | Join-String ', ')"
        }
    }
    else {
        Write-Warning "Windows build configuration not found in package.json"
    }
}
catch {
    Write-Warning "Could not validate build configuration: $($_.Exception.Message)"
}

# 9. Summary and Next Steps
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "          Setup Complete!" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

Write-Success "Windows development environment setup completed successfully!"
Write-Host ""

Write-Host "Next Steps:" -ForegroundColor $Colors.Info
Write-Host "1. Start development server: npm run dev" -ForegroundColor White
Write-Host "2. Build for Windows x64:    npm run build -- --win --x64" -ForegroundColor White
Write-Host "3. Build for Windows ARM64:  npm run build -- --win --arm64" -ForegroundColor White
Write-Host "4. Build for both:           npm run build -- --win" -ForegroundColor White
Write-Host ""

Write-Host "Available Scripts:" -ForegroundColor $Colors.Info
Write-Host "- npm run dev                 Start development with hot reload" -ForegroundColor White
Write-Host "- npm run compile             Compile TypeScript" -ForegroundColor White
Write-Host "- npm run rebuild             Rebuild native modules" -ForegroundColor White
Write-Host "- npm run rebuild:sharp       Rebuild Sharp.js specifically" -ForegroundColor White
Write-Host "- npm test                    Run test suite" -ForegroundColor White
Write-Host "- npm run test:performance    Run performance tests" -ForegroundColor White
Write-Host ""

Write-Host "Architecture Support:" -ForegroundColor $Colors.Info
Write-Host "- x64:   Full native support" -ForegroundColor White
Write-Host "- ARM64: Native + x64 emulation fallback" -ForegroundColor White
Write-Host ""

Write-Host "Vendor Tools:" -ForegroundColor $Colors.Info
Write-Host "- ExifTool: vendor\win32\{arch}\exiftool.exe" -ForegroundColor White
Write-Host "- dcraw:    vendor\win32\{arch}\dcraw.exe" -ForegroundColor White
if (-not $SkipImageMagick) {
    Write-Host "- ImageMagick: vendor\win32\{arch}\imagemagick\magick.exe" -ForegroundColor White
}
Write-Host ""

Write-Host "For troubleshooting, check:" -ForegroundColor $Colors.Info
Write-Host "- vendor\win32\README.md" -ForegroundColor White
Write-Host "- vendor\win32\imagemagick-setup.md" -ForegroundColor White
Write-Host "- CLAUDE.md" -ForegroundColor White