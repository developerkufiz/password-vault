# 🔐 Password Vault — Chrome Extension

A lightweight, keyboard-driven password manager for Chrome, built for developers.
Dark terminal aesthetic. No account, no server.

**Full documentation: [USER-GUIDE.md](USER-GUIDE.md)**

## Features

- **Vault** — save logins, find them instantly by label / URL / username, with match badges for the current page
- **Folders** — group credentials into your own colour-coded folders
- **Auto-fill** — injects username / password on a matching URL, or on demand via `Ctrl+Shift+L`
- **Auto-capture** — detects successful logins and offers to save them (handles broken / AJAX / no-`<form>` pages)
- **TOTP (2FA)** — store the secret, get a live code on the card
- **Keyboard navigation** — `↑` / `↓` / `Enter` / `Esc` in the vault list
- **Master PIN** — 6-digit PIN with idle auto-lock, failed-attempt lockout, and a one-time recovery code
- **Local encryption** (opt-in) — passwords stored as AES-GCM ciphertext on disk, unlocked by a passphrase
- **Cloud Sync** (opt-in) — end-to-end encrypted, synced via `chrome.storage.sync` across your Chrome profile. No server, no account.
- **Import / export** — `vault.json` backup, plus CSV import from Chrome, Bitwarden, etc.
- **Password health** — scan for weak / reused / old passwords
- **Clipboard safety** — copied passwords are cleared after 20 s and when the popup closes
- **Dark / light theme**

## Install

### Chrome Web Store
Search for "Password Vault" and click **Add to Chrome**.

### Unpacked (development)
1. Open `chrome://extensions`
2. Enable **Developer Mode** (top-right)
3. **Load unpacked** → select this folder

## Cloud Sync

Optional and off by default. Turn it on in **Config → General → Cloud Sync** with a
passphrase (min 10 chars), then enter the **same passphrase** on your other devices.
The vault is encrypted on-device (PBKDF2 → AES-GCM); only ciphertext is stored in
`chrome.storage.sync`. The passphrase never leaves your device — lose it and the
synced copy is unrecoverable. Practical limit ≈ 90 KB (~100–150 credentials).

## File structure

```
password-vault/
├── manifest.json   # Manifest V3 config
├── popup.html      # UI + styles
├── popup.js        # popup logic
├── cloud.js        # end-to-end encrypted sync (chrome.storage.sync)
├── content.js      # page-side auto-fill / capture
├── background.js   # service worker (auto-lock alarm, tab monitoring)
├── icons/
├── USER-GUIDE.md   # full user guide
└── build-store.sh  # builds password-vault-store.zip (strips the dev key)
```

## Security notes

- Credentials live in `chrome.storage.local` — sandboxed to the extension, never sent to any server.
- The Master PIN is a UI gate, not an encryption key. For encryption at rest, enable **Encrypt local vault**.
- **Reset & Wipe**, and losing a sync / encryption passphrase, are unrecoverable — keep `vault.json` exports.

## Credits

Built by **Tengku Mohamad Syafiz** —
[Instagram](https://www.instagram.com/tengkusyafiz/) ·
[LinkedIn](https://www.linkedin.com/in/tengku-syafiz-06bb2b12a/) ·
[Buy me a coffee](https://buymeacoffee.com/tengkusyafiz)
