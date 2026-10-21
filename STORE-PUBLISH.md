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

## 4. Fill the store listing

| Field | Value |
|-------|-------|
| Name | Password Vault |
| Summary | Store, retrieve, and auto-fill credentials by URL. Optional encrypted sync. |
| Category | Productivity / Workflow & Planning |
| Language | English |
| Description | (below) |
| Icon | `icons/icon128.png` |
| Screenshots | 1280×800 or 640×400 PNG — at least one required. Take from the popup. |

> **Metadata policy:** keep the description strictly about features. No
> donation, social, "buy me a coffee", or unrelated URLs in the description,
> screenshots, or promo images — Chrome rejects those as keyword spam.
> Support/social links belong only inside the extension UI.

**Description:**

```
Password Vault is a developer-focused password manager for Chrome.

• Save credentials and auto-fill them by matching the page URL
• Organize entries into folders and search instantly
• Master PIN lock with lockout protection
• TOTP (2FA) code generation per entry
• Optional end-to-end encrypted sync to restore your vault on another
  device — protected by a separate sync passphrase; only encrypted data
  ever leaves your browser
• Import from Chrome, Bitwarden, and other CSV exports
• Local encryption of the on-device vault, offered on first run
• Password health scan, plus an on-demand breach check (Have I Been Pwned,
  k-anonymity: only a 5-character hash prefix is sent)
• Encrypted vault.json backups
• Stops auto-filling a saved password that keeps failing (e.g. expired)
  and offers to update it when you log in with the new one
• Password history: the last 5 passwords of each login, restorable
• Right-click: fill a login or generate a strong password into a field
• Toolbar badge shows how many logins are saved for the current site
• Ignore sites where you never want auto-fill or save prompts

Your data stays on your device unless you enable sync.
```

## 5. Privacy & permissions (required)

- **Single purpose:** "Store and auto-fill website credentials."
- **Permission justifications:**
  - `storage` — save the vault locally
  - `tabs` — read the current tab URL to match the right saved credential
  - `alarms` — periodic auto-lock / sync check
  - `contextMenus` — right-click "Fill saved login" / "Generate strong password here"
  - `host_permissions <all_urls>` — the content script auto-fills the login
    form on any site the user has saved a login for
- **Data usage:** with sync enabled, only an end-to-end encrypted vault blob is
  stored in `chrome.storage.sync`. No server, no plaintext, no selling, no
  unrelated use.
- **Breach check (on demand):** sends only the first 5 hex characters of each
  password's SHA-1 hash to `api.pwnedpasswords.com`. No passwords, usernames
  or URLs are sent.
- Add a **Privacy policy URL** (hosted at
  developerkufiz.github.io/password-vault/privacy-policy.html).

## 6. Submit

**Submit for review**. Takes ~1–3 business days. After approval it's live at
`https://chromewebstore.google.com/detail/<ITEM_ID>`.

## Updating later

Bump `version` in `manifest.json`, re-run `build-store.sh`, upload the new zip
in the dev console, submit. Installed users auto-update within a few hours.
