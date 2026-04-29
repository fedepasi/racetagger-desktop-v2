#!/usr/bin/env bash
# Manual macOS build pipeline with retry logic on codesign timestamp failures.
# Workaround for intermittent timestamp server issues that break electron-builder.
#
# Usage: bash scripts/build-mac-manual.sh [arm64|x64]

set -euo pipefail

ARCH="${1:-arm64}"
APP_DIR="release/mac-${ARCH}"
APP="${APP_DIR}/RaceTagger.app"
IDENTITY="FEDERICO PASINETTI (MNP388VJLQ)"
ENTITLEMENTS="node_modules/app-builder-lib/templates/entitlements.mac.plist"
VERSION=$(node -p "require('./package.json').version")
DMG="release/RaceTagger-${VERSION}-${ARCH}.dmg"
ZIP="release/RaceTagger-${VERSION}-${ARCH}-mac.zip"
PRODUCT_NAME="RaceTagger"

# Load Apple credentials from .env
set -a; source .env; set +a

if [ -z "${APPLE_ID:-}" ] || [ -z "${APPLE_APP_SPECIFIC_PASSWORD:-}" ] || [ -z "${APPLE_TEAM_ID:-}" ]; then
  echo "❌ Missing Apple credentials (APPLE_ID / APPLE_APP_SPECIFIC_PASSWORD / APPLE_TEAM_ID)"
  exit 1
fi

# ─────────────────────────────────────────────────────────────────────────────
# Helper: codesign with retry on timestamp failures
# ─────────────────────────────────────────────────────────────────────────────
codesign_retry() {
  local file="$1"
  local max=4
  local i=1
  local err
  while [ $i -le $max ]; do
    err=$(codesign --sign "$IDENTITY" --force --timestamp --options runtime \
                   --entitlements "$ENTITLEMENTS" "$file" 2>&1) && return 0
    if echo "$err" | grep -q "timestamp was expected"; then
      echo "    [retry $i/$max] timestamp flake on $(basename "$file")" >&2
      sleep $((i * 2))
      i=$((i + 1))
    else
      echo "$err" >&2
      return 1
    fi
  done
  echo "    ❌ Persistent timestamp failure on $file" >&2
  return 1
}

count=0
total=0

sign_file() {
  count=$((count + 1))
  printf "  [%d/%d] %s\n" "$count" "$total" "${1#$APP/}"
  codesign_retry "$1"
}

# ─────────────────────────────────────────────────────────────────────────────
# 1. Compile + validate native deps
# ─────────────────────────────────────────────────────────────────────────────
echo "═══ 1/7 Compile TypeScript ═══"
npx tsc

echo "═══ 2/7 Validate native dependencies ═══"
node scripts/validate-native-deps.js --platform=darwin --arch="${ARCH}"

# ─────────────────────────────────────────────────────────────────────────────
# 2. Run electron-builder to produce the unsigned .app (target=dir)
# ─────────────────────────────────────────────────────────────────────────────
echo "═══ 3/7 Pack app (electron-builder, no signing) ═══"
rm -rf "${APP_DIR}"
# Run with APPLE_* vars cleared so afterSign hook (notarize.js) skips early.
env -u APPLE_ID -u APPLE_ID_PASS -u APPLE_APP_SPECIFIC_PASSWORD -u APPLE_TEAM_ID \
  npx electron-builder --mac --"${ARCH}" \
    --config.mac.identity=null \
    --config.mac.target=dir

if [ ! -d "$APP" ]; then
  echo "❌ Pack failed: $APP not found"
  exit 1
fi

# ─────────────────────────────────────────────────────────────────────────────
# 3. Manual codesign with retry. Order matters: deepest first.
# ─────────────────────────────────────────────────────────────────────────────
echo "═══ 4/7 Codesign (with retry on timestamp flakes) ═══"

# Build the list of files to sign in correct bottom-up order.
# Strategy: walk find -depth so children come before parents naturally.
# bash 3.2 compatible (no mapfile).
TMP_LIST=$(mktemp)
{
  # All Mach-O binaries (dylib / .so / .node / executables)
  find "$APP" -depth -type f \
    \( -name "*.dylib" -o -name "*.so" -o -name "*.node" \) \
    -not -path "*/_CodeSignature/*"
  # All Mach-O executables (exec bit) — detect via `file`
  find "$APP" -depth -type f -perm +111 -not -path "*/_CodeSignature/*" | while read -r f; do
    if file "$f" 2>/dev/null | grep -q "Mach-O"; then echo "$f"; fi
  done
  # Helper apps and frameworks (in -depth order)
  find "$APP/Contents/Frameworks" -depth -type d \
    \( -name "*.app" -o -name "*.framework" \)
} | awk '!seen[$0]++' > "$TMP_LIST"

total=$(wc -l < "$TMP_LIST" | tr -d ' ')
echo "Will sign $total entries"

while IFS= read -r f; do
  [ -z "$f" ] && continue
  sign_file "$f"
done < "$TMP_LIST"
rm -f "$TMP_LIST"

# Finally sign the main .app bundle
echo "═══ 5/7 Sign main bundle ═══"
codesign_retry "$APP"
echo "✅ Main bundle signed"

# Verify
echo "═══ Verify signature ═══"
codesign --verify --deep --strict --verbose=2 "$APP" 2>&1 | tail -10
spctl -a -vvv --type execute "$APP" 2>&1 || echo "(spctl warning expected before notarization)"

# ─────────────────────────────────────────────────────────────────────────────
# 4. Submit to Apple notary service
# ─────────────────────────────────────────────────────────────────────────────
echo "═══ 6/7 Notarize ═══"
NOTARIZE_ZIP="release/notarize-${VERSION}-${ARCH}.zip"
ditto -c -k --keepParent "$APP" "$NOTARIZE_ZIP"
echo "Submitting to Apple (this can take 2-15 min)..."
xcrun notarytool submit "$NOTARIZE_ZIP" \
  --apple-id "$APPLE_ID" \
  --password "$APPLE_APP_SPECIFIC_PASSWORD" \
  --team-id "$APPLE_TEAM_ID" \
  --wait
rm -f "$NOTARIZE_ZIP"

echo "═══ Staple ═══"
xcrun stapler staple "$APP"
xcrun stapler validate "$APP"

# ─────────────────────────────────────────────────────────────────────────────
# 5. Create DMG and ZIP from stapled .app
# ─────────────────────────────────────────────────────────────────────────────
echo "═══ 7/7 Create DMG + ZIP ═══"
rm -f "$DMG" "$ZIP" "${DMG}.blockmap" "${ZIP}.blockmap"

# DMG via hdiutil
TMP_DMG_DIR=$(mktemp -d)
cp -R "$APP" "$TMP_DMG_DIR/"
ln -s /Applications "$TMP_DMG_DIR/Applications"
hdiutil create -volname "$PRODUCT_NAME" -srcfolder "$TMP_DMG_DIR" -ov -format UDZO -fs HFS+ "$DMG"
rm -rf "$TMP_DMG_DIR"

# Sign DMG
codesign_retry "$DMG"

# DMG has its own hash → separate notarization required (the .app ticket
# is only for the .app's hash; stapling the DMG would fail otherwise).
echo "Notarizing DMG..."
xcrun notarytool submit "$DMG" \
  --apple-id "$APPLE_ID" \
  --password "$APPLE_APP_SPECIFIC_PASSWORD" \
  --team-id "$APPLE_TEAM_ID" \
  --wait
xcrun stapler staple "$DMG"

# ZIP from stapled .app — no separate notarization needed.
ditto -c -k --keepParent "$APP" "$ZIP"

echo ""
echo "═══════════════════════════════════════════════════════════════════"
echo "✅ Build complete:"
ls -lh "$DMG" "$ZIP"
echo "═══════════════════════════════════════════════════════════════════"
