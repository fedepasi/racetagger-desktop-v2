# RaceTagger Bug Reports

## Build Issues

### BUG-001: x64 Build Fails with Entitlements Error
**Date:** 2025-10-20
**Severity:** Medium
**Status:** Workaround implemented

**Description:**
When building for both ARM64 and x64 architectures simultaneously, the x64 build fails during code signing with error:
```
build/entitlements.mac.plist: cannot read entitlement data
```

**Impact:**
- x64 build cannot be completed
- DMG creation may be interrupted if x64 build fails after ARM64 DMG is created
- However, ARM64 build completes successfully including notarization

**Reproduction:**
1. Run `npm run build` (builds both arm64 and x64)
2. ARM64 completes successfully
3. x64 fails during code signing of locale.pak files

**Workaround:**
Build only ARM64 architecture:
```bash
npm run build -- --mac --arm64
```

**Root Cause:**
Unknown - entitlements file exists and works for ARM64 but fails for x64 build. Possibly related to Electron Framework locale files on x64 architecture.

**Notes:**
- Not critical as ARM64 is the primary target for Apple Silicon Macs
- x64 support can be added later if needed for Intel Macs

---

### BUG-002: Windows DLL Files Included in macOS Code Signing
**Date:** 2025-10-19
**Severity:** High
**Status:** Fixed

**Description:**
electron-builder attempted to sign Windows .dll files from `vendor/win32/` directory during macOS build, causing build failure.

**Error Message:**
```
Command failed: codesign --sign [...] vendor/win32/lib/auto/Compress/Raw/Bzip2/Bzip2.xs.dll
```

**Fix:**
Added "vendor/win32" to signIgnore array in package.json:
```json
"signIgnore": [
  "vendor/darwin/lib/Image/ExifTool/Geolocation.dat",
  "vendor/darwin/lib/Image/ExifTool/*.dat",
  "vendor/win32"
]
```

**Resolution:**
Fixed in commit [hash] - Windows vendor files now excluded from macOS code signing.

---

### BUG-003: Invalid Regex Pattern in signIgnore
**Date:** 2025-10-19
**Severity:** Low
**Status:** Fixed

**Description:**
Initial attempt to use glob pattern "vendor/win32/**/*" in signIgnore caused error:
```
Invalid regular expression: /vendor/win32/**/*/: Nothing to repeat
```

**Root Cause:**
electron-builder's signIgnore expects simple patterns, not glob wildcards with `**`

**Fix:**
Changed from `"vendor/win32/**/*"` to `"vendor/win32"` - simpler pattern works correctly.

---

## Runtime Issues

None reported in this session.

---

## Known Limitations

### RAW-ingest Module Load Warning
**Status:** Non-critical warning

**Description:**
Post-build test shows warning for x64 build:
```
⚠️ [RAW-ingest Fix] Module load test failed
⚠️ [RAW-ingest Fix] App may fall back to dcraw at runtime
```

**Impact:**
- ARM64 build: RAW-ingest module loads successfully
- x64 build: May fall back to dcraw (acceptable fallback)
- No runtime impact for ARM64 (primary target)

**Notes:**
This is expected behavior for the x64 build and doesn't affect ARM64 functionality.
