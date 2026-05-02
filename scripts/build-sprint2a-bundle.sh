#!/usr/bin/env bash
# Sprint 2a bundle builder. Edit-tool path so excludes are written here, not via heredoc.
set -e
OUT="proof-bundle-sprint2a-FINAL.zip"
rm -f "$OUT"
zip -rq "$OUT" . \
  -x "node_modules/*" \
  -x ".git/*" \
  -x "dist/*" \
  -x "build/*" \
  -x ".next/*" \
  -x "coverage/*" \
  -x ".replit_cache/*" \
  -x ".cache/*" \
  -x "attached_assets/*" \
  -x "uploads/*" \
  -x ".local/*" \
  -x "tmp/*" \
  -x "backups/*" \
  -x "screenshots/*" \
  -x ".config/*" \
  -x ".canvas/*" \
  -x "*.zip" \
  -x "*.log"
echo "size:"
ls -lh "$OUT" | awk '{print $5, $9}'
echo "size_bytes:"
stat -c '%s' "$OUT"
