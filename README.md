# 🔐 Password Vault — Chrome Extension

A developer-grade password manager Chrome extension with a dark terminal aesthetic.

## Features
- **Vault** — Store credentials keyed to exact URLs
- **Folders** — Group credentials (PRD / UAT / DEV by default, renameable & custom), each with its own colour
- **Auto-fill** — Injects username/password when you navigate to a matching URL
- **Auto-submit** — Optionally clicks the login button after filling
- **Password strength meter** — Visual indicator on entry
- **Search** — Filter credentials instantly
- **Export/Import** — vault.json backup
- **Dark dev theme** — JetBrains Mono, scanlines, terminal glows

## Install in Chrome

1. Unzip / open this folder
2. Open Chrome → navigate to `chrome://extensions`
3. Enable **Developer Mode** (top-right toggle)
4. Click **Load unpacked**
5. Select the `password-vault` folder
6. The extension icon appears in your toolbar

## Usage

### Add a credential
1. Click the extension icon on any login page
2. Go to **+ Add** tab
3. The URL is pre-filled from the active tab
4. Enter your username, password, optional notes
5. Click **Encrypt & Store**

### Auto-fill
- When you navigate to a saved URL, credentials are auto-injected (if enabled in **Config**)
- Or click the extension → **Vault** → **⚡ Fill** button on the matching entry

### Export / Import
- **Config** tab → Export `vault.json` (plain JSON, back it up safely!)
- Import a previously exported file to merge entries

## File Structure
```
password-vault/
├── manifest.json      # Extension config (Manifest V3)
├── popup.html         # Main UI
├── popup.js           # Popup logic
├── content.js         # Injected into pages for auto-fill
├── background.js      # Service worker for tab monitoring
└── icons/             # Extension icons
```

## Security Notes
> Passwords are stored in **Chrome's local storage** (chrome.storage.local),  
> which is sandboxed to the extension and not accessible by websites.  
> This is NOT encrypted at rest — treat your exported vault.json as sensitive.
