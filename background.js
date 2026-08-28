// ── background.js — PWD VAULT by KuFiz ──────────────────────────
'use strict';

// ── AUTO-FILL ON TAB LOAD ─────────────────────────────────────────
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete' || !tab.url) return;
  if (tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) return;

  chrome.storage.local.get(['vault','settings','attempts'], result => {
    const entries  = result.vault    || [];
    const settings = result.settings || {};
    const attempts = result.attempts || {};
    const max      = settings.maxAttempts || 5;

    const key = urlKey(tab.url);
    const rec = attempts[key] || { count: 0 };
    if (rec.count >= max) return;

    // All eligible matches — per-entry autofill override (null = use global)
    const eligible = entries.filter(e => {
      if (!urlMatches(e.url, tab.url)) return false;
      const af = (e.autofill !== null && e.autofill !== undefined) ? e.autofill : settings.autofill;
      return af;
    });
    console.log('[PWD Vault]', new URL(tab.url).host, '→', eligible.length, 'eligible credential(s)');
    if (!eligible.length) return;

    if (eligible.length === 1) {
      const e = eligible[0];
      const resolvedAutosubmit = (e.autosubmit !== null && e.autosubmit !== undefined) ? e.autosubmit : settings.autosubmit;
      setTimeout(() => {
        chrome.tabs.sendMessage(tabId, {
          action:      'autofill',
          username:    e.username,
          password:    e.password,
          selectors:   e.selectors   || {},
          extraFields: e.extraFields || [],
          autosubmit:  resolvedAutosubmit,
          urlKey:      key,
          maxAttempts: max
        }).catch(() => {});
      }, 900);
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

// Fill the account chosen in the content-script picker (password stays in background)
function fillChosenAccount(entry, tabId, tabUrl, settings, attempts) {
  const max = settings.maxAttempts || 5;
  const key = urlKey(tabUrl || entry.url);
  const rec = attempts[key] || { count: 0 };
  if (rec.count >= max) return;
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
}

// ── MESSAGE HANDLERS ──────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {

  // ── pickAccount — user chose an account in the on-page picker ────
  if (msg.action === 'pickAccount') {
    chrome.storage.local.get(['vault','settings','attempts'], result => {
      const entry = (result.vault || []).find(e => e.id === msg.entryId);
      if (!entry || !sender.tab) return;
      fillChosenAccount(entry, sender.tab.id, sender.tab.url, result.settings || {}, result.attempts || {});
    });
    return true;
  }

  // ── checkAutofill ────────────────────────────────────────────────
  if (msg.action === 'checkAutofill') {
    chrome.storage.local.get(['vault','settings','attempts'], result => {
      const entries  = result.vault    || [];
      const settings = result.settings || {};
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
      if (rec.count >= max) {
        sendResponse({ match: null, locked: true, count: rec.count, maxAttempts: max });
        return;
      }
      // Pass resolved settings so content.js uses the right autosubmit value
      sendResponse({ match, settings: { ...settings, autosubmit: resolvedAutosubmit }, urlKey: key, maxAttempts: max });
    });
    return true;
  }

  // ── reportAttempt — auto-fill history (single source of truth) ───
  if (msg.action === 'reportAttempt') {
    chrome.storage.local.get(['attempts','settings','vault'], result => {
      const attempts = result.attempts || {};
      const entries  = result.vault    || [];
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

      // Update lockout counter
      if (msg.success) {
        delete attempts[key];
      } else {
        const rec  = attempts[key] || { count: 0 };
        rec.count  = (rec.count || 0) + 1;
        rec.lastAt = Date.now();
        if (rec.count >= max) rec.lockedAt = Date.now();
        attempts[key] = rec;
      }

      // Write ONE history entry
      if (idx >= 0) {
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

  // ── manualLoginSuccess — manual login history (capture watcher) ──
  if (msg.action === 'manualLoginSuccess') {
    chrome.storage.local.get('vault', result => {
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
function urlKey(url) {
  try { const u = new URL(url); return u.origin + u.pathname; }
  catch { return url; }
}

function urlMatches(stored, current) {
  if (!stored || !current) return false;
  try {
    const s = new URL(stored);
    const c = new URL(current);
    return s.origin === c.origin && c.pathname.startsWith(s.pathname);
  } catch { return stored === current; }
}
