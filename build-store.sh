#!/usr/bin/env bash
# Builds password-vault-store.zip for Chrome Web Store upload.
# Strips the "key" field (the Web Store assigns its own item ID).
set -e
cd "$(dirname "$0")"
python - <<'PY'
import json, zipfile, pathlib
m = json.loads(pathlib.Path("manifest.json").read_text())
m.pop("key", None)
files = ["background.js","cloud.js","content.js","popup.html","popup.js",
        "Password-Vault-User-Guide.docx",
        "icons/icon16.png","icons/icon48.png","icons/icon128.png"]
with zipfile.ZipFile("password-vault-store.zip","w",zipfile.ZIP_DEFLATED) as z:
    z.writestr("manifest.json", json.dumps(m, indent=2))
    for f in files:
        z.write(f, f)
print("built password-vault-store.zip")
PY
