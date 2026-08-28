// ── cloud.js — zero-knowledge cloud sync for Password Vault ─────────
// The master password never leaves this device. It derives:
//   • an AES-GCM key that encrypts the vault before upload
//   • a separate "auth hash" sent to the server to prove identity
// The server stores only ciphertext + a bcrypt of the auth hash.
'use strict';

window.Cloud = (function () {

  // ⚠ CHANGE THIS after you deploy the server to Render:
  const API_BASE = 'https://password-vault-sync.onrender.com';

  // ⚠ PASTE your Google OAuth "Web application" client ID here to enable Google login.
  // Leave '' to hide the Google button and use email + master password only.
  const GOOGLE_CLIENT_ID = '810175232038-9l21f97519ecgodens8rgnun30a2ek9g.apps.googleusercontent.com';

  const KDF_ITER = 600000;

  let encKey     = null;   // CryptoKey (AES-GCM) — kept in memory + chrome.storage.session
  let tombstones = [];     // [{ id, updated }] deleted-entry markers, so deletes sync
  let onChange   = () => {};
  let pushTimer  = null;
  let pending    = null;   // { remote, rCount, localCount } — backup found, waiting on user choice

  let state = {
    email: null, token: null, method: 'password', kdfSalt: null, iter: KDF_ITER,
    version: 0, lastSync: null, recovered: false,
  };

  // ── helpers ──────────────────────────────────────────────────────
  const te = new TextEncoder();
  const td = new TextDecoder();
  const b64e = buf => btoa(String.fromCharCode(...new Uint8Array(buf)));
  const b64d = str => Uint8Array.from(atob(str), c => c.charCodeAt(0));
  const el = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const tsNewer = (a, b) => (a || '') > (b || '');

  function concat(a, b) {
    const out = new Uint8Array(a.length + b.length);
    out.set(a, 0); out.set(b, a.length);
    return out;
  }

  // ── key derivation ───────────────────────────────────────────────
  async function deriveKeys(masterPassword, saltBytes, iter) {
    const baseKey = await crypto.subtle.importKey(
      'raw', te.encode(masterPassword), 'PBKDF2', false, ['deriveBits', 'deriveKey']
    );
    const aesKey = await crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: concat(saltBytes, te.encode('-enc')), iterations: iter, hash: 'SHA-256' },
      baseKey, { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']
    );
    const authBits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt: concat(saltBytes, te.encode('-auth')), iterations: iter, hash: 'SHA-256' },
      baseKey, 256
    );
    return { aesKey, authHash: b64e(authBits) };
  }

  async function encryptVault(obj) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv }, encKey, te.encode(JSON.stringify(obj))
    );
    return { iv: b64e(iv), blob: b64e(ct) };
  }

  async function decryptVault(blobB64, ivB64) {
    const pt = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: b64d(ivB64) }, encKey, b64d(blobB64)
    );
    return JSON.parse(td.decode(pt));
  }

  // ── persistence ──────────────────────────────────────────────────
  function saveState() { chrome.storage.local.set({ cloud_state: state }); }
  function saveTombstones() { chrome.storage.local.set({ cloud_tombstones: tombstones }); }

  async function stashKey() {
    const raw = await crypto.subtle.exportKey('raw', encKey);
    await chrome.storage.session.set({ cloud_encKey: b64e(raw) });
  }

  async function loadStashedKey() {
    const s = await chrome.storage.session.get('cloud_encKey');
    if (!s.cloud_encKey) return;
    encKey = await crypto.subtle.importKey(
      'raw', b64d(s.cloud_encKey), 'AES-GCM', true, ['encrypt', 'decrypt']
    );
  }

  // ── HTTP ─────────────────────────────────────────────────────────
  async function api(path, opts = {}) {
    const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
    if (state.token) headers.Authorization = 'Bearer ' + state.token;
    let res;
    try {
      res = await fetch(API_BASE + path, { ...opts, headers });
    } catch {
      throw new Error('Cannot reach the sync server. Check your connection.');
    }
    const body = await res.json().catch(() => ({}));
    if (res.status === 401) { encKey = null; state.token = null; saveState(); throw new Error(body.error || 'Session expired'); }
    if (!res.ok && res.status !== 409) throw new Error(body.error || ('Server error ' + res.status));
    return { status: res.status, body };
  }

  // ── merge remote vault into the live popup arrays ────────────────
  function mergeIntoLocal(remote) {
    if (typeof entries === 'undefined') return;
    const rEntries = remote.entries || [];
    const rFolders = remote.folders || [];
    const rTomb    = remote.tombstones || [];

    // entries — union by id, newest `updated` wins
    const map = new Map(entries.map(e => [e.id, e]));
    for (const re of rEntries) {
      const le = map.get(re.id);
      if (!le || tsNewer(re.updated, le.updated)) map.set(re.id, re);
    }

    // tombstones — union, newest per id, drop entries they cover
    const tMap = new Map(tombstones.map(t => [t.id, t]));
    for (const rt of rTomb) {
      const lt = tMap.get(rt.id);
      if (!lt || tsNewer(rt.updated, lt.updated)) tMap.set(rt.id, rt);
    }
    const cutoff = new Date(Date.now() - 120 * 864e5).toISOString(); // prune >120d
    tombstones = [...tMap.values()].filter(t => t.updated > cutoff);
    for (const t of tombstones) {
      const e = map.get(t.id);
      if (e && !tsNewer(e.updated, t.updated)) map.delete(t.id);
    }

    entries.length = 0;
    entries.push(...map.values());

    // folders — union by id, newest wins
    const fMap = new Map(folders.map(f => [f.id, f]));
    for (const rf of rFolders) {
      const lf = fMap.get(rf.id);
      if (!lf || tsNewer(rf.updated, lf.updated)) fMap.set(rf.id, rf);
    }
    folders.length = 0;
    folders.push(...fMap.values());

    saveTombstones();
    chrome.storage.local.set({ vault: entries, folders });
  }

  // ── recovery: on first sign-in, detect an existing backup ────────
  async function maybeRecover() {
    const { body } = await api('/vault', { method: 'GET' });
    state.version = body.version || 0;
    const localCount = (typeof entries !== 'undefined') ? entries.length : 0;

    if (body.blob) {
      const remote = await decryptVault(body.blob, body.iv);
      if (localCount === 0) {                       // nothing to lose — just restore
        mergeIntoLocal(remote);
      } else {                                      // both sides have data — ask
        pending = { remote, rCount: (remote.entries || []).length, localCount };
        updateStatusUI();
        return;
      }
    } else {
      await push();                                 // no backup yet — upload local
    }
    state.recovered = true;
    state.lastSync  = new Date().toISOString();
    saveState();
    onChange();
  }

  async function recover(mode) {
    if (!pending) return;
    if (mode === 'replace') { entries.length = 0; folders.length = 0; tombstones = []; saveTombstones(); }
    if (mode !== 'skip') mergeIntoLocal(pending.remote);
    pending = null;
    state.recovered = true;
    chrome.storage.local.set({ vault: entries, folders });
    onChange();
    await push();                                   // reconcile the server with the result
    state.lastSync = new Date().toISOString();
    saveState();
  }

  // ── pull / push ──────────────────────────────────────────────────
  async function pull() {
    if (!encKey) throw new Error('Locked — enter your master password');
    const { body } = await api('/vault', { method: 'GET' });
    if (body.blob) {
      mergeIntoLocal(await decryptVault(body.blob, body.iv));
    }
    state.version  = body.version || 0;
    state.lastSync = new Date().toISOString();
    saveState();
    onChange();
  }

  async function push() {
    if (!encKey || !state.token || typeof entries === 'undefined') return;
    const payload = { entries, folders, tombstones };
    let enc = await encryptVault(payload);
    let r = await api('/vault', {
      method: 'PUT', body: JSON.stringify({ ...enc, baseVersion: state.version }),
    });
    if (r.status === 409) {                       // another device pushed first
      mergeIntoLocal(await decryptVault(r.body.blob, r.body.iv));
      state.version = r.body.version;
      onChange();
      enc = await encryptVault({ entries, folders, tombstones });
      r = await api('/vault', {
        method: 'PUT', body: JSON.stringify({ ...enc, baseVersion: state.version }),
      });
    }
    state.version  = r.body.version;
    state.lastSync = new Date().toISOString();
    saveState();
    updateStatusUI();
  }

  function schedulePush() {
    if (!encKey || !state.token) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(() => push().catch(e => console.warn('[Cloud] push failed:', e.message)), 1500);
  }

  // ── account actions ──────────────────────────────────────────────
  async function register(email, masterPassword) {
    email = String(email).trim().toLowerCase();
    if (!email.includes('@')) throw new Error('Enter a valid email');
    if ((masterPassword || '').length < 10) throw new Error('Master password must be at least 10 characters');

    const salt = crypto.getRandomValues(new Uint8Array(16));
    const { aesKey, authHash } = await deriveKeys(masterPassword, salt, KDF_ITER);
    const { body } = await api('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, kdfSalt: b64e(salt), iterations: KDF_ITER, authHash }),
    });
    encKey = aesKey;
    state = { email, token: body.token, method: 'password', kdfSalt: b64e(salt), iter: KDF_ITER, version: 0, lastSync: null, recovered: true };
    saveState(); await stashKey();
    await push();                                 // upload whatever is already in the vault
  }

  // ── Sign in with Google (server-held key) ────────────────────────
  async function signInWithGoogle() {
    if (!GOOGLE_CLIENT_ID) throw new Error('Google login is not set up (no client ID in cloud.js)');
    const redirectUri = chrome.identity.getRedirectURL();
    const nonce = b64e(crypto.getRandomValues(new Uint8Array(16)));
    const authUrl = 'https://accounts.google.com/o/oauth2/v2/auth'
      + '?client_id='     + encodeURIComponent(GOOGLE_CLIENT_ID)
      + '&response_type='  + 'id_token'
      + '&redirect_uri='   + encodeURIComponent(redirectUri)
      + '&scope='          + encodeURIComponent('openid email profile')
      + '&nonce='          + encodeURIComponent(nonce)
      + '&prompt='         + 'select_account';

    const responseUrl = await new Promise((resolve, reject) => {
      chrome.identity.launchWebAuthFlow({ url: authUrl, interactive: true }, r => {
        if (chrome.runtime.lastError || !r) reject(new Error(chrome.runtime.lastError?.message || 'Google sign-in cancelled'));
        else resolve(r);
      });
    });

    const params  = new URLSearchParams(new URL(responseUrl).hash.slice(1));
    const idToken = params.get('id_token');
    if (!idToken) throw new Error('Google did not return a token');

    const { body } = await api('/auth/google', { method: 'POST', body: JSON.stringify({ idToken }) });
    encKey = await crypto.subtle.importKey('raw', b64d(body.vaultKey), 'AES-GCM', true, ['encrypt', 'decrypt']);
    let email = state.email;
    try { email = JSON.parse(atob(idToken.split('.')[1])).email || email; } catch {}
    state = { email, token: body.token, method: 'google', kdfSalt: null, iter: KDF_ITER, version: 0, lastSync: null, recovered: false };
    saveState(); await stashKey();
    await maybeRecover();
  }

  async function signIn(email, masterPassword) {
    email = String(email).trim().toLowerCase();
    if (!email || !masterPassword) throw new Error('Email and master password required');

    const pre  = (await api('/auth/prelogin', { method: 'POST', body: JSON.stringify({ email }) })).body;
    const salt = b64d(pre.kdfSalt);
    const { aesKey, authHash } = await deriveKeys(masterPassword, salt, pre.iterations);
    const { body } = await api('/auth/login', { method: 'POST', body: JSON.stringify({ email, authHash }) });

    encKey = aesKey;
    state = { email, token: body.token, method: 'password', kdfSalt: pre.kdfSalt, iter: pre.iterations, version: 0, lastSync: null, recovered: false };
    saveState(); await stashKey();
    await maybeRecover();                         // restore vault onto this device
  }

  async function unlock(masterPassword) {
    if (state.method === 'google') return signInWithGoogle();
    if (!state.email || !state.kdfSalt) throw new Error('Sign in first');
    const salt = b64d(state.kdfSalt);
    const { aesKey, authHash } = await deriveKeys(masterPassword, salt, state.iter);
    const { body } = await api('/auth/login', {
      method: 'POST', body: JSON.stringify({ email: state.email, authHash }),
    });
    encKey = aesKey;
    state.token = body.token;
    state.recovered = true;
    saveState(); await stashKey();
    await pull();
  }

  // Lock: drop the in-memory key but stay signed in (used by the popup's auto-lock)
  async function lock() {
    encKey = null;
    try { await chrome.storage.session.remove('cloud_encKey'); } catch {}
    updateStatusUI();
  }

  async function signOut() {
    encKey = null;
    await chrome.storage.session.remove('cloud_encKey');
    state = { email: null, token: null, method: 'password', kdfSalt: null, iter: KDF_ITER, version: 0, lastSync: null };
    saveState();
    updateStatusUI();
  }

  // ── delete tracking ──────────────────────────────────────────────
  function tombstone(id) {
    tombstones = tombstones.filter(t => t.id !== id);
    tombstones.push({ id, updated: new Date().toISOString() });
    saveTombstones();
    schedulePush();
  }
  function tombstoneAll(ids) {
    const now = new Date().toISOString();
    (ids || []).forEach(id => {
      tombstones = tombstones.filter(t => t.id !== id);
      tombstones.push({ id, updated: now });
    });
    saveTombstones();
    schedulePush();
  }

  // ── status UI (rendered into #cloudSync in the Config tab) ───────
  function status() {
    return { signedIn: !!state.token, unlocked: !!encKey, email: state.email, lastSync: state.lastSync };
  }

  function run(fn) {
    const err = el('cloudErr');
    if (err) err.textContent = '';
    const btns = document.querySelectorAll('#cloudSync button');
    btns.forEach(b => (b.disabled = true));
    Promise.resolve().then(fn)
      .then(() => updateStatusUI())
      .catch(e => {
        btns.forEach(b => (b.disabled = false));
        const e2 = el('cloudErr');
        if (e2) e2.textContent = e.message || String(e);
        else console.warn('[Cloud]', e);
      });
  }

  function updateStatusUI() {
    const box = el('cloudSync');
    if (!box) return;

    const googleBtn = GOOGLE_CLIENT_ID
      ? `<div class="cloud-or">or</div><button class="btn btn-ghost" id="cloudGoogleBtn" style="width:100%">Sign in with Google</button>`
      : '';

    if (!state.token) {
      box.innerHTML = `
        <div class="cloud-card">
          <div class="cloud-row"><span class="cloud-dot off"></span><b>Not signed in</b></div>
          <div class="cloud-sub">Back up your vault and restore it on another device.
            Email + master password stays zero-knowledge (lose the password = data gone).
            Google login is more convenient but the server can read those vaults.</div>
          <input type="email" id="cloudEmail" placeholder="email" autocomplete="username">
          <input type="password" id="cloudPass" placeholder="master password (min 10 chars)" autocomplete="current-password">
          <div id="cloudErr" class="cloud-err"></div>
          <div class="cloud-btns">
            <button class="btn btn-sm" id="cloudSignInBtn">Sign in</button>
            <button class="btn btn-ghost" id="cloudRegisterBtn">Create account</button>
          </div>
          ${googleBtn}
        </div>`;
      el('cloudSignInBtn').onclick   = () => run(() => signIn(el('cloudEmail').value, el('cloudPass').value));
      el('cloudRegisterBtn').onclick = () => run(() => register(el('cloudEmail').value, el('cloudPass').value));
      if (el('cloudGoogleBtn')) el('cloudGoogleBtn').onclick = () => run(() => signInWithGoogle());

    } else if (pending) {
      box.innerHTML = `
        <div class="cloud-card">
          <div class="cloud-row"><span class="cloud-dot lock"></span><b>Backup found</b> &nbsp;<span class="cloud-sub">${esc(state.email)}</span></div>
          <div class="cloud-sub">This account has a saved vault with ${pending.rCount} entr${pending.rCount === 1 ? 'y' : 'ies'}.
            You have ${pending.localCount} on this device.</div>
          <div id="cloudErr" class="cloud-err"></div>
          <div class="cloud-btns">
            <button class="btn btn-sm" id="cloudRecReplace">Use backup</button>
            <button class="btn btn-ghost" id="cloudRecMerge">Merge both</button>
            <button class="btn btn-ghost" id="cloudRecSkip">Keep mine</button>
          </div>
        </div>`;
      el('cloudRecReplace').onclick = () => run(() => recover('replace'));
      el('cloudRecMerge').onclick   = () => run(() => recover('merge'));
      el('cloudRecSkip').onclick    = () => run(() => recover('skip'));

    } else if (!encKey) {
      const isGoogle = state.method === 'google';
      box.innerHTML = `
        <div class="cloud-card">
          <div class="cloud-row"><span class="cloud-dot lock"></span><b>Locked</b> &nbsp;<span class="cloud-sub">${esc(state.email)}</span></div>
          <div class="cloud-sub">${isGoogle ? 'Continue with Google to unlock and sync.' : 'Enter your master password to unlock and sync.'}</div>
          ${isGoogle ? '' : '<input type="password" id="cloudPass" placeholder="master password" autocomplete="current-password">'}
          <div id="cloudErr" class="cloud-err"></div>
          <div class="cloud-btns">
            <button class="btn btn-sm" id="cloudUnlockBtn">${isGoogle ? 'Continue with Google' : 'Unlock'}</button>
            <button class="btn btn-ghost" id="cloudSignOutBtn">Sign out</button>
          </div>
        </div>`;
      el('cloudUnlockBtn').onclick  = () => run(() => isGoogle ? signInWithGoogle() : unlock(el('cloudPass').value));
      el('cloudSignOutBtn').onclick = () => run(() => signOut());

    } else {
      const last = state.lastSync ? new Date(state.lastSync).toLocaleString() : 'never';
      box.innerHTML = `
        <div class="cloud-card">
          <div class="cloud-row"><span class="cloud-dot on"></span><b>Synced</b> &nbsp;<span class="cloud-sub">${esc(state.email)}</span></div>
          <div class="cloud-sub">Last sync: ${esc(last)}</div>
          <div id="cloudErr" class="cloud-err"></div>
          <div class="cloud-btns">
            <button class="btn btn-sm" id="cloudSyncNowBtn">Sync now</button>
            <button class="btn btn-ghost" id="cloudSignOutBtn">Sign out</button>
          </div>
        </div>`;
      el('cloudSyncNowBtn').onclick = () => run(async () => { await pull(); await push(); });
      el('cloudSignOutBtn').onclick = () => run(() => signOut());
    }
  }

  // ── init ─────────────────────────────────────────────────────────
  async function init(opts = {}) {
    onChange = opts.onChange || (() => {});
    const r = await chrome.storage.local.get(['cloud_state', 'cloud_tombstones']);
    if (r.cloud_state)      state = { ...state, ...r.cloud_state };
    if (r.cloud_tombstones) tombstones = r.cloud_tombstones;
    await loadStashedKey();
    updateStatusUI();
    if (state.token && encKey) {
      try { state.recovered ? await pull() : await maybeRecover(); }
      catch (e) { console.warn('[Cloud] initial sync failed:', e.message); updateStatusUI(); }
    }
  }

  return { init, schedulePush, tombstone, tombstoneAll, status, lock, syncNow: () => push() };
})();
