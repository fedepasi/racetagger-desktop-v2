# RaceTagger Desktop - Windows Development Guide

Complete guide for setting up, developing, and building RaceTagger Desktop on Windows systems.

## 🏗️ Architecture Support

### Native Support
- **x64 (Intel/AMD)**: Full native performance on traditional Windows PCs
- **ARM64 (Snapdragon)**: Native support with x64 emulation fallback

### Automatic Detection
The application automatically detects your system architecture and selects optimal binaries:
1. **Native architecture preferred**: Uses ARM64 binaries on ARM64 systems when available
2. **Emulation fallback**: Falls back to x64 binaries under Prism emulation (70-85% performance)
3. **System fallback**: Uses system-installed tools if bundled versions unavailable

## ⚡ Quick Setup

### Prerequisites
- **Node.js 16+** (LTS recommended)
- **Python 3.8+** (for native module compilation)
- **Visual Studio Build Tools 2022** (or Visual Studio Community)
- **Git for Windows**

### One-Command Setup
```powershell
# Run in PowerShell as Administrator (recommended)
.\scripts\setup-windows-dev.ps1

# Or skip certain components
.\scripts\setup-windows-dev.ps1 -SkipImageMagick -Architecture x64
```

This script will:
- ✅ Verify system requirements
- ✅ Install dependencies (`npm install`)
- ✅ Rebuild native modules for Electron
- ✅ Set up vendor directory structure
- ✅ Download and configure ImageMagick portable
- ✅ Compile TypeScript
- ✅ Test the development environment

## 🔧 Manual Setup

### 1. Install System Dependencies

#### Node.js and npm
```powershell
# Check if already installed
node --version  # Should be 16+
npm --version

# If not installed, download from: https://nodejs.org/
```

#### Visual Studio Build Tools
```powershell
# Download and install Visual Studio Build Tools 2022
# https://visualstudio.microsoft.com/visual-cpp-build-tools/

# Or install via Chocolatey
choco install visualstudio2022buildtools --package-parameters "--add Microsoft.VisualStudio.Workload.VCTools"
```

#### Python (for node-gyp)
```powershell
# Install Python 3.8+
# https://www.python.org/downloads/

# Or via Microsoft Store
# Or via Chocolatey
choco install python
```

### 2. Clone and Setup Project
```powershell
git clone <repository-url>
cd racetagger-desktop

# Install dependencies
npm install

# Rebuild native modules for Electron
npm run rebuild

# Compile TypeScript
npm run compile
```

### 3. Set Up Native Tools

#### ImageMagick Portable
```powershell
# Automatic setup (recommended)
.\scripts\setup-imagemagick-windows.ps1

# Manual setup for specific architecture
.\scripts\setup-imagemagick-windows.ps1 -Architecture x64
.\scripts\setup-imagemagick-windows.ps1 -Architecture arm64
```

#### Generate Windows Icons
```powershell
npm run generate:icons
```

## 🛠️ Development Workflow

### Start Development Server
```powershell
npm run dev
```

### Architecture-Specific Building
```powershell
# Build for x64 (Intel/AMD)
npm run build:win:x64

# Build for ARM64 (Snapdragon)
npm run build:win:arm64

# Build for both architectures
npm run build:win:all
```

### Native Module Management
```powershell
# Rebuild all native modules
npm run rebuild

# Rebuild specific module
npm run rebuild:sharp

# Debug rebuild issues
npm run rebuild:debug

# Windows-specific rebuild script
.\scripts\rebuild-native-windows.ps1
```

## 📁 Directory Structure

```
racetagger-desktop/
├── src/                          # TypeScript source code
├── dist/                         # Compiled JavaScript
├── vendor/                       # Native tools and binaries
│   └── win32/                    # Windows-specific tools
│       ├── x64/                  # x64 architecture binaries
│       │   ├── exiftool.exe      # Metadata tool
│       │   ├── dcraw.exe         # RAW converter
│       │   └── imagemagick/      # Image processing
│       └── arm64/                # ARM64 architecture binaries
│           ├── exiftool.exe      # (x64 for emulation)
│           ├── dcraw.exe         # (x64 for emulation)
│           └── imagemagick/      # Native or x64 fallback
├── resources/                    # Build resources
│   ├── icon.ico                  # Windows icon
│   └── icons/                    # Multi-resolution icons
├── scripts/                      # Development scripts
│   ├── setup-windows-dev.ps1    # Full environment setup
│   ├── setup-imagemagick-windows.ps1
│   ├── rebuild-native-windows.ps1
│   └── generate-icons.js
└── release/                      # Built applications
```

## 🎯 Build Targets

### NSIS Installer
- **Output**: `RaceTagger-1.0.2-x64-win32.exe`
- **Features**: Standard Windows installer with shortcuts
- **Recommended for**: Distribution and user installations

### Portable Executable  
- **Output**: `RaceTagger-1.0.2-x64-portable.exe`
- **Features**: Single executable, no installation required
- **Recommended for**: USB drives, temporary usage

### ZIP Archive
- **Output**: `RaceTagger-1.0.2-x64-win32.zip`
- **Features**: Extractable archive with all files
- **Recommended for**: Manual deployment, testing

## 🔍 Troubleshooting

### Common Issues

#### Native Module Rebuild Failures
```powershell
# Check Visual Studio Build Tools
npm config get msvs_version

# Set specific version if needed
npm config set msvs_version 2022

# Clean and rebuild
rm -rf node_modules
npm install
npm run rebuild
```

#### Sharp.js Issues
```powershell
# Force Sharp rebuild
npm run rebuild:sharp

# Check Sharp installation
node -e "console.log(require('sharp').versions)"

# Manual Sharp reinstall
npm uninstall sharp
npm install sharp
npm run rebuild:sharp
```

#### ExifTool Not Found
```powershell
# Check if ExifTool exists
ls vendor\win32\x64\exiftool.exe
ls vendor\win32\arm64\exiftool.exe

# Test ExifTool
vendor\win32\x64\exiftool.exe -ver
```

#### ImageMagick Issues
```powershell
# Re-run ImageMagick setup
.\scripts\setup-imagemagick-windows.ps1 -Force

# Test ImageMagick
vendor\win32\x64\imagemagick\magick.exe -version
```

#### Build Failures
```powershell
# Check Electron Builder configuration
npm run build -- --help

# Clean build
rm -rf dist
rm -rf release
npm run compile
npm run build:win:x64
```

### Performance Issues

#### ARM64 Systems
- Use native ARM64 tools when available
- x64 emulation provides 70-85% performance
- Consider Sharp.js WebAssembly fallback for image processing

#### Memory Usage
- Monitor memory during large batch processing
- Adjust batch sizes in configuration
- Use streaming pipeline for large datasets

### Diagnostic Tools

#### System Information
```powershell
# Check architecture
echo $env:PROCESSOR_ARCHITECTURE

# Check Windows version
systeminfo | findstr /B /C:"OS Name" /C:"OS Version"

# Check Node.js architecture
node -e "console.log(process.arch, process.platform)"
```

#### Application Diagnostics
```powershell
# Run with debug logging
$env:DEBUG="*"
npm run dev

# Check native tool manager
node -e "const {nativeToolManager} = require('./dist/src/utils/native-tool-manager'); nativeToolManager.getSystemDiagnostics().then(console.log);"
```

## 🚀 Performance Optimization

### Native Tools
- Use bundled tools for consistent performance
- Leverage architecture-specific binaries
- Enable parallel processing where supported

### Image Processing
- Use Sharp.js for simple operations (fastest)
- Use ImageMagick for complex transformations
- Consider dcraw for RAW file processing

### Build Optimization
- Use `npm run build:win:x64` for single architecture
- Enable differential package updates
- Optimize asarUnpack patterns

## 📋 Available Scripts

### Development
```powershell
npm run dev                   # Start development server
npm run compile               # Compile TypeScript only
npm start                     # Start compiled application
```

### Building
```powershell
npm run build                 # Build for current platform
npm run build:win:x64         # Build Windows x64
npm run build:win:arm64       # Build Windows ARM64  
npm run build:win:all         # Build both architectures
```

### Maintenance
```powershell
npm run rebuild               # Rebuild native modules
npm run rebuild:win           # Windows-specific rebuild
npm run rebuild:sharp         # Rebuild Sharp.js only
npm run generate:icons        # Generate Windows icons
```

### Setup
```powershell
npm run setup:win             # Full Windows setup
npm run setup:imagemagick     # ImageMagick setup only
```

### Testing
```powershell
npm test                      # Run test suite
npm run test:performance      # Performance benchmarks
npm run test:performance:quick # Quick regression tests
```

## 📖 Additional Resources

- **Main Documentation**: [CLAUDE.md](CLAUDE.md)
- **Vendor Tools**: [vendor/win32/README.md](vendor/win32/README.md)  
- **ImageMagick Setup**: [vendor/win32/imagemagick-setup.md](vendor/win32/imagemagick-setup.md)
- **Release Notes**: [release/RELEASE_NOTES_v1.0.0.md](release/RELEASE_NOTES_v1.0.0.md)

## 🔗 Useful Links

- [Node.js Downloads](https://nodejs.org/)
- [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/)
- [Electron Documentation](https://www.electronjs.org/docs)
- [ImageMagick for Windows](https://imagemagick.org/script/download.php#windows)
- [Windows ARM64 Development](https://docs.microsoft.com/en-us/windows/arm/)

## 🤝 Support

For Windows-specific issues:
1. Check this guide and troubleshooting section
2. Review the diagnostic tools output
3. Check GitHub Issues for similar problems
4. Create a new issue with system information and error logs