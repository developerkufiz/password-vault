# Publish to the Chrome Web Store

## 1. Build the upload file

```
bash build-store.sh
```

Produces `password-vault-store.zip` (extension files only — no server, no docs, no keys).

## 2. Register as a Chrome Web Store developer (one time)

1. Go to https://chrome.google.com/webstore/devconsole
2. Sign in with the Google account you want to own the listing.
3. Pay the **one-time $5 USD** registration fee.

## 3. Create the item

1. Dev console → **Add new item** → upload `password-vault-store.zip`.
2. After upload, the console shows the **Item ID**. Copy it.

### Fix the Google login redirect URI

The published Item ID may differ from the current unpacked ID
(`lapfpjnljamfbljfimlokofnhgpakjhc`). If it does:

1. https://console.cloud.google.com → your project → **APIs & Services →
   Credentials** → your OAuth client.
2. Under **Authorized redirect URIs**, **add**:
   `https://<ITEM_ID>.chromiumapp.org/`
   (keep the old one too — both can coexist.)
3. Save. No code change needed; `chrome.identity.getRedirectURL()` picks the
   right one automatically.

## 4. Fill the store listing

| Field | Value |
|-------|-------|
| Name | Password Vault |
| Summary | Store, retrieve, and auto-fill credentials by URL. Optional cloud sync. |
| Category | Productivity / Workflow & Planning |
| Language | English |
| Description | (below) |
| Icon | `icons/icon128.png` |
| Screenshots | 1280×800 or 640×400 PNG — at least one required. Take from the popup. |

**Description:**

```
Password Vault is a developer-focused password manager for Chrome.

• Save credentials and auto-fill them by matching the page URL
• Organize entries into folders, search instantly
• Master PIN lock with lockout protection
• Optional cloud sync so you can restore your vault on a new machine:
   – Email + master password: zero-knowledge, the server only ever sees
     encrypted data
   – Sign in with Google: convenient one-click restore
• On first sign-in, if a backup already exists you choose to use it,
  merge, or keep your local data

Your data stays on your device unless you turn on cloud sync.
```

## 5. Privacy & permissions (required)

- **Single purpose:** "Store and auto-fill website credentials."
- **Permission justifications:**
  - `storage` — save the vault locally
  - `activeTab` / `scripting` — fill the login form on the current page
  - `tabs` — read the current tab URL to match the right credential
  - `identity` — optional "Sign in with Google" for cloud sync
  - `host_permissions <all_urls>` — auto-fill must work on any site the user saves a login for
- **Data usage:** discloses that with cloud sync enabled, encrypted vault data
  (and, for Google login, the vault key) is sent to the sync server. No selling,
  no unrelated use.
- Add a **Privacy policy URL** (Chrome requires one when `identity` / remote
  data is used). A short page on GitHub Pages or a gist is fine.

## 6. Submit

**Submit for review**. Takes ~1–3 business days. After approval it's live at
`https://chromewebstore.google.com/detail/<ITEM_ID>`.

## Updating later

Bump `version` in `manifest.json`, re-run `build-store.sh`, upload the new zip
in the dev console, submit. Installed users auto-update within a few hours.
