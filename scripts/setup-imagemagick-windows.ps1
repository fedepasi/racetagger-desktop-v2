# PowerShell script to download and setup ImageMagick portable for Windows
# Supports both x64 and ARM64 architectures

param(
    [Parameter()]
    [ValidateSet("x64", "arm64", "both")]
    [string]$Architecture = "both",
    
    [Parameter()]
    [string]$Version = "7.1.2-0",
    
    [Parameter()]
    [switch]$Force
)

$ErrorActionPreference = "Stop"

Write-Host "Setting up ImageMagick portable for Windows..." -ForegroundColor Green
Write-Host "Architecture: $Architecture" -ForegroundColor Yellow
Write-Host "Version: $Version" -ForegroundColor Yellow

# Base URLs for ImageMagick portable downloads
$BaseUrl = "https://imagemagick.org/archive/binaries"

# Architecture configurations
$Architectures = @{
    "x64" = @{
        "FileName" = "ImageMagick-$Version-portable-Q8-x64.zip"
        "Directory" = "vendor/win32/x64/imagemagick"
        "Url" = "$BaseUrl/ImageMagick-$Version-portable-Q8-x64.zip"
    }
    "arm64" = @{
        "FileName" = "ImageMagick-$Version-portable-Q8-arm64.zip"
        "Directory" = "vendor/win32/arm64/imagemagick"
        "Url" = "$BaseUrl/ImageMagick-$Version-portable-Q8-arm64.zip"
    }
}

function Test-Architecture($arch) {
    return $Architectures.ContainsKey($arch)
}

function Download-ImageMagick($arch) {
    $config = $Architectures[$arch]
    $fileName = $config.FileName
    $directory = $config.Directory
    $url = $config.Url
    
    Write-Host "Setting up ImageMagick for $arch architecture..." -ForegroundColor Cyan
    
    # Create directory if it doesn't exist
    if (-not (Test-Path $directory)) {
        New-Item -ItemType Directory -Path $directory -Force | Out-Null
        Write-Host "Created directory: $directory" -ForegroundColor Green
    }
    
    # Check if already exists and not forcing
    $extractedPath = Join-Path $directory "magick.exe"
    if ((Test-Path $extractedPath) -and -not $Force) {
        Write-Host "ImageMagick $arch already exists. Use -Force to overwrite." -ForegroundColor Yellow
        return
    }
    
    # Download
    $tempFile = Join-Path $env:TEMP $fileName
    Write-Host "Downloading from: $url" -ForegroundColor Yellow
    
    try {
        # Use System.Net.WebClient for better compatibility
        $webClient = New-Object System.Net.WebClient
        $webClient.DownloadFile($url, $tempFile)
        Write-Host "Downloaded: $tempFile" -ForegroundColor Green
    }
    catch {
        Write-Error "Failed to download ImageMagick $arch from $url. Error: $($_.Exception.Message)"
        return
    }
    
    # Extract
    Write-Host "Extracting to: $directory" -ForegroundColor Yellow
    
    try {
        # Use .NET compression if available (Windows 10/11)
        if (Get-Command "Expand-Archive" -ErrorAction SilentlyContinue) {
            Expand-Archive -Path $tempFile -DestinationPath $directory -Force
        }
        else {
            # Fallback for older Windows versions
            $shell = New-Object -ComObject Shell.Application
            $zip = $shell.Namespace($tempFile)
            $dest = $shell.Namespace($directory)
            $dest.CopyHere($zip.Items(), 4)
        }
        
        Write-Host "Extracted successfully" -ForegroundColor Green
    }
    catch {
        Write-Error "Failed to extract ImageMagick $arch. Error: $($_.Exception.Message)"
        return
    }
    finally {
        # Cleanup
        if (Test-Path $tempFile) {
            Remove-Item $tempFile -Force
            Write-Host "Cleaned up temporary file" -ForegroundColor Green
        }
    }
    
    # Verify installation
    if (Test-Path $extractedPath) {
        Write-Host "✓ ImageMagick $arch installed successfully" -ForegroundColor Green
        
        # Test the binary
        try {
            $version = & $extractedPath -version 2>&1 | Select-Object -First 1
            Write-Host "Version: $version" -ForegroundColor Cyan
        }
        catch {
            Write-Warning "ImageMagick binary might not be working correctly"
        }
    }
    else {
        Write-Error "ImageMagick installation verification failed for $arch"
    }
}

function Setup-ImageMagickConfig($arch) {
    $configDir = "vendor/win32/$arch/imagemagick/config"
    
    if (-not (Test-Path $configDir)) {
        New-Item -ItemType Directory -Path $configDir -Force | Out-Null
    }
    
    # Create basic policy.xml for security
    $policyXml = @"
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE policymap [
  <!ELEMENT policymap (policy)*>
  <!ATTLIST policymap xmlns CDATA #FIXED "">
  <!ELEMENT policy EMPTY>
  <!ATTLIST policy xmlns CDATA #FIXED "" domain NMTOKEN #REQUIRED
    name NMTOKEN #IMPLIED pattern CDATA #IMPLIED rights NMTOKEN #IMPLIED
    stealth NMTOKEN #IMPLIED value CDATA #IMPLIED>
]>
<policymap>
  <policy domain="delegate" rights="none" pattern="HTTPS" />
  <policy domain="delegate" rights="none" pattern="HTTP" />
  <policy domain="path" rights="none" pattern="@*" />
  <policy domain="cache" name="memory-map" value="anonymous"/>
  <policy domain="cache" name="synchronize" value="True"/>
  <policy domain="cache" name="shared-secret" value="passphrase" stealth="true"/>
  <policy domain="resource" name="memory" value="2GiB"/>
  <policy domain="resource" name="map" value="4GiB"/>
  <policy domain="resource" name="width" value="16KP"/>
  <policy domain="resource" name="height" value="16KP"/>
  <policy domain="resource" name="area" value="128MP"/>
  <policy domain="resource" name="disk" value="8GiB"/>
  <policy domain="resource" name="file" value="768"/>
  <policy domain="resource" name="thread" value="4"/>
  <policy domain="resource" name="throttle" value="0"/>
  <policy domain="resource" name="time" value="3600"/>
  <policy domain="resource" name="list-length" value="128"/>
</policymap>
"@
    
    $policyPath = Join-Path $configDir "policy.xml"
    $policyXml | Out-File -FilePath $policyPath -Encoding UTF8
    Write-Host "Created ImageMagick security policy: $policyPath" -ForegroundColor Green
}

# Main execution
try {
    if ($Architecture -eq "both") {
        foreach ($arch in @("x64", "arm64")) {
            Download-ImageMagick $arch
            Setup-ImageMagickConfig $arch
        }
    }
    elseif (Test-Architecture $Architecture) {
        Download-ImageMagick $Architecture
        Setup-ImageMagickConfig $Architecture
    }
    else {
        Write-Error "Invalid architecture: $Architecture. Must be 'x64', 'arm64', or 'both'"
    }
    
    Write-Host "`n✓ ImageMagick setup completed successfully!" -ForegroundColor Green
    Write-Host "Note: The application will automatically detect and use the appropriate binary." -ForegroundColor Yellow
}
catch {
    Write-Error "Setup failed: $($_.Exception.Message)"
    exit 1
}

# Instructions
Write-Host "`nUsage Instructions:" -ForegroundColor Cyan
Write-Host "- The portable ImageMagick binaries are now available in vendor/win32/*/imagemagick/" -ForegroundColor White
Write-Host "- The NativeToolManager will automatically select the correct architecture" -ForegroundColor White
Write-Host "- No system installation of ImageMagick is required" -ForegroundColor White
Write-Host "- Security policies are configured to prevent common vulnerabilities" -ForegroundColor White