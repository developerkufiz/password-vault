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
Password Vault is a fast, keyboard-driven password manager built for developers.

WHAT IT DOES
• Save any login (site, URL, username, password, notes) and find it instantly by name or URL.
• Auto-fills the matching credential on the right page — or press Ctrl+Shift+L to fill without opening the popup.
• Right-click any page to fill a login, or right-click a field to generate a strong password into it.
• The toolbar icon shows how many logins you have saved for the site you're on.
• Detects successful logins and offers to save new credentials automatically.
• Changed a password? Log in with the new one and it offers to update the saved login.
• Stops auto-filling a saved password that keeps failing (for example an expired one) and tells you on the page.
• Password history keeps the last 5 passwords of each login, so you can restore an old one.
• Built-in password generator, a strength / reuse health report, and an on-demand breach check.
• TOTP (2FA) codes stored alongside the login and copied with one click.
• Organise entries into your own colour-coded folders.
• Ignore sites where you never want auto-fill or save prompts.
• Keyboard navigation in the vault list (arrow keys, Enter to fill).
• CSV import from Chrome, Bitwarden and other managers; encrypted JSON export for backups.

SECURITY
• Everything is stored locally in your browser by default.
• Local vault encryption, offered on first run — passwords are kept as ciphertext on disk and unlocked with a passphrase.
• Optional master PIN (stored hashed) with idle auto-lock and lockout after failed attempts.
• Breach check uses Have I Been Pwned's k-anonymity API: only the first 5 characters of a password's hash are sent, never the password.
• Clipboard is cleared automatically after copying a password.

SYNC (optional)
• Turn on end-to-end encrypted sync and your vault is mirrored across the devices signed in to your Chrome profile.
• The encryption key is derived from a passphrase that never leaves your device.
• No account to create, no server, no subscription.

WHY INSTALL IT
If you live in the browser and want a lightweight, private password manager that fills logins by URL, works from the keyboard, and never forces you into a cloud account — Password Vault stays out of your way.
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
