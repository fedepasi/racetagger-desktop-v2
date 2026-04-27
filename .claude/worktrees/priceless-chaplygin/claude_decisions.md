# RaceTagger Architectural Decisions

## Build & Distribution

### DECISION-001: ARM64-Only Distribution for v1.0.10
**Date:** 2025-10-20
**Context:** Need to release production build with Apple notarization

**Decision:**
Focus on ARM64 (Apple Silicon) architecture only for initial v1.0.10 release.

**Rationale:**
1. ARM64 build completes successfully with full notarization
2. x64 build encounters entitlements errors during code signing
3. Majority of modern Mac users have Apple Silicon (M1/M2/M3)
4. x64 Intel Mac support can be added in future release if needed
5. Reduces build complexity and time-to-market

**Implications:**
- Users with Intel Macs will need to wait for x64 support
- Simpler build process with `--mac --arm64` flag
- Smaller release artifacts (one architecture vs. two)
- Faster notarization process

**Alternatives Considered:**
- Universal binary (both architectures) - rejected due to x64 build failures
- x64 only - rejected as ARM64 is the future and current standard

---

### DECISION-002: signIgnore Pattern for Cross-Platform Vendor Files
**Date:** 2025-10-19
**Context:** Windows vendor files causing macOS code signing failures

**Decision:**
Use simple directory exclusion pattern "vendor/win32" in signIgnore array instead of glob patterns.

**Rationale:**
1. electron-builder doesn't support complex glob patterns in signIgnore
2. Simple path-based exclusion is more reliable
3. Entire vendor/win32 directory contains only Windows-specific files
4. No risk of excluding macOS-needed files

**Implementation:**
```json
"signIgnore": [
  "vendor/darwin/lib/Image/ExifTool/Geolocation.dat",
  "vendor/darwin/lib/Image/ExifTool/*.dat",
  "vendor/win32"
]
```

**Alternatives Considered:**
- Glob pattern "vendor/win32/**/*" - rejected, causes regex errors
- Per-file exclusions - rejected, too verbose and maintenance-heavy
- Separate build configurations - rejected, adds complexity

---

### DECISION-003: Hardened Runtime with Entitlements
**Date:** 2025-10-18
**Context:** macOS Gatekeeper and notarization requirements

**Decision:**
Enable hardened runtime with specific entitlements for JIT, unsigned memory, and library validation.

**Entitlements:**
```xml
<key>com.apple.security.cs.allow-jit</key>
<key>com.apple.security.cs.allow-unsigned-executable-memory</key>
<key>com.apple.security.cs.disable-library-validation</key>
```

**Rationale:**
1. Required for Electron apps with native modules
2. Sharp.js and better-sqlite3 need unsigned executable memory
3. JIT needed for V8 JavaScript engine
4. Library validation disabled for dynamic native module loading

**Security Considerations:**
- These are standard entitlements for Electron apps
- All code is still signed and notarized by Apple
- Native modules are from trusted sources (npm packages)

---

### DECISION-004: Post-Build Native Module Fixes
**Date:** 2025-10-17
**Context:** Sharp.js and RAW-ingest modules not loading in packaged app

**Decision:**
Implement post-build script (scripts/post-pack-fixes.js) to fix native module symlinks and permissions.

**Implementation:**
- Run after electron-builder packaging
- Create Sharp.js symlinks for correct architecture
- Set executable permissions on native binaries
- Verify module structure and dependencies

**Rationale:**
1. electron-builder doesn't always handle native modules correctly
2. Sharp.js requires specific symlink structure for libvips
3. RAW-ingest needs proper architecture-specific binaries
4. Post-build fixes ensure consistent behavior

**Maintenance:**
- Script runs automatically via afterPack hook
- Easy to extend for additional native modules
- Provides detailed logging for debugging

---

## Code Organization

### DECISION-005: Vendor Directory Structure
**Date:** 2025-10-15
**Context:** Cross-platform ExifTool and native dependencies

**Decision:**
Maintain platform-specific vendor directories:
- vendor/darwin/ - macOS binaries
- vendor/win32/ - Windows binaries
- vendor/linux/ - Linux binaries (future)

**Rationale:**
1. Clear separation of platform-specific files
2. Easy to exclude from cross-platform builds
3. Matches Node.js platform naming conventions
4. Supports future Linux builds

**Build Integration:**
- All vendor directories included in electron-builder files
- Platform-specific directories excluded from code signing via signIgnore
- ASAR unpacking ensures vendor files remain accessible

---

## Future Considerations

### Potential Decision: Universal Binary Support
**Status:** Deferred
**Context:** Supporting both ARM64 and x64 in single build

**Considerations:**
- Would increase app size significantly
- x64 build currently has entitlements issues
- Limited benefit as Apple Silicon adoption is high
- Could revisit if Intel Mac support becomes critical

### Potential Decision: Windows Build Distribution
**Status:** Planned
**Context:** Windows NSIS and portable builds configured but not tested

**Considerations:**
- Windows code signing certificate needed
- Native modules (Sharp.js, better-sqlite3) need Windows rebuilding
- ExifTool already available in vendor/win32
- Market demand for Windows version unclear
