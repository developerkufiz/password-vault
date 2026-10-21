// ── background.js — PWD VAULT by KuFiz ──────────────────────────
'use strict';
importScripts('pwgen.js');   // generatePassword()

// Fresh installs have no `settings` key in storage until the user opens
// Config — without these defaults, settings.autofill reads as undefined
// (falsy) and autofill silently never fires for a first-time save.
const DEFAULT_SETTINGS = { autofill: true, autosubmit: false, maxAttempts: 5 };
function withDefaults(settings) { return { ...DEFAULT_SETTINGS, ...(settings || {}) }; }

// ── AUTO-FILL ON TAB LOAD ─────────────────────────────────────────
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete' || !tab.url) return;
  updateBadge(tabId, tab.url);
  // A submitted auto-filled login that moved on to a different page worked
  getPending(p => { if (p[tabId] && urlKey(tab.url) !== p[tabId].key) resolveLogin(tabId, true); });
  if (tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) return;

  chrome.storage.local.get(['settings','attempts'], result => {
   readVault((entries) => {
    if (!entries) { console.log('[PWD Vault] local vault is locked — open the popup to unlock'); return; }
    const settings = withDefaults(result.settings);
    const attempts = result.attempts || {};
    const max      = settings.maxAttempts || 5;
    if (isIgnoredSite(settings, tab.url)) return;   // user chose "never here" (manual fill still works)

    const key = urlKey(tab.url);
    const rec = attempts[key] || { count: 0 };
    if (isPaused(rec, max)) {
      if (wrongPwPaused(rec) && entries.some(e => urlMatches(e.url, tab.url))) {
        setTimeout(() => chrome.tabs.sendMessage(tabId, { action: 'showToast', mode: 'wrongpw' }).catch(() => {}), 900);
      }
      return;
    }

    // All eligible matches — per-entry autofill override (null = use global)
    const eligible = entries.filter(e => {
      if (!urlMatches(e.url, tab.url)) return false;
      const af = (e.autofill !== null && e.autofill !== undefined) ? e.autofill : settings.autofill;
      return af;
    });
    console.log('[PWD Vault]', new URL(tab.url).host, '→', eligible.length, 'eligible credential(s)');
    if (!eligible.length) return;

    if (eligible.length === 1) {
      setTimeout(() => sendAutofill(tabId, eligible[0], settings, key, max), 900);
      return;
    }

    // Multiple accounts match — let the user choose (usernames only, no passwords sent)
    const exact = entry => { try { return new URL(entry.url).pathname === new URL(tab.url).pathname ? 0 : 1; } catch { return 1; } };
    const last  = entry => entry.lastLogin ? new Date(entry.lastLogin).getTime() : 0;
    const accounts = eligible
      .slice()
      .sort((a, b) => (exact(a) - exact(b)) || (last(b) - last(a)) || a.username.localeCompare(b.username))
      .map(e => ({ id: e.id, username: e.username, label: e.label || e.url, lastLogin: e.lastLogin || null }));
    // Same delay as the fill path + retry — content script may not be listening yet
    setTimeout(() => sendAccountPicker(tabId, accounts, key), 900);
   });
  });
});

function sendAccountPicker(tabId, accounts, key, tries = 0) {
  chrome.tabs.sendMessage(tabId, { action: 'showAccountPicker', accounts, urlKey: key })
    .then(() => console.log('[PWD Vault] account picker shown for', accounts.length, 'accounts'))
    .catch(err => {
      // Only retry when the content script truly isn't there yet —
      // other rejections (port closed, etc.) must not re-send or the picker blinks
      const unreachable = /Receiving end does not exist/i.test(String(err && err.message));
      if (unreachable && tries < 3) setTimeout(() => sendAccountPicker(tabId, accounts, key, tries + 1), 700);
      else console.warn('[PWD Vault] account picker failed on tab', tabId, String(err && err.message));
    });
}

// Send one credential to the page. Also counts fills — the popup asks for a
// rating after 20 (a sent fill, not a confirmed login: good enough for that).
function sendAutofill(tabId, entry, settings, key, max) {
  const resolvedAutosubmit = (entry.autosubmit !== null && entry.autosubmit !== undefined) ? entry.autosubmit : settings.autosubmit;
  chrome.tabs.sendMessage(tabId, {
    action:      'autofill',
    username:    entry.username,
    password:    entry.password,
    selectors:   entry.selectors   || {},
    extraFields: entry.extraFields || [],
    autosubmit:  resolvedAutosubmit,
    urlKey:      key,
    maxAttempts: max
  }).catch(() => {});
  chrome.storage.local.get('fill_count', r => chrome.storage.local.set({ fill_count: (r.fill_count || 0) + 1 }));
}

// Fill the account chosen in the content-script picker (password stays in background)
function fillChosenAccount(entry, tabId, tabUrl, settings, attempts) {
  const max = settings.maxAttempts || 5;
  const key = urlKey(tabUrl || entry.url);
  const rec = attempts[key] || { count: 0 };
  if (isPaused(rec, max)) return;
  sendAutofill(tabId, entry, settings, key, max);
}

// ── TOOLBAR BADGE — saved logins for the page, else NEW after an update ──
function updateBadge(tabId, url) {
  chrome.storage.local.get('whats_new_from', r => {
    readVault(entries => {
      const n = (entries && url) ? entries.filter(e => urlMatches(e.url, url)).length : 0;
      chrome.action.setBadgeText({ tabId, text: n ? String(n) : (r.whats_new_from ? 'NEW' : '') });
      chrome.action.setBadgeBackgroundColor({ tabId, color: '#00b4ff' });
    });
  });
}
function updateActiveBadge() {
  chrome.tabs.query({ active: true, lastFocusedWindow: true }, tabs => { if (tabs[0]) updateBadge(tabs[0].id, tabs[0].url); });
}
chrome.tabs.onActivated.addListener(updateActiveBadge);
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && (changes.vault || changes.vault_enc || changes.whats_new_from)) updateActiveBadge();
  if (area === 'session' && changes.pv_datakey) updateActiveBadge();   // vault unlocked / locked
});

// ── RIGHT-CLICK MENU ──────────────────────────────────────────────
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: 'pv-fill', title: 'Fill saved login', contexts: ['page', 'editable'] });
    chrome.contextMenus.create({ id: 'pv-generate', title: 'Generate strong password here', contexts: ['editable'] });
  });
});
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab || !tab.url) return;
  if (info.menuItemId === 'pv-fill') fillTab(tab);
  if (info.menuItemId === 'pv-generate') {
    chrome.tabs.sendMessage(tab.id, { action: 'fillGenerated', password: generatePassword(20) }).catch(() => {});
  }
});

// ── WHAT'S NEW — after an update, badge the icon until the popup shows the changelog ──
function showNewBadge() {
  chrome.action.setBadgeText({ text: 'NEW' });
  chrome.action.setBadgeBackgroundColor({ color: '#00b4ff' });
}
chrome.runtime.onInstalled.addListener(({ reason, previousVersion }) => {
  if (reason !== 'update' || !previousVersion || previousVersion === chrome.runtime.getManifest().version) return;
  chrome.storage.local.set({ whats_new_from: previousVersion });
  showNewBadge();
});
// Badge text doesn't survive a browser restart — restore it while unseen
chrome.runtime.onStartup.addListener(() => {
  chrome.storage.local.get('whats_new_from', r => { if (r.whats_new_from) showNewBadge(); });
});

// ── AUTO-LOCK — clear the unlocked session even while the popup is closed ──
// autoLockMin: PIN grace + cloud key (idle). vaultLockMin: local-vault key, counted
// from unlock; 0 = keep until Chrome closes, so auto-fill keeps working.
chrome.alarms.create('pv-autolock', { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener(a => {
  if (a.name !== 'pv-autolock') return;
  chrome.storage.session.get(['pv_unlock', 'pv_vault_at'], s => {
    chrome.storage.local.get('settings', r => {
      const st  = r.settings || {};
      const now = Date.now();
      const at  = s.pv_unlock && s.pv_unlock.at;
      if (at && st.autoLockMin > 0 && now - at >= st.autoLockMin * 60000) {
        chrome.storage.session.remove(['pv_unlock', 'cloud_encKey']);
      }
      if (s.pv_vault_at && st.vaultLockMin > 0 && now - s.pv_vault_at >= st.vaultLockMin * 60000) {
        chrome.storage.session.remove(['pv_datakey', 'pv_vault_at']);
      }
    });
  });
});

// ── KEYBOARD SHORTCUT — fill the current page on demand ───────────
// Default: Ctrl+Shift+L (Cmd+Shift+L on Mac). Rebind at chrome://extensions/shortcuts
chrome.commands.onCommand.addListener(command => {
  if (command !== 'fill-login') return;
  chrome.tabs.query({ active: true, currentWindow: true }, tabs => fillTab(tabs[0]));
});

// Fill the saved login for a tab on demand (shortcut + right-click menu)
function fillTab(tab) {
    if (!tab || !tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) return;

    chrome.storage.local.get(['settings','attempts'], result => {
     readVault((entries) => {
      if (!entries) { console.warn('[PWD Vault] shortcut: local vault is locked'); return; }
      const settings = withDefaults(result.settings);
      const attempts = result.attempts || {};
      const max      = settings.maxAttempts || 5;

      const key = urlKey(tab.url);
      if (isPaused(attempts[key] || { count: 0 }, max)) {
        console.warn('[PWD Vault] shortcut: page is locked out');
        return;
      }

      // Manual trigger ignores the autofill toggle — the user asked for it explicitly
      const eligible = entries.filter(e => urlMatches(e.url, tab.url));
      console.log('[PWD Vault] shortcut →', eligible.length, 'credential(s)');
      if (!eligible.length) return;

      if (eligible.length === 1) {
        fillChosenAccount(eligible[0], tab.id, tab.url, settings, attempts);
        return;
      }
      const exact = entry => { try { return new URL(entry.url).pathname === new URL(tab.url).pathname ? 0 : 1; } catch { return 1; } };
      const last  = entry => entry.lastLogin ? new Date(entry.lastLogin).getTime() : 0;
      const accounts = eligible
        .slice()
        .sort((a, b) => (exact(a) - exact(b)) || (last(b) - last(a)) || a.username.localeCompare(b.username))
        .map(e => ({ id: e.id, username: e.username, label: e.label || e.url, lastLogin: e.lastLogin || null }));
      sendAccountPicker(tab.id, accounts, key);
     });
    });
}

// ── MESSAGE HANDLERS ──────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {

  // ── pickAccount — user chose an account in the on-page picker ────
  if (msg.action === 'pickAccount') {
    chrome.storage.local.get(['settings','attempts'], result => {
      readVault((entries) => {
        const entry = (entries || []).find(e => e.id === msg.entryId);
        if (!entry || !sender.tab) return;
        fillChosenAccount(entry, sender.tab.id, sender.tab.url, withDefaults(result.settings), result.attempts || {});
      });
    });
    return true;
  }

  // ── checkAutofill ────────────────────────────────────────────────
  if (msg.action === 'checkAutofill') {
    chrome.storage.local.get(['settings','attempts'], result => {
     readVault((entries) => {
      if (!entries) { sendResponse({ match: null, locked: true }); return; }
      const settings = withDefaults(result.settings);
      const attempts = result.attempts || {};
      const max      = settings.maxAttempts || 5;
      const match = entries.find(e => urlMatches(e.url, msg.url));
      if (!match) { sendResponse({ match: null }); return; }

      // Per-entry overrides: null = use global, true/false = individual
      const resolvedAutofill   = (match.autofill   !== null && match.autofill   !== undefined) ? match.autofill   : settings.autofill;
      const resolvedAutosubmit = (match.autosubmit !== null && match.autosubmit !== undefined) ? match.autosubmit : settings.autosubmit;

      if (!resolvedAutofill) { sendResponse({ match: null }); return; }

      const key = urlKey(msg.url);
      const rec = attempts[key] || { count: 0 };
      if (isPaused(rec, max)) {
        sendResponse({ match: null, locked: true, count: rec.count, maxAttempts: max });
        return;
      }
      // Pass resolved settings so content.js uses the right autosubmit value
      sendResponse({ match, settings: { ...settings, masterPin: undefined, pinRecovery: undefined, encLocal: undefined, autosubmit: resolvedAutosubmit }, urlKey: key, maxAttempts: max });
     });
    });
    return true;
  }

  // ── reportAttempt — auto-fill history (single source of truth) ───
  if (msg.action === 'reportAttempt') {
    // Back on the page after submitting a filled login: form again = wrong password, no form = logged in
    if (sender.tab) getPending(p => {
      const rec = p[sender.tab.id];
      if (rec && rec.key === msg.urlKey) resolveLogin(sender.tab.id, !!msg.noForm);
    });
    if (msg.noForm) return;
    chrome.storage.local.get(['attempts','settings','vault'], result => {
      const enc      = !!(result.settings && result.settings.encLocal && result.settings.encLocal.on);
      const attempts = result.attempts || {};
      const entries  = enc ? [] : (result.vault || []);   // no history writes while encrypted
      const max      = (result.settings || {}).maxAttempts || 5;
      const key      = msg.urlKey;
      if (!key) return;

      // Dedup guard — ignore if same result written within last 3 seconds
      const idx = entries.findIndex(e => {
        try { const u = new URL(e.url); return (u.origin + u.pathname) === key; }
        catch { return false; }
      });
      if (idx >= 0) {
        const hist = entries[idx].loginHistory || [];
        const last = hist[hist.length - 1];
        if (last && last.status === (msg.success ? 'success' : 'fail')
            && (Date.now() - new Date(last.ts).getTime()) < 3000) {
          return; // duplicate — skip
        }
      }

      // Update lockout counter. A successful *fill* doesn't reset it — only a
      // login that actually worked does (resolveLogin), so a wrong saved password can't loop.
      if (!msg.success) {
        const rec  = attempts[key] || { count: 0 };
        rec.count  = (rec.count || 0) + 1;
        rec.lastAt = Date.now();
        if (rec.count >= max) rec.lockedAt = Date.now();
        attempts[key] = rec;
      }

      // Write ONE history entry
      if (!enc && idx >= 0) {
        const now  = new Date().toISOString();
        const hist = entries[idx].loginHistory || [];
        hist.push({ ts: now, status: msg.success ? 'success' : 'fail' });
        if (hist.length > 100) hist.shift();
        entries[idx].loginHistory = hist;
        if (msg.success) entries[idx].lastLogin = now;
        chrome.storage.local.set({ attempts, vault: entries });
      } else {
        chrome.storage.local.set({ attempts });
      }
    });
    return true;
  }

  // ── loginSubmitted / loginResult — outcome of an auto-filled login ──
  if (msg.action === 'loginSubmitted' && sender.tab) {
    getPending(p => { p[sender.tab.id] = { key: msg.urlKey, at: Date.now() }; setPending(p); });
    return;
  }
  if (msg.action === 'loginResult' && sender.tab) {
    getPending(p => { const rec = p[sender.tab.id]; if (rec && rec.key === msg.urlKey) resolveLogin(sender.tab.id, !!msg.success); });
    return;
  }

  // ── manualLoginSuccess — manual login history (capture watcher) ──
  if (msg.action === 'manualLoginSuccess') {
    chrome.storage.local.get(['vault','settings'], result => {
      if (result.settings && result.settings.encLocal && result.settings.encLocal.on) return; // no history while encrypted
      const entries = result.vault || [];
      const idx = entries.findIndex(e =>
        urlMatches(e.url, msg.url) && e.username === msg.username
      );
      if (idx < 0) return;

      const now  = new Date().toISOString();
      const hist = entries[idx].loginHistory || [];

      // Dedup — skip if a success was already written in last 5s (e.g. from reportAttempt)
      const last = hist[hist.length - 1];
      if (last && last.status === 'success'
          && (Date.now() - new Date(last.ts).getTime()) < 5000) return;

      hist.push({ ts: now, status: 'success' });
      if (hist.length > 100) hist.shift();
      entries[idx].loginHistory = hist;
      entries[idx].lastLogin    = now;
      chrome.storage.local.set({ vault: entries });
    });
    return true;
  }

});

// ── HELPERS ───────────────────────────────────────────────────────
// ── LOGIN OUTCOME ─────────────────────────────────────────────────
// A tab that submitted an auto-filled login stays "pending" (storage.session, survives
// the service worker sleeping) until we learn whether it worked. Two wrong results in
// a row pause auto-fill for that page — cleared by a working login, "Reset" in the
// popup, or saving a new password.
const WRONG_PW_LIMIT = 2;
function getPending(cb) { chrome.storage.session.get('pv_pending_login', r => cb((r && r.pv_pending_login) || {})); }
function setPending(p)  { chrome.storage.session.set({ pv_pending_login: p }); }
function wrongPwPaused(rec) { return (rec.wrongPw || 0) >= WRONG_PW_LIMIT; }
function isPaused(rec, max) { return (rec.count || 0) >= max || wrongPwPaused(rec); }

function resolveLogin(tabId, success) {
  getPending(p => {
    const rec = p[tabId];
    if (!rec) return;
    delete p[tabId];
    setPending(p);
    if (Date.now() - rec.at > 120000) return;   // too old to say anything about this login
    chrome.storage.local.get('attempts', r => {
      const attempts = r.attempts || {};
      if (success) delete attempts[rec.key];
      else {
        const a = attempts[rec.key] || { count: 0 };
        a.wrongPw = (a.wrongPw || 0) + 1;
        a.lastAt  = Date.now();
        attempts[rec.key] = a;
        if (wrongPwPaused(a)) chrome.tabs.sendMessage(tabId, { action: 'showToast', mode: 'wrongpw' }).catch(() => {});
      }
      chrome.storage.local.set({ attempts });
    });
  });
}

// Same rule as the popup: listed host or any subdomain of it ("www." ignored)
function isIgnoredSite(settings, url) {
  let h = '';
  try { h = new URL(url).hostname.replace(/^www\./, ''); } catch {}
  return !!h && (settings.neverSites || []).some(s => h === s || h.endsWith('.' + s));
}

function urlKey(url) {
  try { const u = new URL(url); return u.origin + u.pathname; }
  catch { return url; }
}

function b64d(s) { return Uint8Array.from(atob(s), c => c.charCodeAt(0)); }

// Resolve vault entries, decrypting if local encryption is on.
// cb(entries | null, encrypted) — entries is null when encrypted and locked.
function readVault(cb) {
  chrome.storage.local.get(['vault', 'vault_enc', 'settings'], async r => {
    const enc = !!(r.settings && r.settings.encLocal && r.settings.encLocal.on);
    if (!enc) { cb(r.vault || [], false); return; }
    try {
      const s = await chrome.storage.session.get('pv_datakey');
      if (!s.pv_datakey || !r.vault_enc) { cb(null, true); return; }
      const key = await crypto.subtle.importKey('raw', b64d(s.pv_datakey), 'AES-GCM', false, ['decrypt']);
      const pt  = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64d(r.vault_enc.iv) }, key, b64d(r.vault_enc.blob));
      cb(JSON.parse(new TextDecoder().decode(pt)), true);
    } catch { cb(null, true); }
  });
}

function urlMatches(stored, current) {
  if (!stored || !current) return false;
  try {
    const s = new URL(stored);
    const c = new URL(current);
    return s.origin === c.origin && c.pathname.startsWith(s.pathname);
  } catch { return stored === current; }
}
