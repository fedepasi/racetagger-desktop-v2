# RAW Preview Extractor - Troubleshooting Guide

This guide helps you diagnose and resolve common issues with RAW Preview Extractor.

## Table of Contents

- [Installation Issues](#installation-issues)
- [Runtime Errors](#runtime-errors)  
- [Performance Problems](#performance-problems)
- [Format-Specific Issues](#format-specific-issues)
- [Electron Integration Issues](#electron-integration-issues)
- [Build Issues](#build-issues)
- [Memory and Resource Issues](#memory-and-resource-issues)
- [Platform-Specific Issues](#platform-specific-issues)
- [Getting Help](#getting-help)

## Installation Issues

### Module Not Found

**Error**: `Cannot find module 'raw-preview-extractor'` or `Module not found`

**Causes & Solutions**:

1. **Module not installed**:
   ```bash
   npm install raw-preview-extractor
   ```

2. **Wrong import/require path**:
   ```typescript
   // Correct
   import { extractPreview } from 'raw-preview-extractor';
   // or
   const { extractPreview } = require('raw-preview-extractor');
   ```

3. **TypeScript configuration issue**:
   ```json
   // tsconfig.json
   {
     "compilerOptions": {
       "moduleResolution": "node",
       "esModuleInterop": true
     }
   }
   ```

### Native Module Build Failures

**Error**: `Error: The module was compiled against a different Node.js version`

**Solutions**:
1. **Rebuild for current Node.js version**:
   ```bash
   npm rebuild raw-preview-extractor
   ```

2. **Use prebuilt binaries** (if available):
   ```bash
   npm install --prefer-binary raw-preview-extractor
   ```

3. **For Electron applications**:
   ```bash
   npx electron-rebuild
   ```

### Permission Errors

**Error**: `EACCES: permission denied` or `Access denied`

**Solutions**:
1. **Fix npm permissions**:
   ```bash
   sudo chown -R $(whoami) ~/.npm
   ```

2. **Use different npm prefix**:
   ```bash
   mkdir ~/.npm-global
   npm config set prefix '~/.npm-global'
   # Add ~/.npm-global/bin to your PATH
   ```

3. **Use yarn instead**:
   ```bash
   yarn add raw-preview-extractor
   ```

## Runtime Errors

### "Failed to load native RAW extractor module"

**Error**: Module loads but fails to initialize the native component.

**Causes & Solutions**:

1. **Missing dependencies (Linux)**:
   ```bash
   # Check dependencies
   ldd node_modules/raw-preview-extractor/build/Release/raw_extractor.node

   # Install missing libraries
   sudo apt-get install libc6-dev libstdc++6
   ```

2. **Architecture mismatch**:
   ```bash
   # Check Node.js architecture
   node -p "process.arch"
   
   # Rebuild for correct architecture
   npm rebuild
   ```

3. **Corrupted binary**:
   ```bash
   rm -rf node_modules/raw-preview-extractor
   npm install raw-preview-extractor
   ```

### Timeout Errors

**Error**: `ErrorCode.TIMEOUT_EXCEEDED` or "Operation timed out"

**Solutions**:

1. **Increase timeout**:
   ```typescript
   const result = await extractPreview(filePath, {
     timeout: 30000  // 30 seconds
   });
   ```

2. **Check file size and complexity**:
   ```typescript
   import fs from 'fs';
   const stats = fs.statSync(filePath);
   console.log('File size:', stats.size / (1024 * 1024), 'MB');
   ```

3. **Use less strict validation**:
   ```typescript
   const result = await extractPreview(filePath, {
     strictValidation: false
   });
   ```

### Memory Limit Exceeded

**Error**: `ErrorCode.MEMORY_LIMIT_EXCEEDED` or "Memory limit exceeded"

**Solutions**:

1. **Increase memory limit**:
   ```typescript
   const result = await extractPreview(filePath, {
     maxMemory: 200  // 200MB limit
   });
   ```

2. **Process files sequentially**:
   ```typescript
   // Instead of parallel processing
   const results = [];
   for (const file of files) {
     const result = await extractPreview(file);
     results.push(result);
   }
   ```

3. **Monitor system memory**:
   ```typescript
   console.log('Memory usage:', process.memoryUsage());
   ```

### File Access Errors

**Error**: `ErrorCode.FILE_NOT_FOUND` or `ErrorCode.FILE_ACCESS_DENIED`

**Solutions**:

1. **Check file existence**:
   ```typescript
   import fs from 'fs';
   if (!fs.existsSync(filePath)) {
     console.error('File does not exist:', filePath);
   }
   ```

2. **Check file permissions**:
   ```bash
   # Unix/Linux/macOS
   ls -la /path/to/file
   
   # Windows
   icacls "C:\path\to\file"
   ```

3. **Handle long paths (Windows)**:
   ```typescript
   import path from 'path';
   const fullPath = path.resolve(filePath);
   ```

## Performance Problems

### Slow Extraction

**Symptoms**: Extraction takes longer than expected (>500ms for typical files).

**Diagnosis**:
```typescript
const startTime = Date.now();
const result = await extractPreview(filePath);
const elapsed = Date.now() - startTime;
console.log('Extraction took:', elapsed, 'ms');
```

**Solutions**:

1. **Optimize target size**:
   ```typescript
   const options = {
     targetSize: {
       min: 100 * 1024,   // 100KB
       max: 1 * 1024 * 1024  // 1MB
     }
   };
   ```

2. **Disable strict validation**:
   ```typescript
   const options = {
     strictValidation: false
   };
   ```

3. **Use lower quality previews**:
   ```typescript
   const options = {
     preferQuality: 'thumbnail'  // Faster than 'preview' or 'full'
   };
   ```

### High Memory Usage

**Symptoms**: Process memory grows significantly during extraction.

**Diagnosis**:
```typescript
const before = process.memoryUsage();
await extractPreview(filePath);
const after = process.memoryUsage();
console.log('Memory delta:', after.heapUsed - before.heapUsed);
```

**Solutions**:

1. **Process files in batches**:
   ```typescript
   const batchSize = 5;
   for (let i = 0; i < files.length; i += batchSize) {
     const batch = files.slice(i, i + batchSize);
     await Promise.all(batch.map(file => extractPreview(file)));
     
     // Force garbage collection if available
     if (global.gc) global.gc();
   }
   ```

2. **Use synchronous API for better memory control**:
   ```typescript
   const result = extractPreviewSync(filePath, options);
   ```

## Format-Specific Issues

### CR3 Files Not Working

**Error**: `ErrorCode.INVALID_FORMAT` for Canon CR3 files.

**Solutions**:
1. **Verify CR3 support**:
   ```typescript
   import { getSupportedFormats } from 'raw-preview-extractor';
   console.log('Supported formats:', getSupportedFormats());
   ```

2. **Check file validity**:
   ```typescript
   import fs from 'fs';
   const buffer = fs.readFileSync(filePath);
   console.log('File signature:', buffer.slice(0, 20));
   ```

### Nikon NEF Issues

**Problem**: NEF files from specific camera models not working.

**Solutions**:
1. **Test with different NEF files** to isolate the issue
2. **Check camera model compatibility** - newer models may use unsupported variations

### Sony ARW Problems

**Problem**: ARW files produce corrupted previews.

**Solutions**:
1. **Try different quality settings**:
   ```typescript
   const options = { preferQuality: 'preview' };  // Instead of 'full'
   ```

2. **Use less strict validation**:
   ```typescript
   const options = { strictValidation: false };
   ```

## Electron Integration Issues

### Module Loading in Renderer Process

**Error**: Native module fails to load in Electron renderer process.

**Solutions**:
1. **Use in main process only**:
   ```javascript
   // main.js
   const { extractPreview } = require('raw-preview-extractor');
   
   ipcMain.handle('extract-preview', async (event, filePath) => {
     return await extractPreview(filePath);
   });
   ```

2. **Enable node integration** (not recommended for security):
   ```javascript
   // main.js
   new BrowserWindow({
     webPreferences: {
       nodeIntegration: true,
       contextIsolation: false
     }
   });
   ```

### Electron Rebuild Issues

**Error**: Module works in Node.js but not in Electron.

**Solutions**:
1. **Rebuild for Electron**:
   ```bash
   npx electron-rebuild
   ```

2. **Specify Electron version**:
   ```bash
   npx electron-rebuild --version=25.0.0
   ```

3. **Clear cache and rebuild**:
   ```bash
   rm -rf node_modules
   npm install
   npx electron-rebuild
   ```

## Build Issues

### Compilation Failures

**Error**: C++ compilation fails during installation.

See [BUILDING.md](BUILDING.md) for detailed build troubleshooting.

**Quick fixes**:
1. **Update build tools**:
   ```bash
   # Windows
   npm install -g windows-build-tools
   
   # macOS
   xcode-select --install
   
   # Linux
   sudo apt-get install build-essential
   ```

2. **Use prebuilt binaries**:
   ```bash
   npm install --prefer-binary
   ```

## Memory and Resource Issues

### Memory Leaks

**Symptoms**: Memory usage grows over time with repeated extractions.

**Diagnosis**:
```typescript
// Run with --expose-gc flag
node --expose-gc test-script.js

// In script:
for (let i = 0; i < 100; i++) {
  await extractPreview(filePath);
  if (i % 10 === 0) {
    global.gc();
    console.log('Memory:', process.memoryUsage());
  }
}
```

**Solutions**:
1. **Force garbage collection** periodically
2. **Process files in smaller batches**
3. **Use synchronous API** for better control

### File Handle Leaks

**Symptoms**: "Too many open files" error on Unix systems.

**Solutions**:
1. **Check file handle limits**:
   ```bash
   ulimit -n
   ```

2. **Increase limits**:
   ```bash
   ulimit -n 4096
   ```

3. **Process files sequentially** instead of parallel

## Platform-Specific Issues

### Windows

#### Long Path Issues
**Error**: File paths longer than 260 characters fail.

**Solutions**:
1. **Enable long path support**:
   ```cmd
   # Run as Administrator
   New-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem" -Name "LongPathsEnabled" -Value 1 -PropertyType DWORD -Force
   ```

2. **Use UNC paths**:
   ```typescript
   const longPath = '\\\\?\\' + path.resolve(filePath);
   ```

#### Unicode File Names
**Problem**: Files with non-ASCII characters fail to load.

**Solution**: The library automatically handles Unicode on Windows.

### macOS

#### Code Signing Issues
**Error**: "cannot be opened because the developer cannot be verified"

**Solutions**:
1. **Allow in System Preferences**: Security & Privacy → General → Allow
2. **Remove quarantine attribute**:
   ```bash
   xattr -dr com.apple.quarantine node_modules/raw-preview-extractor
   ```

#### ARM64 vs x64 Issues
**Error**: Architecture mismatch on Apple Silicon Macs.

**Solutions**:
1. **Use Universal binaries** (automatically handled)
2. **Force architecture**:
   ```bash
   arch -x86_64 npm install  # Force x64
   arch -arm64 npm install   # Force ARM64
   ```

### Linux

#### Missing Shared Libraries
**Error**: `error while loading shared libraries`

**Solutions**:
1. **Check dependencies**:
   ```bash
   ldd node_modules/raw-preview-extractor/build/Release/raw_extractor.node
   ```

2. **Install missing packages**:
   ```bash
   # Ubuntu/Debian
   sudo apt-get install libc6-dev libstdc++6
   
   # CentOS/RHEL
   sudo yum install glibc-devel libstdc++
   ```

#### GLIBC Version Issues
**Error**: `version 'GLIBC_X.XX' not found`

**Solutions**:
1. **Check GLIBC version**:
   ```bash
   ldd --version
   ```

2. **Use older Node.js version** or rebuild from source

## Debugging Tips

### Enable Debug Logging

```typescript
// Set environment variable for detailed logs
process.env.NODE_DEBUG = 'raw-extractor';

// Or use console logs
const result = await extractPreview(filePath, options);
console.log('Full result:', JSON.stringify(result, null, 2));
```

### Test with Simple Cases

```typescript
// Test with minimal options first
const result = await extractPreview(filePath, {
  timeout: 30000,
  strictValidation: false
});
```

### Isolate the Problem

1. **Test different file formats**
2. **Test with different file sizes**  
3. **Test on different systems**
4. **Compare with working files**

### Check System Resources

```bash
# Check available memory
free -h  # Linux
vm_stat  # macOS
systeminfo | find "Available Physical Memory"  # Windows

# Check disk space
df -h    # Unix
dir      # Windows

# Check CPU usage
top      # Unix
taskmgr  # Windows
```

## Getting Help

### Before Reporting Issues

1. **Update to latest version**:
   ```bash
   npm update raw-preview-extractor
   ```

2. **Check existing issues** on GitHub

3. **Test with sample files** to isolate the problem

4. **Gather system information**:
   ```bash
   node --version
   npm --version
   uname -a  # Unix
   systeminfo | findstr "OS Name OS Version"  # Windows
   ```

### Reporting Issues

Include the following information:

1. **Environment**:
   - Operating system and version
   - Node.js version  
   - Package version
   - Electron version (if applicable)

2. **Error details**:
   - Complete error message
   - Stack trace
   - Steps to reproduce

3. **Sample code** that demonstrates the issue

4. **File information**:
   - RAW format (CR2, NEF, etc.)
   - File size
   - Camera model (if relevant)

### Community Resources

- **GitHub Issues**: For bugs and feature requests
- **GitHub Discussions**: For questions and help
- **Stack Overflow**: Tag questions with `raw-preview-extractor`

### Temporary Workarounds

If you encounter blocking issues:

1. **Use alternative libraries** as fallback
2. **Implement retry logic** for transient errors  
3. **Process problematic files manually**
4. **Use different quality settings** or options

### Performance Monitoring

```typescript
// Add performance monitoring
const startTime = process.hrtime.bigint();
const startMemory = process.memoryUsage();

const result = await extractPreview(filePath, options);

const endTime = process.hrtime.bigint();
const endMemory = process.memoryUsage();

console.log({
  duration: Number(endTime - startTime) / 1000000, // ms
  memoryDelta: endMemory.heapUsed - startMemory.heapUsed,
  success: result.success
});
```

This troubleshooting guide covers most common issues. If you encounter problems not listed here, please consider contributing to this document or reporting the issue on GitHub.