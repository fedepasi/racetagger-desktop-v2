# Build Configuration Guide

This guide explains how to configure platform-specific build settings for RaceTagger Desktop without committing them to version control.

## Multi-Platform Development Setup

Since this repository is shared between macOS and Windows development machines, platform-specific configurations should be kept in local files that are **NOT** committed to git.

### Platform-Specific Configuration Files

Create these files in the project root (they are already in `.gitignore`):

#### For macOS Development: `.env.mac`

```bash
# macOS Signing and Notarization
APPLE_ID=your-apple-id@example.com
APPLE_APP_SPECIFIC_PASSWORD=xxxx-xxxx-xxxx-xxxx
APPLE_TEAM_ID=YOUR_TEAM_ID

# Code signing identity
MAC_SIGNING_IDENTITY="Developer ID Application: Your Name (TEAM_ID)"
```

#### For Windows Development: `.env.win`

```bash
# Windows Code Signing (optional)
WIN_CSC_LINK=path/to/certificate.pfx
WIN_CSC_KEY_PASSWORD=your_certificate_password

# Windows signing identity
WIN_SIGNING_IDENTITY="Your Company Name"
```

### Using Platform Configuration

The build scripts will automatically detect your platform and use the appropriate configuration:

```bash
# On macOS
npm run build:mac:arm64

# On Windows
npm run build:win:x64
```

### Package.json Configuration

The `package.json` contains **platform-neutral** configuration. Platform-specific settings (like macOS code signing) are only applied when building on that specific platform.

**Current structure:**
- `build.mac`: macOS-specific settings (only used on macOS)
- `build.win`: Windows-specific settings (only used on Windows)
- `build.linux`: Linux-specific settings (only used on Linux)

### Important Notes

1. **DO NOT commit** `.env.mac`, `.env.win`, or `.env.linux` to git
2. **DO NOT hardcode** certificates, passwords, or team IDs in `package.json`
3. Each developer should maintain their own local configuration files
4. The `.gitignore` file already excludes these sensitive files

## ExifTool Installation

### Windows

ExifTool is required for IPTC metadata writing and XMP sidecar file creation.

**Installation:**
1. Download ExifTool from https://exiftool.org/
2. Extract `exiftool(-k).exe` to `vendor/win32/x64/` directory
3. Rename to `exiftool.exe`

Alternatively, the app will attempt to download ExifTool automatically on first run.

**Manual setup:**
```bash
mkdir -p vendor/win32/x64
# Copy exiftool.exe to vendor/win32/x64/exiftool.exe
```

### macOS

ExifTool is bundled in the `vendor/darwin/` directory and managed automatically.

**Verification:**
```bash
./vendor/darwin/exiftool -ver
```

### Linux

ExifTool should be installed via package manager:

```bash
# Debian/Ubuntu
sudo apt-get install libimage-exiftool-perl

# Fedora/RHEL
sudo dnf install perl-Image-ExifTool

# Arch
sudo pacman -S perl-image-exiftool
```

## Build Artifacts

All build artifacts are excluded from git via `.gitignore`:

- `release/` - Contains all built executables (.exe, .dmg, .zip)
- `dist/` - Compiled TypeScript output
- `node_modules/` - Dependencies
- `package-lock.json` - Lock file (can cause cross-platform conflicts)

## Recommended Workflow

### Initial Setup (Each Developer)

1. Clone the repository
2. Run `npm install` (generates platform-specific native modules)
3. Create your `.env.mac` or `.env.win` with your credentials
4. Run platform-specific build: `npm run build:mac:arm64` or `npm run build:win:x64`

### Before Committing

1. Ensure `.env.mac` / `.env.win` are not staged
2. Do not commit `release/`, `dist/`, or `node_modules/`
3. Do not commit `package-lock.json`

### Switching Between Platforms

When pulling changes on a different platform:

```bash
# Clean install to rebuild native modules
rm -rf node_modules
npm install

# Rebuild native dependencies
npm run rebuild
```

## Troubleshooting

### Build fails with certificate errors on macOS

- Check that `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, and `APPLE_TEAM_ID` are set in `.env.mac`
- Verify your certificate is valid: `security find-identity -v -p codesigning`

### ExifTool not found on Windows

- Ensure `vendor/win32/x64/exiftool.exe` exists
- Check that the file is not blocked by Windows (Right-click → Properties → Unblock)

### Native module errors

- Run `npm run rebuild` to recompile native modules for your platform
- On Windows: Ensure Visual Studio Build Tools are installed
- On macOS: Ensure Xcode Command Line Tools are installed

## Security Best Practices

1. **Never commit** credentials, certificates, or API keys
2. **Use app-specific passwords** for Apple ID (not your main password)
3. **Keep certificates secure** and rotate them regularly
4. **Use environment variables** for all sensitive configuration
