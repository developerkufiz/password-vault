// ── content.js — PWD VAULT by KuFiz ─────────────────────────────
'use strict';

let _snapshot    = null;
let _watching    = false;
let _watchTimer  = null;
let _autoFilling = false; // flag: suppress capture during auto-fill

// ── INIT ───────────────────────────────────────────────────────────
(function init() {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startCaptureWatcher);
  } else {
    startCaptureWatcher();
  }
})();

// ── CAPTURE WATCHER ────────────────────────────────────────────────
function startCaptureWatcher() {
  let attached = false;
  let polls    = 0;

  function tryAttach() {
    const pf = document.querySelector('input[type=password]');
    if (pf && !pf.__pwdm_attached) { attachCapture(); attached = true; }
    polls++;
    if (polls < 150 && !attached) setTimeout(tryAttach, 300);
  }

  function startObserver() {
    const root = document.body || document.documentElement;
    if (!root) { setTimeout(startObserver, 50); return; }
    new MutationObserver(() => {
      const pf = document.querySelector('input[type=password]');
      if (pf && !pf.__pwdm_attached) { attachCapture(); attached = true; }
    }).observe(root, { childList: true, subtree: true });
  }

  startObserver();
  tryAttach();
}

// ── ATTACH CAPTURE LISTENERS ───────────────────────────────────────
function attachCapture() {
  const pf = document.querySelector('input[type=password]');
  if (!pf) return;
  pf.__pwdm_attached = true;

  document.querySelectorAll('button, input[type=submit], input[type=image]').forEach(btn => {
    if (btn.__pwdm) return;
    btn.__pwdm = true;
    btn.addEventListener('click', onAnyButtonClick, true);
  });

  document.querySelectorAll('form').forEach(form => {
    if (form.__pwdm_form) return;
    form.__pwdm_form = true;
    form.addEventListener('submit', onFormSubmit, true);
  });
}

// ── SUBMIT HANDLERS ────────────────────────────────────────────────
function onAnyButtonClick() {
  if (_autoFilling) return; // skip — auto-fill already handles history
  const pf = document.querySelector('input[type=password]');
  if (!pf || !pf.value) return;
  const uf = findUsernameAnywhere();
  if (!uf || !uf.value) return;
  doSnapshot(uf, pf);
}

function onFormSubmit() {
  if (_autoFilling) return;
  const pf = document.querySelector('input[type=password]');
  if (!pf || !pf.value) return;
  const uf = findUsernameAnywhere();
  if (!uf || !uf.value) return;
  doSnapshot(uf, pf);
}

// ── SNAPSHOT (manual logins only) ─────────────────────────────────
function doSnapshot(uf, pf) {
  // Debounce — ignore if a snapshot was taken in the last 2 seconds
  if (_snapshot && _snapshot._ts && (Date.now() - _snapshot._ts) < 2000) return;

  const allFields = [];
  document.querySelectorAll('input, select, textarea').forEach(el => {
    const type = (el.type || 'text').toLowerCase();
    if (['submit','reset','button','image','file','hidden','checkbox','radio'].includes(type)) return;
    if (!el.value) return;
    allFields.push({
      identifier: bestIdentifier(el),
      name: el.name || '', id: el.id || '', type,
      label: guessLabel(el), value: el.value,
      masked: type === 'password',
      role: el === uf ? 'username' : type === 'password' ? 'password' : 'extra'
    });
  });

  const selectors = { username: bestIdentifier(uf), password: bestIdentifier(pf), submit: '' };
  const sb = findSubmitButton();
  if (sb) {
    selectors.submit = bestIdentifier(sb);
    allFields.push({
      identifier: bestIdentifier(sb), name: sb.name || '', id: sb.id || '',
      type: (sb.type || 'button').toLowerCase(),
      label: sb.value || sb.textContent.trim().slice(0, 30) || 'Submit',
      value: sb.value || sb.textContent.trim().slice(0, 30) || '',
      masked: false, role: 'submit'
    });
  }

  _snapshot = {
    _ts: Date.now(),
    url: window.location.href, username: uf.value, password: pf.value,
    selectors, allFields
  };
  chrome.storage.local.set({ __pwdm_pending: _snapshot });
  startSuccessWatcher();
}

// ── SUCCESS WATCHER (manual logins only) ──────────────────────────
// Only runs after a manual doSnapshot — records ONE history entry when login succeeds
function startSuccessWatcher() {
  if (_watching) return;
  _watching = true;
  if (_watchTimer) clearInterval(_watchTimer);

  const startUrl = window.location.href;
  let checks = 0;

  try {
    const orig = window.location.reload.bind(window.location);
    window.location.reload = function(...a) {
      if (_snapshot) chrome.storage.local.set({ __pwdm_pending: _snapshot });
      orig(...a);
    };
  } catch(e) {}

  _watchTimer = setInterval(() => {
    checks++;
    const urlChanged  = window.location.href !== startUrl;
    const formGone    = !document.querySelector('input[type=password]');
    const btnDisabled = checks >= 2 && !!document.querySelector(
      'button[disabled], input[type=submit][disabled], input[type=image][disabled], input[type=button][disabled]'
    );

    if (urlChanged || formGone || btnDisabled) {
      clearInterval(_watchTimer);
      _watching = false;
      // Manual login succeeded — write exactly ONE history entry
      if (_snapshot) {
        chrome.runtime.sendMessage({
          action: 'manualLoginSuccess',
          url: _snapshot.url,
          username: _snapshot.username
        });
        _snapshot = null;
      }
      return;
    }

    if (checks >= 40) {
      clearInterval(_watchTimer);
      _watching = false;
      _snapshot = null;
      chrome.storage.local.remove('__pwdm_pending');
    }
  }, 300);
}

// ── MESSAGE LISTENER ──────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'autofill') {
    removeAccountPicker();
    _autoFilling = true;
    const ok = injectCredentials(
      msg.username, msg.password, msg.selectors || {},
      msg.autosubmit, msg.urlKey, msg.extraFields || []
    );
    // Clear flag after brief delay (enough for button-click event to fire & be suppressed)
    setTimeout(() => { _autoFilling = false; }, 1000);
    sendResponse({ success: ok });
  }
  if (msg.action === 'getCaptured')  { sendResponse({ captured: _snapshot }); }
  if (msg.action === 'clearCaptured') {
    _snapshot = null;
    chrome.storage.local.remove('__pwdm_pending');
    sendResponse({});
  }
  if (msg.action === 'highlightField') {
    clearAllHighlights();
    const isPass = msg.fieldType === 'pass';
    const color  = isPass ? '#ffb020' : '#00ffe7';
    const field  = msg.selector ? (queryField(msg.selector) || queryAny(msg.selector)) : null;
    const el     = field || (isPass ? findPasswordField() : findUsernameAnywhere());
    if (el) {
      el.__pwdm_prev_outline    = el.style.outline;
      el.__pwdm_prev_boxshadow  = el.style.boxShadow;
      el.__pwdm_prev_bg         = el.style.background;
      el.style.outline    = `2px solid ${color}`;
      el.style.boxShadow  = `0 0 10px ${color}80`;
      el.style.background = isPass ? 'rgba(255,176,32,.06)' : 'rgba(0,255,231,.06)';
      el.__pwdm_highlighted = true;
    }
    sendResponse({});
  }
  if (msg.action === 'clearHighlight') {
    clearAllHighlights();
    sendResponse({});
  }
  if (msg.action === 'getCurrentUsername') {
    const uf = findUsernameAnywhere();
    sendResponse({ username: uf?.value || null });
  }
  if (msg.action === 'showAccountPicker') {
    showAccountPicker(msg.accounts || []);
    sendResponse({ shown: true });
  }
  return true;
});

// ── ACCOUNT PICKER (multiple credentials for the same URL) ────────
let _pickerEsc     = null;
let _pickerOutside = null;

function showAccountPicker(accounts) {
  if (!accounts.length) return;
  // Already showing the same account list? skip re-render (prevents blink)
  const ex = document.getElementById('__pwdm_picker__');
  const sig = accounts.map(a => a.id).join(',');
  if (ex && ex.dataset.sig === sig) return;
  removeAccountPicker();
  // Wait for a login form before showing (up to 8s); stay silent if already logged in
  let tries = 0;
  (function wait() {
    if (document.querySelector('input[type=password]')) { renderAccountPicker(accounts, sig); return; }
    if (++tries < 40) setTimeout(wait, 200);
  })();
}

function removeAccountPicker() {
  const ex = document.getElementById('__pwdm_picker__');
  if (ex) ex.remove();
  if (_pickerEsc)     { document.removeEventListener('keydown', _pickerEsc); _pickerEsc = null; }
  if (_pickerOutside) { document.removeEventListener('click', _pickerOutside, true); _pickerOutside = null; }
}

function renderAccountPicker(accounts, sig) {
  removeAccountPicker();
  const ov = document.createElement('div');
  ov.id = '__pwdm_picker__';
  ov.dataset.sig = sig || accounts.map(a => a.id).join(',');
  ov.style.cssText = `position:fixed;top:14px;right:14px;z-index:2147483647;background:#0d1117;color:#c8d8e8;border:1px solid rgba(0,255,231,.35);border-radius:10px;font-family:'JetBrains Mono',monospace;font-size:11px;box-shadow:0 0 30px rgba(0,0,0,.6),0 0 12px rgba(0,255,231,.08);min-width:290px;max-width:350px;opacity:0;transform:translateY(-8px);transition:all .25s cubic-bezier(.34,1.56,.64,1);overflow:hidden;`;

  const rows = accounts.map((a, i) => {
    const initial = escapeHtml((a.username || '?').charAt(0).toUpperCase());
    const sub = escapeHtml(a.label || '') + ' · ' + (a.lastLogin ? pickerTimeAgo(a.lastLogin) : 'never logged in');
    return `
    <div class="__pwdm_acc" data-id="${i}" style="display:flex;align-items:center;gap:10px;padding:10px 12px;cursor:pointer;border-top:1px solid #1c2b3a;">
      <div style="width:28px;height:28px;border-radius:50%;background:rgba(0,255,231,.1);border:1px solid rgba(0,255,231,.3);color:#00ffe7;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:12px;flex-shrink:0;">${initial}</div>
      <div style="min-width:0;flex:1;">
        <div style="font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(a.username)}</div>
        <div style="font-size:9px;color:#62809a;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${sub}</div>
      </div>
      <div style="color:#62809a;flex-shrink:0;">›</div>
    </div>`;
  }).join('');

  ov.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 12px;border-bottom:1px solid #1c2b3a;">
      <span style="color:#00ffe7;font-weight:600;letter-spacing:1.5px;font-size:10px;">🔐 PWD VAULT — ${accounts.length} ACCOUNTS</span>
      <span class="__pwdm_close" style="cursor:pointer;color:#62809a;font-size:13px;padding:0 2px;">✕</span>
    </div>
    ${rows}
    <div style="padding:6px 12px;font-size:8px;color:#62809a;letter-spacing:1px;border-top:1px solid #1c2b3a;">CLICK ACCOUNT TO FILL · CLICK OUTSIDE / ESC TO CLOSE</div>`;
  document.body.appendChild(ov);
  requestAnimationFrame(() => { ov.style.opacity = '1'; ov.style.transform = 'translateY(0)'; });

  ov.querySelector('.__pwdm_close').addEventListener('click', removeAccountPicker);
  ov.querySelectorAll('.__pwdm_acc').forEach(row => {
    row.addEventListener('click', () => {
      const acc = accounts[Number(row.dataset.id)];
      removeAccountPicker();
      if (acc) chrome.runtime.sendMessage({ action: 'pickAccount', entryId: acc.id });
    });
    row.addEventListener('mouseenter', () => row.style.background = 'rgba(0,255,231,.06)');
    row.addEventListener('mouseleave', () => row.style.background = 'transparent');
  });
  _pickerEsc = e => { if (e.key === 'Escape') removeAccountPicker(); };
  document.addEventListener('keydown', _pickerEsc);
  // Click anywhere outside the picker dismisses it
  _pickerOutside = e => { if (!ov.contains(e.target)) removeAccountPicker(); };
  document.addEventListener('click', _pickerOutside, true);
}

function pickerTimeAgo(iso) {
  const sec = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (isNaN(sec) || sec < 0) return 'unknown';
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);   if (min < 60)  return `${min}m ago`;
  const hr  = Math.floor(min / 60);   if (hr  < 24)  return `${hr}h ago`;
  const d   = Math.floor(hr / 24);    if (d   < 30)  return `${d}d ago`;
  const mo  = Math.floor(d / 30);     if (mo  < 12)  return `${mo}mo ago`;
  return `${Math.floor(mo / 12)}y ago`;
}

function escapeHtml(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function clearAllHighlights() {
  document.querySelectorAll('input, textarea, select').forEach(el => {
    if (!el.__pwdm_highlighted) return;
    el.style.outline    = el.__pwdm_prev_outline   || '';
    el.style.boxShadow  = el.__pwdm_prev_boxshadow || '';
    el.style.background = el.__pwdm_prev_bg        || '';
    el.__pwdm_highlighted = false;
  });
}

// ── INJECT CREDENTIALS (auto-fill only) ───────────────────────────
function injectCredentials(username, password, selectors, autosubmit, urlKey, extraFields) {
  waitForFieldsReady(selectors, (uf, pf, noLoginForm) => {
    // No fields found AND no password input exists at all = already logged in, stay silent
    if (!uf && !pf) {
      if (!noLoginForm) {
        // There IS a login form but fields not found after retries = genuine fail
        if (urlKey) chrome.runtime.sendMessage({ action: 'reportAttempt', urlKey, success: false });
        showPageToast('fail');
      }
      // noLoginForm = already logged in, don't show anything
      return;
    }
    fillField(uf, username);
    fillField(pf, password);
    (extraFields || []).forEach(ef => {
      if (ef.selector && ef.value) {
        const el = queryField(ef.selector) || queryAny(ef.selector);
        if (el) fillField(el, ef.value);
      }
    });
    // Small delay before checking value — React/Vue update .value asynchronously
    setTimeout(() => {
      const ok = (!uf || uf.value === username) && (!pf || pf.value === password);
      if (urlKey) chrome.runtime.sendMessage({ action: 'reportAttempt', urlKey, success: ok });
      showPageToast(ok ? 'auto' : 'fail');
      if (ok && autosubmit) setTimeout(() => clickSubmit(selectors, pf, uf), 400);
    }, 100);
  });
  return true;
}

// Poll until fields found (up to 8s).
// noLoginForm=true means page has no password input at all (already logged in).
// noLoginForm=false means password input exists but fields not found after retries.
function waitForFieldsReady(selectors, callback) {
  let tries = 0;
  function attempt() {
    const uf = selectors.username ? queryField(selectors.username) : findUsernameAnywhere();
    const pf = selectors.password ? queryField(selectors.password) : findPasswordField();
    if (uf || pf) { callback(uf, pf, false); return; }
    if (++tries < 40) { setTimeout(attempt, 200); return; }
    // Timed out — check if there was ever a password field on this page
    const hasPasswordInput = !!document.querySelector('input[type=password]');
    callback(null, null, !hasPasswordInput); // noLoginForm = no password input found
  }
  attempt();
}

// ── FIND USERNAME ─────────────────────────────────────────────────
function findUsernameAnywhere() {
  const candidates = [
    'input[type=email]', 'input[autocomplete=username]', 'input[autocomplete=email]',
    'input[name=username]', 'input[name=user]', 'input[name=email]',
    'input[name=usr_id]', 'input[name=loginid]',
    'input[name*=user i]', 'input[name*=email i]', 'input[name*=login i]',
    'input[placeholder*=user i]', 'input[placeholder*=email i]',
    'input[type=text]'
  ];
  for (const sel of candidates) {
    try { const el = document.querySelector(sel); if (el && el.value && isVisible(el)) return el; } catch {}
  }
  return null;
}

// ── FIND SUBMIT BUTTON ────────────────────────────────────────────
function findSubmitButton() {
  for (const btn of document.querySelectorAll('button, input[type=button], input[type=submit], input[type=image]')) {
    if (!isVisible(btn)) continue;
    const text = (btn.textContent + btn.value + (btn.name || '')).toLowerCase();
    if (/sign.?in|log.?in|login|submit|masuk/.test(text)) return btn;
  }
  for (const sel of ['input[type=submit]','input[type=image]','button[type=submit]','button[type=button]','button:not([type])']) {
    const el = document.querySelector(sel);
    if (el && isVisible(el)) return el;
  }
  return null;
}

// ── SUBMIT CLICK ──────────────────────────────────────────────────
function clickSubmit(selectors, pf, uf) {
  if (selectors.submit) {
    const b = queryAny(selectors.submit);
    if (b) { b.click(); return; }
  }
  for (const btn of document.querySelectorAll('button, input[type=button], input[type=submit], input[type=image]')) {
    if (!isVisible(btn)) continue;
    const text = (btn.textContent + btn.value + (btn.name || '')).toLowerCase();
    if (/sign.?in|log.?in|login|submit|masuk/.test(text)) { btn.click(); return; }
  }
  const form = (pf || uf)?.closest('form');
  if (form) {
    const b = form.querySelector('input[type=submit], input[type=image], button[type=submit], button');
    if (b) { b.click(); return; }
    try { form.submit(); } catch(e) {}
    return;
  }
  const gb = document.querySelector('input[type=submit], input[type=image], button[type=submit], button[type=button]');
  if (gb && isVisible(gb)) gb.click();
}

// ── FILL FIELD ────────────────────────────────────────────────────
function fillField(el, value) {
  if (!el || value == null) return;
  el.focus();
  const ns = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
  if (ns) ns.call(el, value); else el.value = value;
  el.dispatchEvent(new Event('input',  { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
  el.blur();
}

// ── BEST IDENTIFIER ────────────────────────────────────────────────
function bestIdentifier(el) {
  if (!el) return '';
  if (el.name) return `name:${el.name}`;
  if (el.id)   return `#${el.id}`;
  const type = (el.type || '').toLowerCase();
  if (type && type !== 'text') return `input[type=${type}]`;
  return 'input[type=text]';
}

// ── GUESS LABEL ────────────────────────────────────────────────────
function guessLabel(el) {
  if (el.id) {
    try {
      const lbl = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (lbl) return lbl.textContent.trim().replace(/[:\*\s]+$/, '');
    } catch {}
  }
  if (el.getAttribute('aria-label')) return el.getAttribute('aria-label').trim();
  if (el.placeholder) return el.placeholder.trim();
  const parentLabel = el.closest('label');
  if (parentLabel) return parentLabel.textContent.trim().replace(/[:\*\s]+$/, '');
  const td = el.closest('td');
  if (td?.previousElementSibling) return td.previousElementSibling.textContent.trim().replace(/[:\*\s]+$/, '');
  return el.name || el.type || 'Field';
}

// ── SELECTORS ─────────────────────────────────────────────────────
function resolveSelector(raw) {
  raw = raw.trim(); if (!raw) return null;
  if (raw.startsWith('name:'))  return `[name="${raw.slice(5).trim()}"]`;
  if (raw.startsWith('class:')) return `.${raw.slice(6).trim()}`;
  if (raw.startsWith('id:'))    return `#${raw.slice(3).trim()}`;
  if (raw.startsWith('#') || raw.startsWith('.') || raw.includes('[') || raw.includes(' ')) return raw;
  return `#${raw}, [name="${raw}"]`;
}
function queryField(raw) {
  const css = resolveSelector(raw); if (!css) return null;
  for (const s of css.split(',').map(x => x.trim())) {
    try { const e = document.querySelector(s); if (e && isVisible(e)) return e; } catch {}
  }
  return null;
}
function queryAny(raw) {
  const css = resolveSelector(raw); if (!css) return null;
  for (const s of css.split(',').map(x => x.trim())) {
    try { const e = document.querySelector(s); if (e) return e; } catch {}
  }
  return null;
}
function findPasswordField() {
  for (const s of ['input[type=password]', 'input[autocomplete=current-password]']) {
    const e = document.querySelector(s); if (e && isVisible(e)) return e;
  }
  return null;
}
function isVisible(el) {
  if (!el) return false;
  const s = window.getComputedStyle(el);
  return s.display !== 'none' && s.visibility !== 'hidden' && el.offsetWidth > 0;
}

// ── PAGE TOAST ────────────────────────────────────────────────────
function showPageToast(mode, count, max) {
  const ex = document.getElementById('__pwdm__'); if (ex) ex.remove();
  const M = {
    auto:  { t:'⚡ PWD VAULT — AUTO FILLED',               c:'#00ffe7', b:'rgba(0,255,231,.4)' },
    manual:{ t:'⚡ PWD VAULT — FILLED',                    c:'#00ffe7', b:'rgba(0,255,231,.4)' },
    fail:  { t:'✕ PWD VAULT — FILL FAILED',               c:'#ff4060', b:'rgba(255,64,96,.4)' },
    locked:{ t:`🔒 PWD VAULT — LOCKED (${count}/${max})`, c:'#ff4060', b:'rgba(255,64,96,.4)' },
  };
  const m = M[mode] || M.manual;
  const d = document.createElement('div');
  d.id = '__pwdm__';
  d.style.cssText = `position:fixed;top:14px;right:14px;z-index:2147483647;background:#0d1117;color:${m.c};border:1px solid ${m.b};border-radius:8px;padding:9px 16px;font-family:'JetBrains Mono',monospace;font-size:11px;font-weight:600;letter-spacing:1.5px;box-shadow:0 0 20px ${m.b};opacity:0;transform:translateY(-8px);transition:all .3s cubic-bezier(.34,1.56,.64,1);pointer-events:none;`;
  d.textContent = m.t;
  document.body.appendChild(d);
  requestAnimationFrame(() => { d.style.opacity='1'; d.style.transform='translateY(0)'; });
  setTimeout(() => { d.style.opacity='0'; d.style.transform='translateY(-8px)'; setTimeout(()=>d.remove(),400); }, 3000);
}
