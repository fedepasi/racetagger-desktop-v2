#!/usr/bin/env bash
# Resume notarization + DMG/ZIP creation from an already-signed .app.
# Use after build-mac-manual.sh fails at the notarize step (network flake)
# but the .app is intact and signed.
#
# Usage: bash scripts/notarize-and-package.sh [arm64|x64]

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

set -a; source .env; set +a

if [ ! -d "$APP" ]; then
  echo "❌ $APP not found. Run scripts/build-mac-manual.sh first."
  exit 1
fi

# Verify signature is still valid
echo "═══ Verify existing signature ═══"
codesign --verify --deep --strict "$APP"
echo "✅ Signature OK"

# Submit with retry on network errors
echo "═══ Notarize (with retry on upload flake) ═══"
NOTARIZE_ZIP="release/notarize-${VERSION}-${ARCH}.zip"
rm -f "$NOTARIZE_ZIP"
ditto -c -k --keepParent "$APP" "$NOTARIZE_ZIP"
echo "Zip created: $(du -h "$NOTARIZE_ZIP" | cut -f1)"

attempt=1
max_attempts=4
while [ $attempt -le $max_attempts ]; do
  echo "Attempt $attempt/$max_attempts: submitting to Apple..."
  if xcrun notarytool submit "$NOTARIZE_ZIP" \
      --apple-id "$APPLE_ID" \
      --password "$APPLE_APP_SPECIFIC_PASSWORD" \
      --team-id "$APPLE_TEAM_ID" \
      --wait 2>&1 | tee /tmp/notary-out.log; then
    if grep -q "status: Accepted" /tmp/notary-out.log; then
      echo "✅ Notarization accepted"
      break
    fi
    if grep -qE "status: (Invalid|Rejected)" /tmp/notary-out.log; then
      echo "❌ Notarization rejected by Apple"
      SUB_ID=$(grep "id:" /tmp/notary-out.log | head -1 | awk '{print $NF}')
      echo "Fetching log for $SUB_ID..."
      xcrun notarytool log "$SUB_ID" \
        --apple-id "$APPLE_ID" \
        --password "$APPLE_APP_SPECIFIC_PASSWORD" \
        --team-id "$APPLE_TEAM_ID" 2>&1 | head -50
      exit 1
    fi
  fi
  echo "⚠️  Attempt $attempt failed (likely network). Backing off..."
  sleep $((attempt * 30))
  attempt=$((attempt + 1))
done

if [ $attempt -gt $max_attempts ]; then
  echo "❌ Notarization failed after $max_attempts attempts"
  exit 1
fi

rm -f "$NOTARIZE_ZIP"

echo "═══ Staple .app ═══"
xcrun stapler staple "$APP"
xcrun stapler validate "$APP"

echo "═══ Create DMG + ZIP ═══"
rm -f "$DMG" "$ZIP" "${DMG}.blockmap" "${ZIP}.blockmap"

TMP_DMG_DIR=$(mktemp -d)
cp -R "$APP" "$TMP_DMG_DIR/"
ln -s /Applications "$TMP_DMG_DIR/Applications"
hdiutil create -volname "$PRODUCT_NAME" -srcfolder "$TMP_DMG_DIR" -ov -format UDZO -fs HFS+ "$DMG"
rm -rf "$TMP_DMG_DIR"

codesign --sign "$IDENTITY" --force --timestamp "$DMG"

# DMG has its own hash → needs separate notarization (the .app ticket is for
# the .app's hash only). Submit the DMG to notary so we can staple it.
echo "═══ Notarize DMG ═══"
xcrun notarytool submit "$DMG" \
  --apple-id "$APPLE_ID" \
  --password "$APPLE_APP_SPECIFIC_PASSWORD" \
  --team-id "$APPLE_TEAM_ID" \
  --wait
xcrun stapler staple "$DMG"
xcrun stapler validate "$DMG"

# ZIP is built from the already-stapled .app — no separate notarization needed.
ditto -c -k --keepParent "$APP" "$ZIP"

echo ""
echo "═══════════════════════════════════════════════════════════════════"
echo "✅ Done:"
ls -lh "$DMG" "$ZIP"
echo "═══════════════════════════════════════════════════════════════════"
