# PowerShell script for rebuilding native modules on Windows
# Handles architecture-specific rebuilds for both x64 and ARM64

param(
    [Parameter()]
    [ValidateSet("x64", "arm64", "current")]
    [string]$Architecture = "current",
    
    [Parameter()]
    [switch]$Force,
    
    [Parameter()]
    [switch]$Verbose
)

$ErrorActionPreference = "Stop"

Write-Host "Rebuilding Native Modules for Windows" -ForegroundColor Cyan
Write-Host "Architecture: $Architecture" -ForegroundColor Yellow

# Detect current architecture if not specified
if ($Architecture -eq "current") {
    $Architecture = $env:PROCESSOR_ARCHITECTURE.ToLower()
    if ($Architecture -eq "amd64") { $Architecture = "x64" }
    Write-Host "Detected architecture: $Architecture" -ForegroundColor Green
}

# Architecture-specific environment variables
$ArchConfig = @{
    "x64" = @{
        "npm_config_arch" = "x64"
        "npm_config_target_arch" = "x64"
        "npm_config_msvs_version" = "2022"
        "npm_config_node_gyp" = "node-gyp"
    }
    "arm64" = @{
        "npm_config_arch" = "arm64"
        "npm_config_target_arch" = "arm64"
        "npm_config_msvs_version" = "2022"
        "npm_config_node_gyp" = "node-gyp"
    }
}

function Set-RebuildEnvironment($arch) {
    $config = $ArchConfig[$arch]
    
    foreach ($key in $config.Keys) {
        $env:$key = $config[$key]
        if ($Verbose) {
            Write-Host "Set $key = $($config[$key])" -ForegroundColor Gray
        }
    }
    
    # Common Electron environment
    $env:npm_config_disturl = "https://electronjs.org/headers"
    $env:npm_config_runtime = "electron"
    $env:npm_config_build_from_source = "true"
    $env:npm_config_force = if ($Force) { "true" } else { "false" }
    
    # Get Electron version from package.json
    try {
        $packageJson = Get-Content "package.json" | ConvertFrom-Json
        $electronVersion = $packageJson.devDependencies.electron -replace '\^|~|>=|<=|>|<', ''
        $env:npm_config_target = $electronVersion
        
        if ($Verbose) {
            Write-Host "Electron version: $electronVersion" -ForegroundColor Gray
        }
    }
    catch {
        Write-Warning "Could not determine Electron version from package.json"
    }
}

function Rebuild-Module($moduleName, $arch) {
    Write-Host "`nRebuilding $moduleName for $arch..." -ForegroundColor Cyan
    
    Set-RebuildEnvironment $arch
    
    try {
        if ($moduleName -eq "all") {
            Write-Host "Rebuilding all native modules..." -ForegroundColor Yellow
            $command = "npx @electron/rebuild"
        }
        else {
            Write-Host "Rebuilding specific module: $moduleName..." -ForegroundColor Yellow
            $command = "npx @electron/rebuild -f -w $moduleName"
        }
        
        if ($Verbose) {
            Write-Host "Command: $command" -ForegroundColor Gray
            Write-Host "Environment variables:" -ForegroundColor Gray
            Get-ChildItem env: | Where-Object { $_.Name -like "npm_config_*" } | ForEach-Object {
                Write-Host "  $($_.Name) = $($_.Value)" -ForegroundColor Gray
            }
        }
        
        Invoke-Expression $command
        Write-Host "✓ $moduleName rebuilt successfully" -ForegroundColor Green
    }
    catch {
        Write-Host "✗ Failed to rebuild $moduleName" -ForegroundColor Red
        Write-Host "Error: $($_.Exception.Message)" -ForegroundColor Red
        throw
    }
}

function Test-Module($moduleName) {
    Write-Host "Testing $moduleName..." -ForegroundColor Yellow
    
    try {
        switch ($moduleName) {
            "sharp" {
                node -e "const sharp = require('sharp'); console.log('Sharp version:', sharp.versions); sharp.cache(false);"
            }
            "better-sqlite3" {
                node -e "const db = require('better-sqlite3')(':memory:'); console.log('better-sqlite3 loaded successfully');"
            }
            default {
                node -e "console.log('Module $moduleName loaded:', require('$moduleName'));"
            }
        }
        Write-Host "✓ $moduleName test passed" -ForegroundColor Green
        return $true
    }
    catch {
        Write-Host "✗ $moduleName test failed: $($_.Exception.Message)" -ForegroundColor Red
        return $false
    }
}

# Critical native modules for RaceTagger
$CriticalModules = @(
    "sharp",
    "better-sqlite3"
)

# Optional native modules
$OptionalModules = @(
    "jimp"
)

Write-Host "`nRebuilding critical native modules..." -ForegroundColor Magenta

$success = $true
$results = @{}

foreach ($module in $CriticalModules) {
    try {
        Rebuild-Module $module $Architecture
        $testResult = Test-Module $module
        $results[$module] = @{
            "rebuilt" = $true
            "tested" = $testResult
        }
    }
    catch {
        Write-Warning "Critical module $module failed to rebuild"
        $success = $false
        $results[$module] = @{
            "rebuilt" = $false
            "tested" = $false
        }
    }
}

Write-Host "`nRebuilding optional native modules..." -ForegroundColor Magenta

foreach ($module in $OptionalModules) {
    try {
        Rebuild-Module $module $Architecture
        $testResult = Test-Module $module
        $results[$module] = @{
            "rebuilt" = $true
            "tested" = $testResult
        }
    }
    catch {
        Write-Warning "Optional module $module failed to rebuild (continuing...)"
        $results[$module] = @{
            "rebuilt" = $false
            "tested" = $false
        }
    }
}

# Summary
Write-Host "`n" + "="*50 -ForegroundColor Cyan
Write-Host "Rebuild Summary for $Architecture" -ForegroundColor Cyan
Write-Host "="*50 -ForegroundColor Cyan

foreach ($module in $results.Keys) {
    $result = $results[$module]
    $status = if ($result.rebuilt -and $result.tested) { "✓ OK" } 
             elseif ($result.rebuilt) { "⚠ REBUILT (test failed)" }
             else { "✗ FAILED" }
    
    $color = if ($result.rebuilt -and $result.tested) { "Green" }
             elseif ($result.rebuilt) { "Yellow" }
             else { "Red" }
    
    Write-Host "$module : $status" -ForegroundColor $color
}

if ($success) {
    Write-Host "`n✓ All critical modules rebuilt successfully!" -ForegroundColor Green
    Write-Host "You can now run the application with: npm run dev" -ForegroundColor Cyan
}
else {
    Write-Host "`n✗ Some critical modules failed to rebuild" -ForegroundColor Red
    Write-Host "Check the errors above and ensure you have:" -ForegroundColor Yellow
    Write-Host "- Visual Studio Build Tools installed" -ForegroundColor White
    Write-Host "- Python installed and in PATH" -ForegroundColor White
    Write-Host "- Correct Node.js version (16+)" -ForegroundColor White
    exit 1
}

# Additional diagnostic information
Write-Host "`nDiagnostic Information:" -ForegroundColor Cyan
Write-Host "Node.js version: $(node --version)" -ForegroundColor White
Write-Host "npm version: $(npm --version)" -ForegroundColor White
Write-Host "Architecture: $Architecture" -ForegroundColor White
Write-Host "Platform: $($env:OS)" -ForegroundColor White

if (Test-Path "node_modules\.bin\electron.cmd") {
    $electronVersion = & "node_modules\.bin\electron.cmd" --version 2>$null
    Write-Host "Electron version: $electronVersion" -ForegroundColor White
}

Write-Host "`nFor more help, see:" -ForegroundColor Cyan
Write-Host "- CLAUDE.md (development guide)" -ForegroundColor White
Write-Host "- scripts/setup-windows-dev.ps1 (full setup)" -ForegroundColor White