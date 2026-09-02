# Password Vault — User Guide

**Version 3.15 · Built by Tengku Mohamad Syafiz**

---

## 1. Overview

Password Vault is a lightweight, keyboard-driven password manager for Chrome, built for developers. It saves website logins, finds the right one by URL, and auto-fills the sign-in form. It also captures new logins as you submit them, stores TOTP (2FA) secrets, and can optionally sync an end-to-end encrypted copy of your vault across your devices.

| | |
|---|---|
| Extension name | Password Vault |
| Version | 3.15 |
| Platform | Google Chrome (Manifest V3) |
| Storage | Your browser only — `chrome.storage.local`. Optional sync uses `chrome.storage.sync` (encrypted). |
| Accounts / servers | None. There is no sign-up and no backend service. |

---

## 2. Installation

### 2.1 Install from the Chrome Web Store
1. Open the Password Vault listing on the Chrome Web Store.
2. Click **Add to Chrome**, then **Add extension**.
3. Click the puzzle-piece icon in the toolbar and pin Password Vault for quick access.

### 2.2 Install unpacked (development)
1. Download and extract the extension folder.
2. Open `chrome://extensions` and enable **Developer mode** (top-right).
3. Click **Load unpacked** and select the extracted folder.

To update an unpacked install, replace the folder contents and click the reload icon on `chrome://extensions`. If a change does not take effect, remove the extension and load it again — Chrome caches service workers aggressively.

---

## 3. Interface Overview

Click the toolbar icon to open the popup. It has three top tabs:

| Tab | Contents |
|---|---|
| **Vault** | All saved credentials, grouped into folders, with search and match badges for the current page. |
| **+ Add** | Form to add a credential manually. Split into **Main** and **Options** sub-tabs. |
| **Config** | Settings, split into **General**, **Security**, **Data** and **About** sub-tabs. |

The top-right of the popup has a Sun/Moon button to switch between dark (default) and light theme. The choice is saved.

---

## 4. Vault Tab

### 4.1 Search and sort
The search box filters credentials in real time by label, URL or username. Press **Esc** while the Vault tab is focused to clear the search. The **A–Z / Z–A** button toggles the sort direction; the setting is saved.

### 4.2 Folders
Credentials are grouped under the folders you create (**Config → Data → Folders**). A new install starts with no folders; anything without a folder appears under *Ungrouped*. Click a folder header to collapse or expand that group — the state is remembered. A folder that contains a match for the current page is floated to the top and force-opened.

### 4.3 Credential cards
Each credential is a card showing the label, last-login line, URL, username, masked password and selector pills. Click the card header to collapse or expand it; the state is saved per card.

**Card badges**

| Badge | Meaning |
|---|---|
| ● EXACT | The current tab URL matches this credential exactly (origin + path). |
| ● MATCH | The current tab URL matches this credential by prefix. |
| captured | This credential was auto-captured from a login form. |
| +N extra | This credential fills N additional fields (company code, branch ID, etc.). |
| LOCKED | Auto-fill is blocked for this URL after too many failed attempts. |
| N/N attempts | Warning — approaching the failed-attempt limit. |

**Card buttons**

| Button | Action |
|---|---|
| User | Copies the username to the clipboard. |
| Pass | Copies the password. Prompts for the Master PIN if PIN protect is on for this entry. The clipboard is cleared after 20 seconds and when the popup closes. |
| Fill | Injects the credential into the current page. Shown only when the URL matches and the entry is not locked. |
| Unlock | Clears the failed-attempt lockout for this URL. Shown only when locked. |
| 🕐 | Opens the login history for this credential (up to 100 entries, with OK / FAIL status). |
| ✏ | Opens the Edit modal. |
| ✕ | Deletes the credential (with confirmation). |

### 4.4 Keyboard navigation
With the Vault tab open you can drive the list from the keyboard:

| Key | Action |
|---|---|
| ↓ / ↑ | Move the highlight through the visible credential cards. |
| Enter | Fill the highlighted card (if it matches the current page), otherwise expand / collapse it. |
| Esc | Clear the search box. |

### 4.5 Field highlight (hover)
Hovering the **User** button glows the username field on the page cyan; hovering **Pass** glows the password field amber, so you can confirm which inputs will be filled.

---

## 5. Add Tab — Registering Credentials

### 5.1 Main sub-tab

| Field | Notes |
|---|---|
| Site label | Friendly name (e.g. "Work Email"). Defaults to the domain if left blank. |
| URL | The login page URL. Pre-filled with the current tab. |
| Username | Username or email address. |
| Password | A strength meter (WEAK / FAIR / STRONG / EXCELLENT) appears once you start typing. Use the dice button to generate a strong password. |
| Folder | Optional. Choose one of your folders or leave as Ungrouped. |

### 5.2 Options sub-tab

| Field | Notes |
|---|---|
| Field selectors | Tell the extension exactly which inputs to target. Leave blank for auto-detection. Formats: `name:fieldname`, `#elementId`, `.className`, or any CSS selector. |
| Extra fields | Add Label / Selector / Value rows for forms that need more than username + password. Filled automatically during auto-fill. |
| 2FA secret (TOTP) | Paste the `otpauth` secret or key. See section 6. |
| Notes | Free-text notes. |
| Per-entry behaviour | Override the global Auto-fill / Auto-submit setting for this one credential. |

---

## 6. TOTP (Two-Factor) Codes

If you store a 2FA secret with a credential, the card shows a live 6-digit code with a countdown and a copy button. Codes refresh every second and follow the standard 30-second TOTP window. The secret is stored the same way as the password (locally, and inside the encrypted blob when sync or local encryption is on).

---

## 7. Auto-Capture

When Auto-capture is on, Password Vault watches login pages. After you submit a login and the submission looks successful (URL change, form removed, or button disabled), a capture banner appears in the popup listing every detected field. Click **Save** to store it or **Dismiss** to ignore.

Supported form types: standard HTML forms, "broken" forms with inputs outside the `<form>` tag, AJAX / no-form pages, and pages that render the login box after a short delay.

---

## 8. Auto-Fill

### 8.1 Automatic
On a page that matches a saved URL, the username and password are filled after a short delay, with a toast confirmation (if *Show fill notification* is on). Automatic fill only runs when *Auto-fill on match* is on, and never on a URL that is currently locked.

### 8.2 Manual
Click **Fill** on a matching card, or press **Ctrl+Shift+L** (**Command+Shift+L** on macOS) to fill the current page without opening the popup. Rebind it at `chrome://extensions/shortcuts`.

### 8.3 Auto-submit
When *Auto-submit form* is on, the login button is clicked after filling. When off, the fields are filled only.

### 8.4 Lockout
Each failed auto-fill on a URL increments a counter. At the limit (**Config → General → Max auto-login attempts**, default 5) auto-fill locks for that URL: the card shows LOCKED and Fill is replaced by Unlock. Clear it from the card, or from **Config → Security → Lockout Status**.

---

## 9. Editing Credentials

Click the pencil icon on a card to open the Edit modal. Every field can be changed, including selectors, extra fields and the folder.

### 9.1 Password reveal

| State | Behaviour |
|---|---|
| No Master PIN set | Eye button is a plain show / hide toggle. |
| PIN set, PIN protect ON | Click the lock icon, enter the PIN, password is shown. Click again to hide. |
| PIN set, PIN protect OFF | Plain toggle, no PIN needed for this entry. |

### 9.2 PIN protect toggle
Each credential has its own PIN protect toggle (top-right of the password field), on by default. When on, the PIN is required to view or copy that password. Turning it off requires entering the PIN first. The toggle is greyed out until a Master PIN is set.

---

## 10. Config → General

### 10.1 Cloud Sync (optional, off by default)
Cloud Sync keeps an encrypted copy of your vault in sync across the devices signed in to the same Chrome profile. There is no account and no server.

1. Open **Config → General → Cloud Sync**.
2. Enter a **sync passphrase** (at least 10 characters) and click **Enable sync**.
3. On your other device, install the extension, open the same screen and enter the **same passphrase**.

- Your vault is encrypted on the device with a key derived from the passphrase (PBKDF2 → AES-GCM). The passphrase and key never leave the device.
- Only ciphertext is stored, in `chrome.storage.sync`. Chrome replicates it (you must have Chrome Sync enabled in the browser).
- If both devices already have credentials when you enable sync, you are asked to **Use cloud**, **Merge both**, or **Keep mine**.
- Use **Disable sync** to stop syncing on a device. If you lose the passphrase, the synced data cannot be recovered.
- Practical size limit: roughly 90 KB of encrypted data (about 100–150 typical credentials). Beyond that, use JSON export / import.

### 10.2 Behaviour

| Setting | Effect |
|---|---|
| Auto-fill on match | Fill credentials when the browser opens a matching URL. |
| Auto-capture login | Show the capture banner after a successful login. |
| Auto-submit form | Click the submit button after filling. Off = fill only. |
| Show fill notification | Toast on the page when credentials are injected. |
| Max auto-login attempts | Failed auto-fills per URL before locking (1–99, default 5). |

---

## 11. Config → Security

| Setting | Effect |
|---|---|
| Auto-lock | Re-ask the Master PIN and lock cloud sync after N idle minutes (0–120; 0 = never). |
| Lock now | Immediately locks: clears the PIN grace period, the in-memory sync key, and (if local encryption is on) the decrypted vault. |
| Master PIN | Set a 6-digit PIN. Once saved it cannot be viewed. It gates password copy / reveal, JSON export, and disabling PIN protect. |
| PIN recovery | Download a one-time recovery code. If you forget the PIN, use the code to remove it **without wiping the vault**. |
| Reset & Wipe | Removes the Master PIN **and** deletes every credential. No recovery. Export first. |
| Encrypt local vault | Stores passwords as ciphertext on this device, unlocked by a passphrase. A backup is downloaded first. Auto-fill and the vault list only work while unlocked. |

The Master PIN is a screen-peek deterrent stored in extension settings, not full encryption. For encryption at rest, turn on **Encrypt local vault**.

---

## 12. Config → Data

| Item | Notes |
|---|---|
| Folders | Create, rename, recolour and delete folders. Deleting a folder moves its credentials to Ungrouped. |
| Password Health | Scan for weak, reused or old passwords. Tap a result to jump to that credential. |
| Export vault.json | Download all credentials and folders as JSON. Requires the PIN if one is set. |
| Import vault.json | Merge credentials from a previous export. Newer entries win; duplicates are not doubled. |
| Import CSV | Import from Chrome, Bitwarden and other managers that export CSV. |
| Wipe Vault | Delete all credentials (with confirmation). The Master PIN is kept. |

---

## 13. Config → About

Shows the version, credit, and links: Instagram, LinkedIn, and a *Buy me a coffee* link if you would like to support development. The extension is free, has no ads and no account.

---

## 14. Clipboard Safety

When you copy a password or a 2FA code, Password Vault clears it from the clipboard after 20 seconds, and also as soon as the popup closes — but only if the clipboard still holds the value it copied.

---

## 15. Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| Ctrl+Shift+L (⌘+Shift+L) | Fill the saved login for the current page. |
| ↓ / ↑ | Move through the vault list (Vault tab). |
| Enter | Fill or expand the highlighted card. |
| Esc | Clear the search box. |

---

## 16. Security Model

- Credentials are stored in your browser (`chrome.storage.local`). Nothing is sent to any server.
- Cloud Sync stores only AES-GCM ciphertext in `chrome.storage.sync`. The key is derived from your passphrase and never leaves the device.
- *Encrypt local vault* applies the same client-side encryption to the copy stored on disk.
- The Master PIN gates access in the UI but is not itself an encryption key.
- *Reset & Wipe* and losing a sync/encryption passphrase are unrecoverable. Keep JSON exports as backups.

---

## 17. Troubleshooting

| Problem | Fix |
|---|---|
| Auto-fill not working | Check *Auto-fill on match* is on. Reload the page. If the card shows LOCKED, clear it. |
| Capture banner not appearing | Check *Auto-capture* is on. Some sites need you to navigate away and back. |
| Fill failed | The form was found but fields could not be set. Edit the credential and add explicit selectors (Options sub-tab). |
| Notification on an already-signed-in page | The saved URL is too broad. Narrow it to include the `/login` path. |
| Sync not reaching another device | Both devices must be signed in to the same Chrome profile with Chrome Sync enabled, and use the same passphrase. |
| Service worker error | Remove and reload the extension rather than only clicking reload. |

---

## 18. Version History (recent)

| Version | Changes |
|---|---|
| 3.15 | Cloud Sync rewritten to serverless, end-to-end encrypted `chrome.storage.sync` (no server, no account, no Google login). Default folders removed. |
| 3.14 | Clipboard auto-clear, debounced search, auto-lock on popup close, vault keyboard navigation, faster list rendering. |
| 3.13 | Config split into General / Security / Data sub-tabs. |
| 3.12 | About section added; folder picker moved into the Add form; strength meter hidden until typing. |
| 3.11 | Add form split into Main / Options sub-tabs. |
| 3.10 | Opt-in local vault encryption. |
| 3.9 | TOTP (2FA) codes and one-time PIN recovery code. |

---

*Password Vault · Built by Tengku Mohamad Syafiz · developer.kufiz@gmail.com*
