#!/bin/bash
# ============================================================
# RaceTagger v1.2.0 - Legacy File Cleanup Script
# ============================================================
# Removes files that were deprecated in v1.2.0:
# - dcraw binary and backup
# - dcraw installer script
# - ImageMagick setup script
# - SQLite database migration file
# - dcraw macOS install script
#
# Run from the racetagger-clean root directory:
#   chmod +x scripts/cleanup-legacy-files.sh
#   ./scripts/cleanup-legacy-files.sh
# ============================================================

set -e

echo "🧹 RaceTagger v1.2.0 - Legacy File Cleanup"
echo "============================================"
echo ""

# Files to delete
FILES_TO_DELETE=(
  "src/utils/dcraw-installer.ts"
  "src/database-migration.ts"
  "scripts/install-dcraw-mac.sh"
  "scripts/setup-imagemagick-windows.ps1"
  "vendor/darwin/dcraw"
  "vendor/darwin/dcraw.backup"
)

DELETED=0
SKIPPED=0

for file in "${FILES_TO_DELETE[@]}"; do
  if [ -f "$file" ]; then
    rm -f "$file"
    echo "  ✅ Deleted: $file"
    ((DELETED++))
  else
    echo "  ⏭️  Already gone: $file"
    ((SKIPPED++))
  fi
done

echo ""
echo "============================================"
echo "  Deleted: $DELETED files"
echo "  Already gone: $SKIPPED files"
echo "============================================"
echo ""
echo "Next steps:"
echo "  git add -A"
echo "  git commit -m 'chore: remove legacy dcraw, ImageMagick, SQLite files (v1.2.0 cleanup)'"
echo ""
