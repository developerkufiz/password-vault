// ── cloud.js — free serverless sync for Password Vault ─────────────
// No server, no account. The vault is encrypted on this device with a
// key derived (PBKDF2 → AES-GCM) from a "sync passphrase" you choose,
// then stored in chrome.storage.sync — which Chrome replicates across
// every device signed in to the same Chrome/Google profile, for free.
// The passphrase never leaves the device. Lose it = data unrecoverable.
'use strict';

window.Cloud = (function () {

  const KDF_ITER   = 600000;
  const CHUNK      = 7000;   // base64 chars per chrome.storage.sync item (< 8 KB limit)
  const MAX_CHUNKS = 13;     // ~91 KB ciphertext ceiling (sync quota is ~100 KB)

  let encKey     = null;   // CryptoKey (AES-GCM) — in memory + chrome.storage.session
  let tombstones = [];     // [{ id, updated }] deleted-entry markers, so deletes sync
  let onChange   = () => {};
  let pushTimer  = null;
  let pending    = null;   // { remote, rCount, localCount } — remote vault found, waiting on user choice

  let state = {
    enabled: false, salt: null, iter: KDF_ITER, ver: 0, chunks: 0, lastSync: null,
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

  // ── crypto ───────────────────────────────────────────────────────
  async function deriveKey(passphrase, saltBytes, iter) {
    const baseKey = await crypto.subtle.importKey(
      'raw', te.encode(passphrase), 'PBKDF2', false, ['deriveKey']
    );
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: concat(saltBytes, te.encode('-enc')), iterations: iter, hash: 'SHA-256' },
      baseKey, { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']
    );
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

  // ── chrome.storage.sync transport ────────────────────────────────
  const syncGet    = keys => chrome.storage.sync.get(keys);
  const syncSet    = obj  => chrome.storage.sync.set(obj);
  const syncRemove = keys => chrome.storage.sync.remove(keys);

  async function readRemoteMeta() {
    return (await syncGet('pv_meta')).pv_meta || null;
  }

  async function readRemoteVault(meta) {
    const keys = Array.from({ length: meta.chunks }, (_, i) => 'pv_c' + i);
    const got  = keys.length ? await syncGet(keys) : {};
    const b64  = keys.map(k => got[k] || '').join('');
    return decryptVault(b64, meta.iv);
  }

  async function writeRemoteVault(payload) {
    const enc   = await encryptVault(payload);
    const parts = [];
    for (let i = 0; i < enc.blob.length; i += CHUNK) parts.push(enc.blob.slice(i, i + CHUNK));
    if (parts.length > MAX_CHUNKS) {
      throw new Error('Vault too large for free sync (~90 KB max). Trim entries or use JSON export/import instead.');
    }
    const ver = (state.ver || 0) + 1;
    const obj = { pv_meta: { salt: state.salt, iter: state.iter, iv: enc.iv, chunks: parts.length, ver, updated: new Date().toISOString() } };
    parts.forEach((p, i) => (obj['pv_c' + i] = p));
    await syncSet(obj);

    const stale = [];
    for (let i = parts.length; i < (state.chunks || 0); i++) stale.push('pv_c' + i);
    if (stale.length) await syncRemove(stale);

    state.ver = ver; state.chunks = parts.length; state.lastSync = obj.pv_meta.updated;
    saveState();
  }

  // ── merge remote vault into the live popup arrays ────────────────
  function mergeIntoLocal(remote) {
    if (typeof entries === 'undefined') return;
    const rEntries = remote.entries || [];
    const rFolders = remote.folders || [];
    const rTomb    = remote.tombstones || [];

    const map = new Map(entries.map(e => [e.id, e]));
    for (const re of rEntries) {
      const le = map.get(re.id);
      if (!le || tsNewer(re.updated, le.updated)) map.set(re.id, re);
    }

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

  // ── pull / push ──────────────────────────────────────────────────
  async function pull() {
    if (!encKey) throw new Error('Locked — enter your sync passphrase');
    const meta = await readRemoteMeta();
    if (!meta) return;
    mergeIntoLocal(await readRemoteVault(meta));
    state.ver = meta.ver; state.chunks = meta.chunks;
    state.lastSync = new Date().toISOString();
    saveState();
    onChange();
  }

  async function push() {
    if (!encKey || !state.enabled || typeof entries === 'undefined') return;
    const meta = await readRemoteMeta();
    if (meta && meta.ver > (state.ver || 0)) {   // another device pushed first — merge, then write
      mergeIntoLocal(await readRemoteVault(meta));
      state.ver = meta.ver; state.chunks = meta.chunks;
      onChange();
    }
    await writeRemoteVault({ entries, folders, tombstones });
    updateStatusUI();
  }

  function schedulePush() {
    if (!encKey || !state.enabled) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(() => push().catch(e => console.warn('[Cloud] push failed:', e.message)), 1500);
  }

  function onSyncChanged(changes, area) {
    if (area !== 'sync' || !changes.pv_meta || !encKey || !state.enabled) return;
    const nv = changes.pv_meta.newValue;
    if (nv && nv.ver > (state.ver || 0)) {
      pull().catch(e => console.warn('[Cloud] auto-pull failed:', e.message));
    }
  }

  // ── enable / unlock / disable ────────────────────────────────────
  async function enableSync(passphrase) {
    if ((passphrase || '').length < 10) throw new Error('Passphrase must be at least 10 characters');
    const meta = await readRemoteMeta();

    if (meta) {
      encKey = await deriveKey(passphrase, b64d(meta.salt), meta.iter);
      let remote;
      try { remote = await readRemoteVault(meta); }
      catch { encKey = null; throw new Error('Wrong passphrase'); }

      state = { enabled: true, salt: meta.salt, iter: meta.iter, ver: meta.ver, chunks: meta.chunks, lastSync: new Date().toISOString() };
      saveState(); await stashKey();

      const localCount = (typeof entries !== 'undefined') ? entries.length : 0;
      if (localCount === 0) { mergeIntoLocal(remote); onChange(); }
      else { pending = { remote, rCount: (remote.entries || []).length, localCount }; }
      updateStatusUI();
      return;
    }

    const salt = crypto.getRandomValues(new Uint8Array(16));
    encKey = await deriveKey(passphrase, salt, KDF_ITER);
    state = { enabled: true, salt: b64e(salt), iter: KDF_ITER, ver: 0, chunks: 0, lastSync: null };
    saveState(); await stashKey();
    await push();
    onChange();
  }

  async function unlock(passphrase) {
    if (!state.salt) throw new Error('Enable sync first');
    encKey = await deriveKey(passphrase, b64d(state.salt), state.iter);
    try { await pull(); }
    catch (e) { encKey = null; throw new Error(/passphrase/i.test(e.message) ? e.message : 'Wrong passphrase'); }
    await stashKey();
  }

  async function recover(mode) {
    if (!pending) return;
    if (mode === 'replace') { entries.length = 0; folders.length = 0; tombstones = []; saveTombstones(); }
    if (mode !== 'skip') mergeIntoLocal(pending.remote);
    pending = null;
    chrome.storage.local.set({ vault: entries, folders });
    onChange();
    await push();
    updateStatusUI();
  }

  // Lock: drop the in-memory key but keep sync enabled (used by the popup's auto-lock)
  async function lock() {
    encKey = null;
    try { await chrome.storage.session.remove('cloud_encKey'); } catch {}
    updateStatusUI();
  }

  async function disableSync() {
    encKey = null;
    try { await chrome.storage.session.remove('cloud_encKey'); } catch {}
    state = { enabled: false, salt: null, iter: KDF_ITER, ver: 0, chunks: 0, lastSync: null };
    pending = null;
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
    return { signedIn: !!state.enabled, unlocked: !!encKey, lastSync: state.lastSync };
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

    if (!state.enabled) {
      box.innerHTML = `
        <div class="cloud-card">
          <div class="cloud-row"><span class="cloud-dot off"></span><b>Sync off</b></div>
          <div class="cloud-sub">Encrypts your vault and syncs it through your Chrome account — free, no server, no login.
            Enter the <b>same passphrase</b> on each device. It never leaves this device; lose it and the data is unrecoverable.</div>
          <input type="password" id="cloudPass" placeholder="sync passphrase (min 10 chars)" autocomplete="new-password">
          <div id="cloudErr" class="cloud-err"></div>
          <div class="cloud-btns"><button class="btn btn-sm" id="cloudEnableBtn">Enable sync</button></div>
        </div>`;
      el('cloudEnableBtn').onclick = () => run(() => enableSync(el('cloudPass').value));

    } else if (pending) {
      box.innerHTML = `
        <div class="cloud-card">
          <div class="cloud-row"><span class="cloud-dot lock"></span><b>Synced vault found</b></div>
          <div class="cloud-sub">The cloud copy has ${pending.rCount} entr${pending.rCount === 1 ? 'y' : 'ies'}.
            This device has ${pending.localCount}.</div>
          <div id="cloudErr" class="cloud-err"></div>
          <div class="cloud-btns">
            <button class="btn btn-sm" id="cloudRecReplace">Use cloud</button>
            <button class="btn btn-ghost" id="cloudRecMerge">Merge both</button>
            <button class="btn btn-ghost" id="cloudRecSkip">Keep mine</button>
          </div>
        </div>`;
      el('cloudRecReplace').onclick = () => run(() => recover('replace'));
      el('cloudRecMerge').onclick   = () => run(() => recover('merge'));
      el('cloudRecSkip').onclick    = () => run(() => recover('skip'));

    } else if (!encKey) {
      box.innerHTML = `
        <div class="cloud-card">
          <div class="cloud-row"><span class="cloud-dot lock"></span><b>Locked</b></div>
          <div class="cloud-sub">Enter your sync passphrase to unlock and sync.</div>
          <input type="password" id="cloudPass" placeholder="sync passphrase" autocomplete="current-password">
          <div id="cloudErr" class="cloud-err"></div>
          <div class="cloud-btns">
            <button class="btn btn-sm" id="cloudUnlockBtn">Unlock</button>
            <button class="btn btn-ghost" id="cloudDisableBtn">Disable sync</button>
          </div>
        </div>`;
      el('cloudUnlockBtn').onclick  = () => run(() => unlock(el('cloudPass').value));
      el('cloudDisableBtn').onclick = () => run(() => disableSync());

    } else {
      const last = state.lastSync ? new Date(state.lastSync).toLocaleString() : 'never';
      box.innerHTML = `
        <div class="cloud-card">
          <div class="cloud-row"><span class="cloud-dot on"></span><b>Synced</b></div>
          <div class="cloud-sub">Last sync: ${esc(last)}</div>
          <div id="cloudErr" class="cloud-err"></div>
          <div class="cloud-btns">
            <button class="btn btn-sm" id="cloudSyncNowBtn">Sync now</button>
            <button class="btn btn-ghost" id="cloudDisableBtn">Disable sync</button>
          </div>
        </div>`;
      el('cloudSyncNowBtn').onclick = () => run(async () => { await pull(); await push(); });
      el('cloudDisableBtn').onclick = () => run(() => disableSync());
    }
  }

  // ── init ─────────────────────────────────────────────────────────
  async function init(opts = {}) {
    onChange = opts.onChange || (() => {});
    const r = await chrome.storage.local.get(['cloud_state', 'cloud_tombstones']);
    if (r.cloud_state && r.cloud_state.enabled) state = { ...state, ...r.cloud_state };
    if (r.cloud_tombstones) tombstones = r.cloud_tombstones;
    await loadStashedKey();
    chrome.storage.onChanged.addListener(onSyncChanged);
    updateStatusUI();
    if (state.enabled && encKey) {
      try { await pull(); }
      catch (e) { console.warn('[Cloud] initial sync failed:', e.message); updateStatusUI(); }
    }
  }

  return { init, schedulePush, tombstone, tombstoneAll, status, lock, syncNow: () => push() };
})();
