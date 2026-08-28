#!/usr/bin/env bash
# Builds password-vault-store.zip for Chrome Web Store upload.
set -e
cd "$(dirname "$0")"
OUT="password-vault-store.zip"
rm -f "$OUT"
tar -a -c -f "$OUT" \
  manifest.json background.js cloud.js content.js popup.html popup.js \
  icons Password-Vault-User-Guide.docx
echo "built $OUT"
