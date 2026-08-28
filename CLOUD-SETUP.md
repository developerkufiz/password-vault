# Cloud Sync — Setup Guide

Goal: sign in with an email + master password on any laptop and get your
credentials back. Your master password never leaves your browser; the server
only ever stores encrypted data.

```
Extension  ──>  Render (API)  ──>  TiDB Cloud (database)
```

You do this once. ~30 minutes.

---

## 1. Put the code on GitHub

1. Create a new **private** repo on GitHub, e.g. `password-vault`.
2. Push this whole `password-vault` folder to it (the extension **and** the
   `cloud-sync-server` folder live in the same repo).

```
git init
git add .
git commit -m "Password Vault + cloud sync"
git branch -M main
git remote add origin https://github.com/<you>/password-vault.git
git push -u origin main
```

---

## 2. Create the database — TiDB Cloud

1. Go to https://tidbcloud.com → sign up (free).
2. Create a **Serverless** cluster (default region is fine).
3. Open the cluster → **Connect** button.
   - Connect With: **General**
   - It shows: **Host**, **Port** (4000), **User** (looks like `xxxx.root`),
     and a generated **Password** — copy all of these somewhere safe.
4. In the cluster, open **SQL Editor** and run:
   ```sql
   CREATE DATABASE IF NOT EXISTS passwordvault;
   ```
   (The server creates its tables automatically on first start.)

---

## 3. Deploy the API — Render

1. Go to https://render.com → sign up → connect your GitHub account.
2. **New → Web Service** → pick your `password-vault` repo.
3. Settings:
   - **Root Directory:** `cloud-sync-server`
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Instance Type:** Free
4. Add **Environment Variables** (from step 2):

   | Key | Value |
   |-----|-------|
   | `TIDB_HOST` | your host, e.g. `gateway01.eu-central-1.prod.aws.tidbcloud.com` |
   | `TIDB_PORT` | `4000` |
   | `TIDB_USER` | your user, e.g. `3Kk9xAbc123.root` |
   | `TIDB_PASSWORD` | your TiDB password |
   | `TIDB_DATABASE` | `passwordvault` |
   | `JWT_SECRET` | click **Generate** |

5. **Create Web Service**. Wait for the deploy to go green.
6. Copy your service URL, e.g. `https://password-vault-sync.onrender.com`.
7. Test it: open that URL in a browser — you should see
   `{"ok":true,"service":"password-vault-sync"}`.

> Free Render services sleep after ~15 min idle, so the first sync after a
> break can take ~30 seconds. Everything still works offline from the local
> cache in the meantime.

---

## 4. Point the extension at your server

Edit **`cloud.js`**, line ~13:

```js
const API_BASE = 'https://password-vault-sync.onrender.com';
```

Replace with **your** Render URL. Commit + push.

Then reload the extension: `chrome://extensions` → Password Vault → **Reload**.

---

## 5. Use it

**On your main laptop:**
1. Open the extension → **Config** tab → **Cloud Sync**.
2. Enter an email + a master password (min 10 characters — pick something
   strong, you cannot recover it if lost).
3. Click **Create account**. Your current vault uploads (encrypted).

**On a new laptop:**
1. Install the extension (Load unpacked, or from the Web Store once published).
2. **Config → Cloud Sync** → enter the same email + master password → **Sign in**.
3. Your vault downloads and decrypts. Done.

From then on every add / edit / delete syncs automatically. Use **Sync now**
to force it.

---

## Sign in with Google (alternative to master password)

The extension also has a **Sign in with Google** button. Setup:

1. https://console.cloud.google.com → create a project.
2. **APIs & Services → OAuth consent screen** → External → fill app name +
   your email → add your Gmail as a test user.
3. **Credentials → Create Credentials → OAuth client ID → Web application**.
   Authorized redirect URI:
   `https://lapfpjnljamfbljfimlokofnhgpakjhc.chromiumapp.org/`
4. Copy the Client ID into:
   - `cloud.js` → `GOOGLE_CLIENT_ID`
   - Render → env var `GOOGLE_CLIENT_ID` (redeploy)

**Trade-off:** Google-login accounts have their encryption key stored on the
server (so a new laptop can restore with just Google). The server *can*
technically read those vaults. Email + master-password accounts stay
zero-knowledge. Pick per account — you can't mix both on one account.

The `key` field in `manifest.json` pins the extension to a fixed ID
(`lapfpjnljamfbljfimlokofnhgpakjhc`) so Google login's redirect URI works on
every machine. The signing key is in `.ext-signing-key.pem` (gitignored) —
keep it if you plan to publish to the Chrome Web Store.

## How the security works

- Master password → PBKDF2 (600k iterations) → two independent keys:
  - **encryption key** — stays on device, AES-GCM encrypts the vault before upload
  - **auth hash** — sent to the server only to prove who you are; stored bcrypt-hashed
- The server can never read your usernames/passwords — it only sees ciphertext.
- The encryption key is held in `chrome.storage.session` (memory only), so when
  you fully close the browser you re-enter the master password to unlock.
- Forgot the master password = data is gone. That is the correct behaviour for
  a password manager. Keep a written copy somewhere safe.

## Still weak (local side, unchanged from before)

The **local** cache in `chrome.storage.local` is still plaintext, same as the
original extension. The cloud copy is fully encrypted. Encrypting the local
cache too is the recommended next step.
