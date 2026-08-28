// ── STATE ──────────────────────────────────────────────────────────
let entries  = [];
let settings = { autofill:true, autosubmit:false, notify:true, maxAttempts:5, capture:true, theme:'dark', sortDir:'asc', autoLockMin:5 };
let attempts = {};
let _unlockAt = null;   // ms timestamp of last Master-PIN unlock (kept in chrome.storage.session)
let _lastBump = 0;
let currentTab = null;
let pendingCapture = null;
let folders = [];

const DEFAULT_FOLDERS = [
  { id: 'f_prd', name: 'PRD', color: '#ff4060', order: 0 },
  { id: 'f_uat', name: 'UAT', color: '#ffb020', order: 1 },
  { id: 'f_dev', name: 'DEV', color: '#00b4ff', order: 2 },
];

// ── INIT ───────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  await loadData();
  await loadUnlockState();
  // Migrate: drop legacy drag-order
  if (settings.cardOrder) { delete settings.cardOrder; chrome.storage.local.set({ settings }); }
  await loadCurrentTab();
  applyTheme(settings.theme || 'dark');
  renderVault();
  renderStats();
  renderFolderManager();
  refreshFolderSelects();
  applySettings();
  renderLockoutList();
  setupTabs();
  setupSearch();
  updateSortBtn();
  prefillUrl();
  bindEvents();
  checkPendingCapture();
  updateLocalLockUI();
  refreshTotps();
  setInterval(refreshTotps, 1000);

  if (window.Cloud) {
    Cloud.init({
      onChange: () => {
        renderVault(currentSearch());
        renderStats();
        renderFolderManager();
        refreshFolderSelects();
        renderLockoutList();
      }
    });
  }
});

// ── THEME ──────────────────────────────────────────────────────────
function applyTheme(t) {
  document.documentElement.setAttribute('data-theme', t);
  document.getElementById('themeToggleBtn').textContent = t === 'dark' ? '☀️' : '🌙';
}
function toggleTheme() {
  const next = (settings.theme||'dark') === 'dark' ? 'light' : 'dark';
  settings.theme = next; chrome.storage.local.set({ settings }); applyTheme(next);
}

// ── EXTRA FIELDS BUILDER ───────────────────────────────────────────
// extraFields = [{ label, selector, value }]

function renderExtraFieldRows(containerId, fields) {
  const container = document.getElementById(containerId);
  container.innerHTML = '';
  (fields || []).forEach((f, i) => addExtraFieldRow(containerId, f, i));
}

function addExtraFieldRow(containerId, data = {}, idx = null) {
  const container = document.getElementById(containerId);
  const row = document.createElement('div');
  row.className = 'extra-field-row';
  row.dataset.idx = idx !== null ? idx : container.children.length;

  row.innerHTML = `
    <div class="extra-field-col">
      <label>Field Label</label>
      <input type="text" class="ef-label" placeholder="Company Code, Branch ID…" value="${escAttr(data.label||'')}">
    </div>
    <div class="extra-field-col">
      <label>Selector</label>
      <input type="text" class="ef-selector sel-val" placeholder="name:companycode or #branch" value="${escAttr(data.selector||'')}">
    </div>
    <div class="extra-field-col" style="grid-column:1/-1">
      <label>Value to fill</label>
      <input type="text" class="ef-value" placeholder="e.g. COMP001  or  leave blank to fill manually" value="${escAttr(data.value||'')}">
    </div>
    <button class="btn-remove-field" title="Remove field">✕</button>
  `;

  row.querySelector('.btn-remove-field').addEventListener('click', () => row.remove());
  container.appendChild(row);
}

function collectExtraFields(containerId) {
  const rows = document.querySelectorAll(`#${containerId} .extra-field-row`);
  const fields = [];
  rows.forEach(row => {
    const label    = row.querySelector('.ef-label').value.trim();
    const selector = row.querySelector('.ef-selector').value.trim();
    const value    = row.querySelector('.ef-value').value.trim();
    if (selector) fields.push({ label: label || 'Extra Field', selector, value });
  });
  return fields;
}

// ── EVENT BINDING ──────────────────────────────────────────────────
function bindEvents() {
  document.getElementById('themeToggleBtn').addEventListener('click', toggleTheme);
  document.getElementById('sortDirBtn').addEventListener('click', toggleSortDir);

  // Add panel
  document.getElementById('saveEntryBtn').addEventListener('click', saveEntry);
  const pwBtn = document.getElementById('pwToggleBtn');
  pwBtn.addEventListener('click', () => togglePw('addPassword', pwBtn));
  document.getElementById('addPassword').addEventListener('input', e => checkStrength(e.target.value, 'strengthFill', 'strengthText'));
  document.getElementById('genPwBtn').addEventListener('click', () => {
    const inp = document.getElementById('addPassword');
    inp.value = generatePassword(20);
    inp.type = 'text';
    document.getElementById('pwToggleBtn').textContent = '🙈';
    checkStrength(inp.value, 'strengthFill', 'strengthText');
  });
  document.getElementById('helpToggle').addEventListener('click', () => document.getElementById('helpBox').classList.toggle('open'));
  const openShortcuts = document.getElementById('openShortcuts');
  if (openShortcuts) openShortcuts.addEventListener('click', () => chrome.tabs.create({ url: 'chrome://extensions/shortcuts' }));
  document.getElementById('addExtraFieldBtn').addEventListener('click', () => addExtraFieldRow('addExtraList'));

  // Settings
  document.getElementById('toggleAutofill').addEventListener('change',  e => saveSetting('autofill', e.target.checked));
  document.getElementById('toggleCapture').addEventListener('change',   e => saveSetting('capture',  e.target.checked));
  document.getElementById('toggleAutosubmit').addEventListener('change',e => saveSetting('autosubmit', e.target.checked));
  document.getElementById('toggleNotify').addEventListener('change',    e => saveSetting('notify',   e.target.checked));
  document.getElementById('maxAttemptsInput').addEventListener('change', e => {
    const v = Math.max(1, Math.min(99, parseInt(e.target.value)||5));
    e.target.value = v; saveSetting('maxAttempts', v);
  });
  document.getElementById('autoLockInput').addEventListener('change', e => {
    const v = Math.max(0, Math.min(120, parseInt(e.target.value) || 0));
    e.target.value = v; saveSetting('autoLockMin', v);
  });
  document.getElementById('lockNowBtn').addEventListener('click', () => lockNow());
  document.getElementById('healthScanBtn').addEventListener('click', () => gatePin(renderHealthReport));
  document.getElementById('healthReport').addEventListener('click', e => {
    const row = e.target.closest('.health-row');
    if (row) { document.querySelector('.tab[data-tab="vault"]').click(); openEditModal(row.dataset.id); }
  });
  document.getElementById('importCsvBtn').addEventListener('click', () => document.getElementById('importCsvFile').click());
  document.getElementById('importCsvFile').addEventListener('change', importCSV);
  ['keydown','click'].forEach(ev => document.addEventListener(ev, bumpActivity, true));
  setInterval(() => {
    if (settings.masterPin && _unlockAt != null && !isUnlocked()) lockNow({ silent: true });
  }, 10000);
  // Folders
  document.getElementById('addFolderBtn').addEventListener('click', addFolder);
  const fm = document.getElementById('folderManager');
  fm.addEventListener('input',  handleFolderFieldEdit);
  fm.addEventListener('change', commitFolderEdit);
  fm.addEventListener('blur',   commitFolderEdit, true);
  fm.addEventListener('click',  handleFolderManagerClick);
  // Master PIN
  const masterPinEye = document.getElementById('masterPinEye');
  const masterInp    = document.getElementById('masterPinInput');
  if (masterPinEye) masterPinEye.addEventListener('click', () => {
    masterInp.type = masterInp.type === 'password' ? 'text' : 'password';
  });
  if (masterInp) {
    masterInp.addEventListener('keydown', e => {
      if (!/^[0-9]$/.test(e.key) && !['Backspace','Delete','Tab','ArrowLeft','ArrowRight'].includes(e.key)) {
        e.preventDefault();
      }
    });
    masterInp.addEventListener('input', () => {
      masterInp.style.borderColor = masterInp.value.length === 6 ? 'var(--accent)' : '';
    });
  }
  const savePinBtn  = document.getElementById('saveMasterPinBtn');
  const resetPinBtn = document.getElementById('resetMasterPinBtn');
  if (savePinBtn)  savePinBtn.addEventListener('click', saveMasterPin);
  if (resetPinBtn) resetPinBtn.addEventListener('click', resetMasterPin);
  const genRecBtn   = document.getElementById('genRecoveryBtn');
  const resetRecBtn = document.getElementById('resetWithRecoveryBtn');
  if (genRecBtn)   genRecBtn.addEventListener('click', generateRecoveryCode);
  if (resetRecBtn) resetRecBtn.addEventListener('click', resetPinWithRecovery);
  const encToggle = document.getElementById('toggleEncLocal');
  if (encToggle) encToggle.addEventListener('change', e => {
    if (e.target.checked) enableLocalEnc(); else disableLocalEnc();
    setTimeout(applySettings, 50);
  });
  const llBtn = document.getElementById('localLockBtn');
  const llInp = document.getElementById('localLockInput');
  if (llBtn) llBtn.addEventListener('click', unlockLocal);
  if (llInp) llInp.addEventListener('keydown', e => { if (e.key === 'Enter') unlockLocal(); });

  // PIN modal
  document.getElementById('pinModalClose').addEventListener('click', closePinModal);
  document.getElementById('pinModal').addEventListener('click', e => { if (e.target === e.currentTarget) closePinModal(); });
  document.getElementById('pinConfirmBtn').addEventListener('click', confirmPin);
  document.getElementById('pinEye').addEventListener('click', () => {
    const inp = document.getElementById('pinInput');
    inp.type = inp.type === 'password' ? 'text' : 'password';
  });
  const pinInputEl = document.getElementById('pinInput');
  pinInputEl.addEventListener('keydown', e => {
    if (e.key === 'Enter') { confirmPin(); return; }
    // Only allow digits, backspace, delete, tab, arrows
    if (!/^[0-9]$/.test(e.key) && !['Backspace','Delete','Tab','ArrowLeft','ArrowRight'].includes(e.key)) {
      e.preventDefault();
    }
  });
  pinInputEl.addEventListener('input', () => {
    // Auto-confirm when 6 digits entered
    if (pinInputEl.value.length === 6) setTimeout(confirmPin, 120);
  });

  document.getElementById('exportBtn').addEventListener('click', exportJSON);
  document.getElementById('downloadDocsBtn').addEventListener('click', downloadDocs);
  document.getElementById('importBtn').addEventListener('click', () => document.getElementById('importFile').click());
  document.getElementById('importFile').addEventListener('change', importJSON);
  document.getElementById('wipeBtn').addEventListener('click', clearVault);
  document.getElementById('lockoutList').addEventListener('click', e => {
    const btn = e.target.closest('[data-unlock]');
    if (btn) unlockEntry(decodeURIComponent(btn.dataset.unlock));
  });

  // Vault delegation
  document.getElementById('entryList').addEventListener('click', handleEntryClick);
  document.getElementById('entryList').addEventListener('mouseover', handleHighlightOver);
  document.getElementById('entryList').addEventListener('mouseout',  handleHighlightOut);

  // Capture banner
  document.getElementById('captureSaveBtn').addEventListener('click', saveCapture);
  document.getElementById('captureDismissBtn').addEventListener('click', dismissCapture);

  // Edit modal
  document.getElementById('modalCloseBtn').addEventListener('click', closeEditModal);
  document.getElementById('editCancelBtn').addEventListener('click', closeEditModal);
  document.getElementById('editSaveBtn').addEventListener('click', saveEdit);
  document.getElementById('editAddExtraFieldBtn').addEventListener('click', () => addExtraFieldRow('editExtraList'));
  const editPwEye = document.getElementById('editPwEye');
  editPwEye.addEventListener('click', () => {
    const inp       = document.getElementById('editPassword');
    const pinToggle = document.getElementById('editPinProtect');
    // Already visible — clicking eye hides it again, no PIN needed
    if (inp.type === 'text') {
      inp.type = 'password';
      updatePinEyeIcon();
      return;
    }
    // Toggle ON = PIN protect active → require PIN to reveal
    // Toggle OFF = no protection → reveal freely
    const pinActive = settings.masterPin && pinToggle && pinToggle.checked;
    if (pinActive) {
      gatePin(() => {
        inp.type = 'text';
        updatePinEyeIcon();
      });
    } else {
      inp.type = 'text';
      updatePinEyeIcon();
    }
  });

  // PIN PROTECT TOGGLE behavior:
  // Turning OFF → must enter PIN first (proves authorization before removing protection)
  // Turning ON  → immediate, no PIN needed (just re-enabling protection)
  document.getElementById('editPinProtect').addEventListener('change', function() {
    const toggleEl  = this;
    const isNowOff  = !toggleEl.checked;
    if (isNowOff && settings.masterPin) {
      // Revert to ON visually until PIN confirmed
      toggleEl.checked = true;
      openPinModal(() => {
        // PIN correct — turn OFF and save immediately
        toggleEl.checked = false;
        savePinProtectState(false);
        const inp = document.getElementById('editPassword');
        inp.type = 'password';
        updatePinEyeIcon();
      });
    } else {
      // Turning ON — save immediately
      savePinProtectState(true);
      const inp = document.getElementById('editPassword');
      inp.type = 'password';
      updatePinEyeIcon();
    }
  });
  document.getElementById('editPassword').addEventListener('input', e => checkStrength(e.target.value, 'editStrengthFill', 'editStrengthText'));

  // Behaviour pill buttons — click to switch GLOBAL ↔ INDIVIDUAL
  ['Autofill','Autosubmit'].forEach(name => {
    const modeBtn = document.getElementById(`edit${name}ModeBtn`);
    const toggle  = document.getElementById(`edit${name}Toggle`);
    if (!modeBtn) return;

    // Click pill to toggle mode
    modeBtn.addEventListener('click', () => {
      const isNowIndividual = !modeBtn.classList.contains('individual');
      const key = name.toLowerCase();
      if (isNowIndividual) {
        // Switch to INDIVIDUAL — enable toggle, keep current value
        toggle.parentElement.classList.remove('entry-toggle-disabled');
        modeBtn.textContent = 'INDIVIDUAL';
        modeBtn.classList.add('individual');
        const desc = document.getElementById(`edit${name}Desc`);
        if (desc) desc.textContent = 'Using individual setting';
      } else {
        // Switch back to GLOBAL — disable toggle, mirror global
        toggle.checked = !!settings[key];
        toggle.parentElement.classList.add('entry-toggle-disabled');
        modeBtn.textContent = 'GLOBAL';
        modeBtn.classList.remove('individual');
        const desc = document.getElementById(`edit${name}Desc`);
        if (desc) desc.textContent = 'Following global setting';
      }
    });
  });
  document.getElementById('editModal').addEventListener('click', e => { if (e.target === e.currentTarget) closeEditModal(); });
  document.getElementById('historyModalClose').addEventListener('click', closeHistoryModal);
  document.getElementById('historyModal').addEventListener('click', e => { if (e.target === e.currentTarget) closeHistoryModal(); });
}

function handleEntryClick(e) {
  // Folder group collapse/expand
  const fHead = e.target.closest('[data-action="folder-toggle"]');
  if (fHead) {
    const grp = fHead.closest('.folder-group');
    const key = fHead.dataset.folder;
    if (grp) {
      grp.classList.toggle('collapsed');
      settings.collapsedFolders = settings.collapsedFolders || {};
      if (grp.classList.contains('collapsed')) settings.collapsedFolders[key] = true;
      else delete settings.collapsedFolders[key];
      chrome.storage.local.set({ settings });
    }
    return;
  }

  // Collapse toggle — click anywhere on header
  const header = e.target.closest('[data-action="toggle"]');
  if (header) {
    const card = e.target.closest('.entry-card');
    if (card && !e.target.closest('button')) {
      card.classList.toggle('collapsed');
      // Persist collapse state
      const id = card.dataset.id;
      if (id) {
        settings.collapsedCards = settings.collapsedCards || {};
        if (card.classList.contains('collapsed')) {
          settings.collapsedCards[id] = true;
        } else {
          delete settings.collapsedCards[id];
        }
        chrome.storage.local.set({ settings });
      }
      return;
    }
  }
  const btn = e.target.closest('button[data-action]');
  if (!btn) return;
  const { action, id, value, label, url } = btn.dataset;
  if (action === 'copy') {
    if (label === 'Password') {
      const entry = entries.find(x => x.id === id);
      // pinProtect ON (default true) + masterPin set = require PIN
      // pinProtect OFF = copy freely
      const pinActive = settings.masterPin && (entry ? entry.pinProtect !== false : true);
      if (pinActive) {
        gatePin(() => copyField(value, label));
        return;
      }
    }
    copyField(value, label);
  }
  if (action === 'copy-totp') {
    const entry = entries.find(x => x.id === id);
    if (entry && entry.totp) {
      totpCode(entry.totp)
        .then(code => navigator.clipboard.writeText(code))
        .then(() => showToast('2FA code copied'))
        .catch(() => showToast('Bad 2FA key', 'error'));
    }
  }
  if (action === 'fill')    triggerAutofill(id);
  if (action === 'delete')  deleteEntry(id);
  if (action === 'edit')    openEditModal(id);
  if (action === 'unlock')  unlockEntry(urlKey(decodeURIComponent(url)));
  if (action === 'history') openHistoryModal(id);
}

// ── DATA ───────────────────────────────────────────────────────────
function chromeGet(keys)      { return new Promise(r => chrome.storage.local.get(keys, r)); }
function chromeSet(obj)       { return new Promise(r => chrome.storage.local.set(obj, r)); }
function chromeRemove(keys)   { return new Promise(r => chrome.storage.local.remove(keys, r)); }

async function loadData() {
  const r = await chromeGet(['vault','vault_enc','settings','attempts','folders']);
  if (r.settings) settings = { ...settings, ...r.settings };
  if (r.attempts) attempts = r.attempts;
  if (Array.isArray(r.folders)) {
    folders = r.folders;
  } else {
    folders = DEFAULT_FOLDERS.map(f => ({ ...f }));
    chrome.storage.local.set({ folders });
  }
  if (encLocalOn()) {
    await loadStashedDataKey();
    if (_dataKey && r.vault_enc) {
      try { entries = await aesDecrypt(_dataKey, r.vault_enc); }
      catch { _dataKey = null; entries = []; }
    } else {
      entries = [];                 // locked — unlockLocal() fills entries
    }
  } else if (r.vault) {
    entries = r.vault;
  }
}

async function loadUnlockState() {
  return new Promise(res => {
    try {
      chrome.storage.session.get('pv_unlock', r => {
        _unlockAt = (r && r.pv_unlock && r.pv_unlock.at) || null;
        res();
      });
    } catch { res(); }
  });
}

// ── AUTO-LOCK ────────────────────────────────────────────────────
function isUnlocked() {
  if (!settings.masterPin) return true;
  if (_unlockAt == null) return false;
  const mins = settings.autoLockMin;
  if (!mins || mins <= 0) return true;               // 0 = stay unlocked for the session
  return (Date.now() - _unlockAt) < mins * 60000;
}
function markUnlocked() {
  _unlockAt = Date.now();
  try { chrome.storage.session.set({ pv_unlock: { at: _unlockAt } }); } catch {}
}
function bumpActivity() {
  if (_unlockAt == null) return;                     // only extend an existing unlock
  const now = Date.now();
  _unlockAt = now;
  if (now - _lastBump > 5000) {
    _lastBump = now;
    try { chrome.storage.session.set({ pv_unlock: { at: now } }); } catch {}
  }
}
function gatePin(cb) {
  if (isUnlocked()) { bumpActivity(); cb(); }
  else openPinModal(cb);
}
function lockNow(opts = {}) {
  _unlockAt = null;
  try { chrome.storage.session.remove('pv_unlock'); } catch {}
  const ep = document.getElementById('editPassword');
  if (ep && ep.type === 'text') { ep.type = 'password'; updatePinEyeIcon(); }
  if (window.Cloud && Cloud.lock && settings.lockCloud !== false) Cloud.lock();
  if (encLocalOn()) {
    _dataKey = null;
    try { chrome.storage.session.remove('pv_datakey'); } catch {}
    entries = [];
    closeEditModal();
    renderVault();
    updateLocalLockUI();
  }
  if (!opts.silent) showToast('🔒 Locked');
}

async function loadCurrentTab() {
  return new Promise(resolve => {
    chrome.tabs.query({ active:true, currentWindow:true }, tabs => {
      if (tabs[0]) {
        currentTab = tabs[0];
        try {
          const u = new URL(tabs[0].url);
          document.getElementById('currentUrl').textContent = u.hostname + u.pathname;
        } catch { document.getElementById('currentUrl').textContent = tabs[0].url || '—'; }
      }
      resolve();
    });
  });
}

function prefillUrl() {
  if (currentTab?.url) document.getElementById('addUrl').value = currentTab.url;
}

function persist() {
  if (encLocalOn()) {
    if (_dataKey) aesEncrypt(_dataKey, entries).then(rec => chrome.storage.local.set({ vault_enc: rec }));
  } else {
    chrome.storage.local.set({ vault: entries });
  }
  if (window.Cloud) Cloud.schedulePush();
}
function persistFolders() { chrome.storage.local.set({ folders }); if (window.Cloud) Cloud.schedulePush(); }

// ── FOLDERS ────────────────────────────────────────────────────────
function currentSearch() {
  const el = document.getElementById('searchInput');
  return el ? el.value.toLowerCase() : '';
}

function folderOptionsHtml(selected) {
  const opts = ['<option value="">— Ungrouped —</option>'];
  folders.slice().sort((a, b) => (a.order || 0) - (b.order || 0)).forEach(f => {
    opts.push(`<option value="${escAttr(f.id)}"${f.id === selected ? ' selected' : ''}>${escHtml(f.name)}</option>`);
  });
  return opts.join('');
}

function refreshFolderSelects() {
  const add = document.getElementById('addFolder');
  if (add)  { const v = add.value;  add.innerHTML  = folderOptionsHtml(v); }
  const edit = document.getElementById('editFolder');
  if (edit) { const v = edit.value; edit.innerHTML = folderOptionsHtml(v); }
}

function renderFolderManager() {
  const box = document.getElementById('folderManager');
  if (!box) return;
  if (!folders.length) { box.innerHTML = '<div class="lockout-empty">No folders — add one below</div>'; return; }
  box.innerHTML = folders
    .slice().sort((a, b) => (a.order || 0) - (b.order || 0))
    .map(f => {
      const cnt = entries.filter(e => e.folderId === f.id).length;
      return `
      <div class="folder-row" data-id="${escAttr(f.id)}">
        <input type="color" class="folder-color" value="${escAttr(f.color || '#00b4ff')}" title="Folder colour">
        <input type="text" class="folder-label" value="${escAttr(f.name)}" maxlength="24" spellcheck="false">
        <span class="folder-row-count">${cnt}</span>
        <button class="btn-remove-field folder-del" title="Delete folder">✕</button>
      </div>`;
    }).join('');
}

function addFolder() {
  folders.push({
    id:    'f_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
    name:  'New Folder',
    color: '#00b4ff',
    order: folders.length,
    updated: new Date().toISOString()
  });
  persistFolders();
  renderFolderManager();
  refreshFolderSelects();
  renderVault(currentSearch());
}

function handleFolderFieldEdit(e) {
  const row = e.target.closest('.folder-row'); if (!row) return;
  const f = folders.find(x => x.id === row.dataset.id); if (!f) return;
  if (e.target.classList.contains('folder-label')) f.name  = e.target.value.trim() || f.name;
  if (e.target.classList.contains('folder-color')) f.color = e.target.value;
  f.updated = new Date().toISOString();
}

function commitFolderEdit(e) {
  if (!e.target.closest('.folder-row')) return;
  handleFolderFieldEdit(e);
  persistFolders();
  refreshFolderSelects();
  renderVault(currentSearch());
}

function handleFolderManagerClick(e) {
  const del = e.target.closest('.folder-del'); if (!del) return;
  const row = del.closest('.folder-row');
  const id  = row.dataset.id;
  const f   = folders.find(x => x.id === id);
  const cnt = entries.filter(x => x.folderId === id).length;
  if (!confirm(`Delete folder "${f ? f.name : ''}"?` + (cnt ? `\n${cnt} credential(s) will move to Ungrouped.` : ''))) return;
  folders = folders.filter(x => x.id !== id);
  entries.forEach(x => { if (x.folderId === id) x.folderId = null; });
  persistFolders();
  persist();
  renderFolderManager();
  refreshFolderSelects();
  renderVault(currentSearch());
  renderStats();
}

// ── TABS ───────────────────────────────────────────────────────────
function setupTabs() {
  document.querySelectorAll('.tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('panel-' + btn.dataset.tab).classList.add('active');
      if (btn.dataset.tab === 'settings') { renderLockoutList(); renderFolderManager(); }
    });
  });

  document.querySelectorAll('.subtab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.subtab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.subpanel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('sub-' + btn.dataset.sub).classList.add('active');
    });
  });
}

function resetAddSubTab() {
  document.querySelectorAll('#panel-add .subtab').forEach((t, i) => t.classList.toggle('active', i === 0));
  document.querySelectorAll('#panel-add .subpanel').forEach((p, i) => p.classList.toggle('active', i === 0));
}

// ── AUTO-CAPTURE ───────────────────────────────────────────────────
function checkPendingCapture() {
  // Read from storage — this is where content.js writes BEFORE page unloads
  // so it survives full page reloads and redirects
  chrome.storage.local.get('__pwdm_pending', result => {
    if (!result.__pwdm_pending) return;
    showCaptureBanner(result.__pwdm_pending);
  });
}

function showCaptureBanner(captured) {
  if (!settings.capture) return;
  const exists = entries.some(e => urlMatches(e.url, captured.url) && e.username === captured.username);
  if (exists) { chrome.storage.local.remove('__pwdm_pending'); return; }

  pendingCapture = captured;

  // URL
  document.getElementById('captureUrl').textContent = captured.url || '';

  // Build full field rows
  const list = document.getElementById('captureFieldsList');
  const fields = captured.allFields || [];

  if (fields.length === 0) {
    // fallback for old captures without allFields
    list.innerHTML = `
      <div class="capture-field-row role-username">
        <div class="cf-role-icon">👤</div>
        <div class="cf-meta"><div class="cf-label">Username</div><div class="cf-identifier">${escHtml(captured.selectors?.username||'')}</div></div>
        <div class="cf-value">${escHtml(captured.username||'—')}</div>
        <div class="cf-badge u">USER</div>
      </div>
      <div class="capture-field-row role-password">
        <div class="cf-role-icon">🔑</div>
        <div class="cf-meta"><div class="cf-label">Password</div><div class="cf-identifier">${escHtml(captured.selectors?.password||'')}</div></div>
        <div class="cf-value masked">${'•'.repeat(Math.min((captured.password||'').length,14))}</div>
        <div class="cf-badge p">PASS</div>
      </div>`;
  } else {
    list.innerHTML = fields.map(f => {
      const roleClass = f.role === 'username' ? 'role-username'
                      : f.role === 'password' ? 'role-password'
                      : f.role === 'submit'   ? 'role-submit'
                      : 'role-extra';
      const icon      = f.role === 'username' ? '👤'
                      : f.role === 'password' ? '🔑'
                      : f.role === 'submit'   ? '⏎'
                      : '📋';
      const badgeCls  = f.role === 'username' ? 'u'
                      : f.role === 'password' ? 'p'
                      : f.role === 'submit'   ? 's'
                      : 'e';
      const badgeLbl  = f.role === 'username' ? 'USER'
                      : f.role === 'password' ? 'PASS'
                      : f.role === 'submit'   ? 'BTN'
                      : 'EXTRA';
      const displayVal = f.masked
        ? '•'.repeat(Math.min((f.value||'').length, 14))
        : escHtml(f.value || '—');
      const valClass = f.masked ? 'cf-value masked' : 'cf-value';

      // Show all identifiers we know about
      const idParts = [];
      if (f.identifier) idParts.push(f.identifier);
      if (f.id && !f.identifier.includes(f.id))    idParts.push(`id="${f.id}"`);
      if (f.name && !f.identifier.includes(f.name)) idParts.push(`name="${f.name}"`);
      if (f.type && f.type !== 'text') idParts.push(`type=${f.type}`);
      const idStr = idParts.slice(0,2).join(' · ');

      return `
        <div class="capture-field-row ${roleClass}">
          <div class="cf-role-icon">${icon}</div>
          <div class="cf-meta">
            <div class="cf-label">${escHtml(f.label || f.name || f.type || 'Field')}</div>
            <div class="cf-identifier">${escHtml(idStr)}</div>
          </div>
          <div class="${valClass}">${displayVal}</div>
          <div class="cf-badge ${badgeCls}">${badgeLbl}</div>
        </div>`;
    }).join('');
  }

  document.getElementById('captureBanner').classList.add('show');
}

function saveCapture() {
  if (!pendingCapture) return;
  const c = pendingCapture;
  entries.push({
    id:          Date.now().toString(36) + Math.random().toString(36).slice(2),
    label:       extractDomain(c.url),
    url:         c.url,
    username:    c.username,
    password:    c.password,
    notes:       'Auto-captured',
    selectors:   c.selectors || {},
    extraFields: [],           // no extra fields on auto-capture — user adds manually via Edit
    strength:    getStrengthLevel(c.password),
    captured:    true,
    created:     new Date().toISOString(),
    updated:     new Date().toISOString()
  });
  persist(); renderVault(); renderStats();
  // Clear pending from storage
  chrome.storage.local.remove('__pwdm_pending');
  pendingCapture = null;
  document.getElementById('captureBanner').classList.remove('show');
  showToast('✓ Credential captured & saved');
  if (currentTab) {
    chrome.tabs.sendMessage(currentTab.id, { action: 'clearCaptured' }, () => {
      chrome.runtime.lastError;
    });
  }
}

function dismissCapture() {
  pendingCapture = null;
  document.getElementById('captureBanner').classList.remove('show');
  // Clear from storage so it doesn't show again
  chrome.storage.local.remove('__pwdm_pending');
  // Also clear from content script if still on same page
  if (currentTab) {
    chrome.tabs.sendMessage(currentTab.id, { action: 'clearCaptured' }, () => {
      chrome.runtime.lastError; // suppress error if content script gone
    });
  }
}

// ── SAVE ENTRY ─────────────────────────────────────────────────────
function saveEntry() {
  const label = document.getElementById('addLabel').value.trim();
  const url   = document.getElementById('addUrl').value.trim();
  const user  = document.getElementById('addUsername').value.trim();
  const pass  = document.getElementById('addPassword').value;
  const notes = document.getElementById('addNotes').value.trim();
  const totp  = normalizeTotp(document.getElementById('addTotp').value);
  const selU  = document.getElementById('selUsername').value.trim();
  const selP  = document.getElementById('selPassword').value.trim();
  const selS  = document.getElementById('selSubmit').value.trim();
  const extra = collectExtraFields('addExtraList');
  const folderId = document.getElementById('addFolder').value || null;

  if (!url || !user || !pass) { resetAddSubTab(); showToast('URL, username & password required', 'error'); return; }

  entries.push({
    id:          Date.now().toString(36) + Math.random().toString(36).slice(2),
    label:       label || extractDomain(url),
    url, username: user, password: pass, notes, totp,
    folderId,
    selectors:   { username: selU, password: selP, submit: selS },
    extraFields: extra,
    strength:    getStrengthLevel(pass),
    created:     new Date().toISOString(),
    updated:     new Date().toISOString()
  });
  persist(); renderVault(); renderStats();
  clearAddForm();
  showToast('Credential saved');
  document.querySelector('.tab[data-tab="vault"]').click();
}

function clearAddForm() {
  ['addLabel','addUrl','addUsername','addPassword','addNotes','addTotp','selUsername','selPassword','selSubmit'].forEach(id => {
    document.getElementById(id).value = '';
  });
  document.getElementById('strengthFill').style.width = '0%';
  document.getElementById('strengthText').textContent = '—';
  document.getElementById('helpBox').classList.remove('open');
  document.getElementById('addExtraList').innerHTML = '';
  const af = document.getElementById('addFolder');
  if (af) af.value = '';
  resetAddSubTab();
  prefillUrl();
}

// ── EDIT MODAL ─────────────────────────────────────────────────────
function openEditModal(id) {
  // Reset password field to hidden when modal opens
  const ep = document.getElementById('editPassword');
  if (ep) ep.type = 'password';
  const eye = document.getElementById('editPwEye');
  if (eye) eye.textContent = settings.masterPin ? '🔒' : '👁';
  // Load per-entry PIN protect state (default: true)

  const e = entries.find(x => x.id === id);
  if (!e) return;
  const s = e.selectors || {};
  document.getElementById('editId').value          = e.id;
  document.getElementById('editLabel').value       = e.label || '';
  document.getElementById('editUrl').value         = e.url || '';
  document.getElementById('editUsername').value    = e.username || '';
  document.getElementById('editPassword').value    = e.password || '';
  document.getElementById('editNotes').value       = e.notes || '';
  document.getElementById('editTotp').value        = e.totp || '';
  document.getElementById('editFolder').innerHTML  = folderOptionsHtml(e.folderId || '');
  document.getElementById('editSelUsername').value = s.username || '';
  document.getElementById('editSelPassword').value = s.password || '';
  document.getElementById('editSelSubmit').value   = s.submit || '';
  // Load pinProtect state — default ON, respect saved value
  const pinToggle = document.getElementById('editPinProtect');
  if (pinToggle) {
    pinToggle.checked  = e.pinProtect !== false;
    pinToggle.disabled = !settings.masterPin; // disable if no PIN set
    const pinLabel = document.getElementById('pinProtectLabel');
    if (pinLabel) pinLabel.style.opacity = settings.masterPin ? '1' : '0.4';
    updatePinEyeIcon();
  }
  checkStrength(e.password || '', 'editStrengthFill', 'editStrengthText');
  renderExtraFieldRows('editExtraList', e.extraFields || []);
  // Load per-entry autofill/autosubmit overrides
  loadBehaviourToggles(e);
  document.getElementById('editModal').classList.add('open');
}

function closeEditModal() {
  document.getElementById('editModal').classList.remove('open');
}

function saveEdit() {
  const id  = document.getElementById('editId').value;
  const idx = entries.findIndex(e => e.id === id);
  if (idx < 0) return;
  const pass  = document.getElementById('editPassword').value;
  const extra = collectExtraFields('editExtraList');
  const afIndividual = document.getElementById('editAutofillModeBtn')?.classList.contains('individual');
  const asIndividual = document.getElementById('editAutosubmitModeBtn')?.classList.contains('individual');
  entries[idx] = {
    ...entries[idx],
    label:       document.getElementById('editLabel').value.trim() || entries[idx].label,
    url:         document.getElementById('editUrl').value.trim(),
    username:    document.getElementById('editUsername').value.trim(),
    password:    pass,
    notes:       document.getElementById('editNotes').value.trim(),
    totp:        normalizeTotp(document.getElementById('editTotp').value),
    folderId:    document.getElementById('editFolder').value || null,
    selectors:   {
      username:  document.getElementById('editSelUsername').value.trim(),
      password:  document.getElementById('editSelPassword').value.trim(),
      submit:    document.getElementById('editSelSubmit').value.trim()
    },
    extraFields: extra,
    strength:    getStrengthLevel(pass),
    updated:     new Date().toISOString(),
    // null = use global default, true/false = individual override
    autofill:    afIndividual ? document.getElementById('editAutofillToggle')?.checked : null,
    autosubmit:  asIndividual ? document.getElementById('editAutosubmitToggle')?.checked : null,
  };
  persist(); renderVault(); renderStats();
  closeEditModal();
  showToast('Credential updated');
}

// ── SORT ORDER ─────────────────────────────────────────────────────
function toggleSortDir() {
  settings.sortDir = settings.sortDir === 'desc' ? 'asc' : 'desc';
  chrome.storage.local.set({ settings });
  updateSortBtn();
  renderVault(document.getElementById('searchInput').value.trim().toLowerCase());
}

function updateSortBtn() {
  const btn = document.getElementById('sortDirBtn');
  if (!btn) return;
  const desc = settings.sortDir === 'desc';
  btn.textContent = desc ? 'Z–A' : 'A–Z';
  btn.title = `Sort by name (${desc ? 'descending' : 'ascending'}) — click to toggle`;
}

// ── VAULT RENDER ───────────────────────────────────────────────────
function setupSearch() {
  document.getElementById('searchInput').addEventListener('input', e => renderVault(e.target.value.toLowerCase()));
}

function isExactUrlMatch(stored, current) {
  if (!stored || !current) return false;
  try {
    const s = new URL(stored);
    const c = new URL(current);
    return s.origin === c.origin && s.pathname === c.pathname;
  } catch { return stored === current; }
}

function getMatchPriority(entry, currentUrl, currentUsername) {
  if (!currentUrl) return 3;
  const exactUrl = isExactUrlMatch(entry.url, currentUrl);
  const prefixUrl = urlMatches(entry.url, currentUrl);
  const userMatch = currentUsername && entry.username.toLowerCase() === currentUsername.toLowerCase();

  if (exactUrl && userMatch) return 0; // Exact URL + username match
  if (exactUrl) return 1;              // Exact URL match
  if (prefixUrl && userMatch) return 2; // Prefix URL + username match
  if (prefixUrl) return 3;             // Prefix URL match
  return 4;                            // No match
}

async function detectCurrentUsername() {
  if (!currentTab) return null;
  return new Promise(resolve => {
    chrome.tabs.sendMessage(currentTab.id, { action: 'getCurrentUsername' }, resp => {
      if (chrome.runtime.lastError || !resp?.username) resolve(null);
      else resolve(resp.username);
    });
  });
}

function renderVault(filter = '') {
  const list  = document.getElementById('entryList');
  const badge = document.getElementById('vaultCount');
  const fil   = entries.filter(e =>
    !filter || e.label.toLowerCase().includes(filter) ||
    e.url.toLowerCase().includes(filter) || e.username.toLowerCase().includes(filter)
  );
  badge.textContent = entries.length;
  if (fil.length === 0) {
    const hint = (!filter && window.Cloud && !Cloud.status().signedIn)
      ? '<div class="empty-text" style="margin-top:6px;color:var(--accent2);text-transform:none;letter-spacing:0">Config → Cloud Sync to restore from a backup</div>'
      : '';
    list.innerHTML = `<div class="empty-state"><div class="empty-icon">🗄</div><div class="empty-text">${filter ? 'No matches' : 'Vault is empty'}</div>${hint}</div>`;
    return;
  }

  const dir  = settings.sortDir === 'desc' ? -1 : 1;
  const name = (a, b) => dir * (a.label || '').localeCompare(b.label || '');
  const grouped = !filter; // flat list while searching

  if (currentTab?.url) {
    // Exact/prefix matches for the current tab pinned to the top, rest alphabetical
    detectCurrentUsername().then(currentUsername => {
      const pri = e => getMatchPriority(e, currentTab.url, currentUsername);
      fil.sort((a, b) => (pri(a) - pri(b)) || name(a, b));
      paintVault(list, fil, grouped);
    });
    return;
  }

  fil.sort(name);
  paintVault(list, fil, grouped);
}

// Render entries flat, or bucketed into folder groups (order within each group preserved)
function paintVault(list, sorted, grouped) {
  if (!grouped || !folders.length) {
    list.innerHTML = sorted.map(entryCard).join('');
    restoreCollapsedState(list);
    return;
  }

  const collapsed = settings.collapsedFolders || {};
  const isMatch   = e => !!(currentTab?.url && urlMatches(e.url, currentTab.url));

  const byId = {};
  const groups = folders
    .slice().sort((a, b) => (a.order || 0) - (b.order || 0))
    .map(f => (byId[f.id] = { key: f.id, name: f.name, color: f.color || 'var(--text3)', items: [] }));
  const ungrouped = { key: '__ungrouped__', name: 'Ungrouped', color: 'var(--text3)', items: [] };
  groups.push(ungrouped);

  sorted.forEach(e => {
    const g = (e.folderId && byId[e.folderId]) ? byId[e.folderId] : ungrouped;
    g.items.push(e);
  });

  const filled = groups.filter(g => g.items.length);
  if (filled.length === 1 && filled[0].key === '__ungrouped__') {
    list.innerHTML = sorted.map(entryCard).join('');
    restoreCollapsedState(list);
    return;
  }

  // Folders holding a match for the current tab float to the top and force open
  const hasMatch = g => g.items.some(isMatch);
  filled.sort((a, b) => (hasMatch(b) ? 1 : 0) - (hasMatch(a) ? 1 : 0));

  list.innerHTML = filled.map(g => {
    const forceOpen = hasMatch(g);
    const isC = !forceOpen && !!collapsed[g.key];
    return `
    <div class="folder-group${isC ? ' collapsed' : ''}" data-folder="${escAttr(g.key)}">
      <div class="folder-head" data-action="folder-toggle" data-folder="${escAttr(g.key)}" style="--folder:${escAttr(g.color)}">
        <span class="folder-dot"></span>
        <span class="folder-name">${escHtml(g.name)}</span>
        <span class="folder-count">${g.items.length}</span>
        <span class="folder-chevron">▾</span>
      </div>
      <div class="folder-items">${g.items.map(entryCard).join('')}</div>
    </div>`;
  }).join('');
  restoreCollapsedState(list);
}

function restoreCollapsedState(list) {
  const collapsed = settings.collapsedCards || {};
  list.querySelectorAll('.entry-card').forEach(card => {
    if (collapsed[card.dataset.id]) card.classList.add('collapsed');
  });
}

function entryCard(e) {
  const exactMatch = currentTab && isExactUrlMatch(e.url, currentTab.url);
  const prefixMatch = currentTab && urlMatches(e.url, currentTab.url);
  const isMatch = exactMatch || prefixMatch;
  const folder  = e.folderId ? folders.find(f => f.id === e.folderId) : null;
  const fColor  = folder && folder.color ? folder.color : '';
  const masked  = '•'.repeat(Math.min(e.password.length, 16));
  const encUser = encodeURIComponent(e.username);
  const encPass = encodeURIComponent(e.password);
  const encUrl  = encodeURIComponent(e.url);
  const sid     = escAttr(e.id);
  const sel     = e.selectors || {};
  const extra   = e.extraFields || [];
  const locked  = isLocked(e.url);
  const cnt     = getAttemptCount(e.url);
  const max     = settings.maxAttempts;

  // Selector pills
  const pills = [];
  if (sel.username) pills.push(`<span class="sel-pill user-pill">U: ${escHtml(sel.username)}</span>`);
  if (sel.password) pills.push(`<span class="sel-pill pass-pill">P: ${escHtml(sel.password)}</span>`);
  if (sel.submit)   pills.push(`<span class="sel-pill btn-pill">⏎: ${escHtml(sel.submit)}</span>`);
  if (!pills.length) pills.push(`<span class="sel-pill auto-pill">⚙ auto</span>`);
  extra.forEach(f => pills.push(`<span class="sel-pill extra-pill" title="${escAttr(f.selector)}">+ ${escHtml(f.label)}: ${escHtml(f.value||'manual')}</span>`));

  let lockBadge = '';
  if (locked) lockBadge = `<div class="lockout-badge locked">🔒 LOCKED ${cnt}/${max}</div>`;
  else if (cnt >= Math.ceil(max * 0.6)) lockBadge = `<div class="lockout-badge warning">⚠ ${cnt}/${max} attempts</div>`;

  // Last login
  let lastLoginHtml = '';
  if (e.lastLogin) {
    const dt  = new Date(e.lastLogin);
    const pad = n => String(n).padStart(2,'0');
    const fmt = `${dt.getFullYear()}-${pad(dt.getMonth()+1)}-${pad(dt.getDate())}  ${pad(dt.getHours())}:${pad(dt.getMinutes())}:${pad(dt.getSeconds())}`;
    lastLoginHtml = `<div class="last-login"><div class="last-login-dot"></div>Last login: ${fmt}</div>`;
  } else {
    lastLoginHtml = `<div class="last-login never"><div class="last-login-dot"></div>Never logged in</div>`;
  }

  let matchBadge = '';
  if (exactMatch) matchBadge = '<span class="match-badge exact">● EXACT</span>';
  else if (prefixMatch) matchBadge = '<span class="match-badge prefix">● MATCH</span>';

  return `
  <div class="entry-card${isMatch ? ' match-current' : ''}" data-id="${sid}"${fColor ? ` style="--folder:${escAttr(fColor)}"` : ''}>
    <div class="entry-header" data-action="toggle" data-id="${sid}">
      <div style="flex:1;min-width:0">
        <div class="entry-site">${escHtml(e.label)}</div>
        ${lastLoginHtml}
      </div>
      <div class="entry-badges">
        ${e.captured ? '<span class="captured-badge">⚡ captured</span>' : ''}
        ${extra.length ? `<span class="captured-badge" style="color:var(--warn);border-color:rgba(255,176,32,.25)">+${extra.length} extra</span>` : ''}
        ${matchBadge}
        <span class="collapse-icon">▾</span>
      </div>
    </div>
    <div class="entry-body">
      <div class="entry-url">${escHtml(e.url)}</div>
      ${lockBadge}
      <div class="entry-creds">
        <div class="cred-field"><span class="cred-label">USER</span><span class="cred-val">${escHtml(e.username)}</span></div>
        <div class="cred-field"><span class="cred-label">PASS</span><span class="cred-val">${masked}</span></div>
        ${e.totp ? `<div class="cred-field totp-field"><span class="cred-label">2FA</span><span class="totp-code" data-id="${sid}">······</span><span class="totp-secs"></span><button class="btn btn-sm totp-copy" data-action="copy-totp" data-id="${sid}" title="Copy code">⎘</button></div>` : ''}
      </div>
      <div class="sel-pills">${pills.join('')}</div>
      <div class="entry-actions">
        <div class="entry-actions-left">
          <button class="btn btn-sm" data-action="copy" data-value="${encUser}" data-label="Username" data-highlight="user" data-selector="${escAttr(sel.username||'')}">⎘ User</button>
          <button class="btn btn-sm" data-action="copy" data-value="${encPass}" data-label="Password" data-id="${sid}" data-highlight="pass" data-selector="${escAttr(sel.password||'')}">⎘ Pass</button>
          ${isMatch && !locked ? `<button class="btn btn-sm" data-action="fill" data-id="${sid}">⚡ Fill</button>` : ''}
          ${isMatch && locked  ? `<button class="btn btn-sm btn-unlock-sm" data-action="unlock" data-url="${encUrl}">↺ Unlock</button>` : ''}
        </div>
        <div class="entry-actions-right">
          <button class="btn btn-icon" data-action="history" data-id="${sid}" title="Login History">🕐</button>
          <button class="btn btn-icon" data-action="edit"    data-id="${sid}" title="Edit">✏</button>
          <button class="btn btn-danger btn-icon-danger" data-action="delete" data-id="${sid}" title="Delete">✕</button>
        </div>
      </div>
    </div>
  </div>`;
}

// ── AUTOFILL ───────────────────────────────────────────────────────
function triggerAutofill(id) {
  const e = entries.find(x => x.id === id);
  if (!e || !currentTab) return;
  if (isLocked(e.url)) { showToast('🔒 Locked — reset in Config', 'error'); return; }
  // Per-entry overrides: null = use global, true/false = individual
  const resolvedAutosubmit = e.autosubmit !== null && e.autosubmit !== undefined
    ? e.autosubmit : settings.autosubmit;
  chrome.tabs.sendMessage(currentTab.id, {
    action:      'autofill',
    username:    e.username,
    password:    e.password,
    selectors:   e.selectors || {},
    extraFields: e.extraFields || [],
    autosubmit:  resolvedAutosubmit,
    urlKey:      urlKey(e.url),
    maxAttempts: settings.maxAttempts
  }, () => {
    if (chrome.runtime.lastError) showToast('Could not inject — reload page', 'error');
    else showToast('Credentials injected ⚡');
  });
}

// ── LOCKOUT ────────────────────────────────────────────────────────
function urlKey(url) { try { const u=new URL(url); return u.origin+u.pathname; } catch { return url; } }
function isLocked(url)        { const r=attempts[urlKey(url)]; return r ? r.count >= settings.maxAttempts : false; }
function getAttemptCount(url) { return attempts[urlKey(url)]?.count || 0; }
function unlockEntry(key)     { delete attempts[key]; chrome.storage.local.set({ attempts }); renderLockoutList(); renderVault(); showToast('Lockout cleared'); }

function renderLockoutList() {
  const list   = document.getElementById('lockoutList');
  const max    = settings.maxAttempts;
  const active = Object.entries(attempts).filter(([,r]) => r.count > 0);
  if (!active.length) { list.innerHTML = '<div class="lockout-empty">No lockouts active</div>'; return; }
  list.innerHTML = active.map(([key, rec]) => {
    const locked  = rec.count >= max;
    const warning = !locked && rec.count >= Math.ceil(max * 0.6);
    const lbl     = entries.find(e => urlKey(e.url) === key)?.label || key;
    return `<div class="lockout-row ${locked?'locked':warning?'warning':''}">
      <div class="lockout-dot"></div>
      <div class="lockout-info"><div class="lockout-domain">${escHtml(lbl)}</div><div class="lockout-meta">${locked?'🔒 LOCKED — ':''}${rec.count}/${max} attempts</div></div>
      <button class="btn-unlock" data-unlock="${encodeURIComponent(key)}">Reset</button>
    </div>`;
  }).join('');
}

// ── DELETE ────────────────────────────────────────────────────────
function deleteEntry(id) {
  if (!confirm('Delete this credential?')) return;
  if (window.Cloud) Cloud.tombstone(id);
  entries = entries.filter(e => e.id !== id);
  persist(); renderVault(); renderStats(); showToast('Entry deleted');
}

function copyField(enc, label) {
  navigator.clipboard.writeText(decodeURIComponent(enc)).then(() => showToast(`${label} copied`));
}

function urlMatches(stored, current) {
  if (!stored || !current) return false;
  try { const s=new URL(stored),c=new URL(current); return s.origin===c.origin && c.pathname.startsWith(s.pathname); }
  catch { return stored === current; }
}

// ── PASSWORD STRENGTH ─────────────────────────────────────────────
function checkStrength(pw, fillId, textId) {
  const lvl = getStrengthLevel(pw);
  const cfg = {0:{w:'0%',c:'transparent',t:'—'},1:{w:'25%',c:'#ff4060',t:'WEAK'},2:{w:'50%',c:'#ffb020',t:'FAIR'},3:{w:'75%',c:'#00b4ff',t:'STRONG'},4:{w:'100%',c:'#00cc6a',t:'EXCELLENT'}};
  const c = cfg[lvl];
  const fill = document.getElementById(fillId), text = document.getElementById(textId);
  if (fill) { fill.style.width=c.w; fill.style.background=c.c; }
  if (text) { text.textContent=c.t; text.style.color=c.c; }
}

function getStrengthLevel(pw) {
  if (!pw) return 0; let s=0;
  if (pw.length>=8) s++; if (pw.length>=14) s++;
  if (/[A-Z]/.test(pw)&&/[a-z]/.test(pw)) s++;
  if (/[0-9]/.test(pw)) s++; if (/[^A-Za-z0-9]/.test(pw)) s++;
  return Math.min(4,s);
}

function generatePassword(len = 20) {
  const lower = 'abcdefghijkmnpqrstuvwxyz';
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const digit = '23456789';
  const sym   = '!@#$%^&*-_=+?';
  const all   = lower + upper + digit + sym;
  const pick  = set => set[crypto.getRandomValues(new Uint32Array(1))[0] % set.length];
  const out   = [pick(lower), pick(upper), pick(digit), pick(sym)];
  while (out.length < len) out.push(pick(all));
  for (let i = out.length - 1; i > 0; i--) {                 // Fisher–Yates shuffle
    const j = crypto.getRandomValues(new Uint32Array(1))[0] % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out.join('');
}

function togglePw(inputId, btn) {
  const inp = document.getElementById(inputId);
  if (inp.type==='password') { inp.type='text'; btn.textContent='🙈'; }
  else { inp.type='password'; btn.textContent='👁'; }
}

// ── TOTP (RFC 6238) ──────────────────────────────────────────────
function normalizeTotp(s) {
  return String(s || '').replace(/\s+/g, '').replace(/=+$/, '').toUpperCase();
}
function b32decode(s) {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0, val = 0; const out = [];
  for (const c of normalizeTotp(s)) {
    const i = A.indexOf(c);
    if (i < 0) continue;
    val = (val << 5) | i; bits += 5;
    if (bits >= 8) { out.push((val >>> (bits - 8)) & 0xff); bits -= 8; }
  }
  return new Uint8Array(out);
}
async function totpCode(secret, period = 30, digits = 6) {
  const key = await crypto.subtle.importKey('raw', b32decode(secret), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const counter = Math.floor(Date.now() / 1000 / period);
  const buf = new ArrayBuffer(8);
  new DataView(buf).setUint32(4, counter);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, buf));
  const off = mac[mac.length - 1] & 0xf;
  const bin = ((mac[off] & 0x7f) << 24) | (mac[off + 1] << 16) | (mac[off + 2] << 8) | mac[off + 3];
  return String(bin % 10 ** digits).padStart(digits, '0');
}
function totpRemaining(period = 30) { return period - Math.floor(Date.now() / 1000) % period; }

async function refreshTotps() {
  for (const el of document.querySelectorAll('.totp-code')) {
    const e = entries.find(x => x.id === el.dataset.id);
    if (!e || !e.totp) continue;
    try {
      el.textContent = await totpCode(e.totp);
      const secs = el.parentElement.querySelector('.totp-secs');
      if (secs) secs.textContent = totpRemaining() + 's';
    } catch { el.textContent = 'bad key'; }
  }
}

// ── PBKDF2 helper (recovery code hashing) ────────────────────────
async function pbkdf2B64(text, saltBytes, iter) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(text), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: saltBytes, iterations: iter, hash: 'SHA-256' }, base, 256);
  return btoa(String.fromCharCode(...new Uint8Array(bits)));
}
function b64ToBytes(b) { return Uint8Array.from(atob(b), c => c.charCodeAt(0)); }

async function generateRecoveryCode() {
  if (!settings.masterPin) { showToast('Set a Master PIN first', 'error'); return; }
  const raw = crypto.getRandomValues(new Uint8Array(10));
  const code = [...raw].map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase().replace(/(.{5})/g, '$1-').replace(/-$/, '');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iter = 200000;
  const hash = await pbkdf2B64(code, salt, iter);
  settings.pinRecovery = { salt: btoa(String.fromCharCode(...salt)), hash, iter };
  chrome.storage.local.set({ settings });
  const blob = new Blob(
    [`Password Vault — Master PIN recovery code\n\n${code}\n\nKeep this somewhere safe and offline. Anyone with this code can remove your Master PIN (your saved passwords are NOT revealed by it). It works once, then a new code must be generated.\n`],
    { type: 'text/plain' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = 'pwd-vault-recovery-code.txt'; a.click();
  showToast('✓ Recovery code saved to file');
}

async function resetPinWithRecovery() {
  const rec = settings.pinRecovery;
  if (!rec) { showToast('No recovery code was generated', 'error'); return; }
  const entered = (prompt('Enter your recovery code:') || '').trim().toUpperCase();
  if (!entered) return;
  const hash = await pbkdf2B64(entered, b64ToBytes(rec.salt), rec.iter || 200000);
  if (hash !== rec.hash) { showToast('✕ Incorrect recovery code', 'error'); return; }
  delete settings.masterPin;
  delete settings.pinRecovery;   // one-time use
  chrome.storage.local.set({ settings });
  lockNow({ silent: true });
  applySettings();
  showToast('Master PIN removed — set a new one');
}

// ── LOCAL VAULT ENCRYPTION (opt-in, at rest) ─────────────────────
let _dataKey = null;   // AES-GCM CryptoKey while unlocked; also cached in chrome.storage.session
const _tenc = new TextEncoder();
const _tdec = new TextDecoder();
const _kb64e = b => btoa(String.fromCharCode(...new Uint8Array(b)));
const _kb64d = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));

function encLocalOn() { return !!(settings.encLocal && settings.encLocal.on); }

async function deriveDataKey(pass, saltB64, iter) {
  const base = await crypto.subtle.importKey('raw', _tenc.encode(pass), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: _kb64d(saltB64), iterations: iter, hash: 'SHA-256' },
    base, { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
}
async function aesEncrypt(key, obj) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, _tenc.encode(JSON.stringify(obj)));
  return { iv: _kb64e(iv), blob: _kb64e(ct) };
}
async function aesDecrypt(key, rec) {
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: _kb64d(rec.iv) }, key, _kb64d(rec.blob));
  return JSON.parse(_tdec.decode(pt));
}
async function stashDataKey() {
  try {
    const raw = await crypto.subtle.exportKey('raw', _dataKey);
    await chrome.storage.session.set({ pv_datakey: _kb64e(raw) });
  } catch {}
}
async function loadStashedDataKey() {
  try {
    const s = await chrome.storage.session.get('pv_datakey');
    if (s.pv_datakey) _dataKey = await crypto.subtle.importKey('raw', _kb64d(s.pv_datakey), 'AES-GCM', true, ['encrypt', 'decrypt']);
  } catch {}
}

function updateLocalLockUI() {
  const ov = document.getElementById('localLockScreen');
  if (ov) ov.style.display = (encLocalOn() && !_dataKey) ? 'flex' : 'none';
}

async function unlockLocal() {
  const inp   = document.getElementById('localLockInput');
  const errEl = document.getElementById('localLockError');
  errEl.textContent = '';
  try {
    const cfg = settings.encLocal;
    const key = await deriveDataKey(inp.value, cfg.salt, cfg.iter);
    await aesDecrypt(key, cfg.check);                 // verify passphrase
    _dataKey = key;
    await stashDataKey();
    const r = await chromeGet(['vault_enc']);
    entries = r.vault_enc ? await aesDecrypt(_dataKey, r.vault_enc) : [];
    inp.value = '';
    markUnlocked();
    updateLocalLockUI();
    renderVault(); renderStats(); renderFolderManager(); refreshFolderSelects(); renderLockoutList();
    showToast('Vault unlocked');
  } catch { errEl.textContent = '✕ Incorrect passphrase'; }
}

async function enableLocalEnc() {
  if (encLocalOn()) return;
  if (!confirm('Encrypt the local vault?\n\nA vault.json backup will download first. If you forget the passphrase, the local data cannot be recovered without that backup.')) return;
  doExport();
  const p1 = prompt('Set a vault passphrase (min 8 characters). This is separate from your 6-digit PIN.');
  if (p1 == null) return;
  if (p1.length < 8) { showToast('Passphrase must be at least 8 characters', 'error'); return; }
  if (prompt('Re-enter the passphrase:') !== p1) { showToast('Passphrases did not match', 'error'); return; }
  const salt = _kb64e(crypto.getRandomValues(new Uint8Array(16)));
  const iter = 600000;
  _dataKey = await deriveDataKey(p1, salt, iter);
  const check = await aesEncrypt(_dataKey, { ok: 1 });
  settings.encLocal = { on: true, salt, iter, check };
  await stashDataKey();
  await chromeSet({ vault_enc: await aesEncrypt(_dataKey, entries), settings });
  await chromeRemove('vault');
  markUnlocked();
  applySettings();
  updateLocalLockUI();
  showToast('✓ Local vault encrypted');
}

async function disableLocalEnc() {
  if (!encLocalOn()) return;
  if (!_dataKey) { showToast('Unlock the vault first', 'error'); return; }
  if (!confirm('Turn off local encryption? Passwords will be stored in plain text on this device again.')) return;
  delete settings.encLocal;
  await chromeSet({ vault: entries, settings });
  await chromeRemove('vault_enc');
  _dataKey = null;
  try { await chrome.storage.session.remove('pv_datakey'); } catch {}
  applySettings();
  updateLocalLockUI();
  showToast('Local encryption turned off');
}

// ── SETTINGS ─────────────────────────────────────────────────────
function applySettings() {
  document.getElementById('toggleAutofill').checked   = settings.autofill;
  document.getElementById('toggleCapture').checked    = settings.capture !== false;
  document.getElementById('toggleAutosubmit').checked = settings.autosubmit;
  document.getElementById('toggleNotify').checked     = settings.notify;
  document.getElementById('maxAttemptsInput').value   = settings.maxAttempts || 5;
  const ali = document.getElementById('autoLockInput');
  if (ali) ali.value = settings.autoLockMin ?? 5;
  // Master PIN — switch UI state
  const hasPIN = !!settings.masterPin;
  const setupArea  = document.getElementById('pinSetupArea');
  const activeArea = document.getElementById('pinActiveArea');
  if (setupArea)  setupArea.style.display  = hasPIN ? 'none' : 'flex';
  if (activeArea) activeArea.style.display = hasPIN ? 'flex' : 'none';
  const recRow = document.getElementById('pinRecoveryRow');
  if (recRow) recRow.style.display = hasPIN ? 'flex' : 'none';
  const encToggle = document.getElementById('toggleEncLocal');
  if (encToggle) encToggle.checked = encLocalOn();
  if (!hasPIN) {
    const inp = document.getElementById('masterPinInput');
    if (inp) { inp.value = ''; inp.type = 'password'; }
  }
}
function saveSetting(key, value) { settings[key]=value; chrome.storage.local.set({ settings }); }

// ── STATS ─────────────────────────────────────────────────────────
function renderStats() {
  document.getElementById('statTotal').textContent  = entries.length;
  document.getElementById('statSites').textContent  = new Set(entries.map(e => extractDomain(e.url))).size;
  document.getElementById('statStrong').textContent = entries.filter(e => e.strength >= 3).length;
}

// ── EXPORT / IMPORT ───────────────────────────────────────────────
function downloadDocs() {
  const url = chrome.runtime.getURL('Password-Vault-User-Guide.docx');
  const a   = document.createElement('a');
  a.href     = url;
  a.download = 'Password-Vault-User-Guide.docx';
  a.click();
}

function exportJSON() {
  // Always require PIN on export if master PIN is configured
  if (settings.masterPin) {
    gatePin(doExport);
  } else {
    doExport();
  }
}
function doExport() {
  const blob = new Blob([JSON.stringify({vault:entries,folders,exported:new Date().toISOString()},null,2)],{type:'application/json'});
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='pwd-vault-vault.json'; a.click();
  showToast('Vault exported');
}
function importJSON(event) {
  const file=event.target.files[0]; if(!file) return;
  const reader=new FileReader();
  reader.onload=e=>{
    try {
      const parsed = JSON.parse(e.target.result);
      const imp = Array.isArray(parsed) ? parsed : parsed.vault;
      if(!Array.isArray(imp)) throw new Error();
      // Merge folders first so imported entries can keep their folderId
      if (Array.isArray(parsed.folders)) {
        const fids = new Set(folders.map(f=>f.id));
        parsed.folders.forEach(f=>{
          if (f && f.id && typeof f.name === 'string' && !fids.has(f.id)) {
            folders.push({ id:f.id, name:f.name.slice(0,24), color:f.color||'#00b4ff', order:folders.length });
            fids.add(f.id);
          }
        });
        persistFolders();
      }
      const validFolder = id => folders.some(f=>f.id===id);
      const ids=new Set(entries.map(x=>x.id)); let added=0;
      imp.forEach(x=>{
        if(!ids.has(x.id)){
          if (x.folderId && !validFolder(x.folderId)) x.folderId = null;
          entries.push(x); added++;
        }
      });
      persist(); renderVault(); renderStats(); renderFolderManager(); refreshFolderSelects();
      showToast(`Imported ${added} entries`);
    } catch { showToast('Invalid JSON','error'); }
  };
  reader.readAsText(file); event.target.value='';
}
// ── PASSWORD HEALTH ──────────────────────────────────────────────
function renderHealthReport() {
  const box = document.getElementById('healthReport');
  if (!entries.length) { box.innerHTML = '<div class="lockout-empty">Vault is empty</div>'; return; }
  const now = Date.now();
  const counts = new Map();
  entries.forEach(e => counts.set(e.password, (counts.get(e.password) || 0) + 1));
  const rows = [];
  entries.forEach(e => {
    const issues = [];
    const pw = e.password || '';
    if (pw.length < 8 || getStrengthLevel(pw) < 2) issues.push('weak');
    if (pw && counts.get(pw) > 1) issues.push('reused');
    const ref = e.updated || e.created;
    if (ref && (now - new Date(ref).getTime()) > 365 * 864e5) issues.push('old');
    if (issues.length) rows.push({ e, issues });
  });
  if (!rows.length) {
    box.innerHTML = '<div class="lockout-empty" style="color:var(--success)">✓ All passwords look healthy</div>';
    return;
  }
  box.innerHTML = rows.map(({ e, issues }) => `
    <div class="health-row" data-id="${escAttr(e.id)}">
      <div class="health-label">${escHtml(e.label || e.url || e.username)}</div>
      <div class="health-tags">${issues.map(i => `<span class="health-tag ${i}">${i}</span>`).join('')}</div>
    </div>`).join('');
}

// ── CSV IMPORT ───────────────────────────────────────────────────
function parseCSV(text) {
  const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; }
      else cur += c;
    } else if (c === '"') { q = true; }
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
    else if (c !== '\r') cur += c;
  }
  if (cur.length || row.length) { row.push(cur); rows.push(row); }
  return rows.filter(r => r.some(x => x !== ''));
}

function importCSV(event) {
  const file = event.target.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const rows = parseCSV(e.target.result);
      if (rows.length < 2) throw new Error('empty');
      const header = rows[0].map(h => h.trim().toLowerCase());
      const find = (...names) => header.findIndex(h => names.some(n => h === n || h.includes(n)));
      const iUrl  = find('url', 'uri', 'website', 'login_uri', 'address');
      const iUser = find('username', 'user', 'login_username', 'login', 'email', 'account');
      const iPass = find('password', 'login_password', 'pwd', 'pass');
      const iName = find('name', 'title', 'label', 'item');
      const iNote = find('note', 'notes', 'comment');
      if (iUser < 0 || iPass < 0) throw new Error('columns');
      const dup = new Set(entries.map(x => `${x.url} :: ${x.username} :: ${x.password}`));
      let added = 0;
      rows.slice(1).forEach(r => {
        const url  = (iUrl  >= 0 ? r[iUrl]  : '') || '';
        const user = (iUser >= 0 ? r[iUser] : '') || '';
        const pass = (iPass >= 0 ? r[iPass] : '') || '';
        if (!user || !pass) return;
        const key = `${url} :: ${user} :: ${pass}`;
        if (dup.has(key)) return;
        dup.add(key);
        entries.push({
          id: Date.now().toString(36) + Math.random().toString(36).slice(2),
          label: (iName >= 0 && r[iName]) ? r[iName] : (url ? extractDomain(url) : user),
          url, username: user, password: pass,
          notes: (iNote >= 0 ? r[iNote] : '') || '',
          folderId: null,
          selectors: { username: '', password: '', submit: '' },
          extraFields: [],
          strength: getStrengthLevel(pass),
          created: new Date().toISOString(),
          updated: new Date().toISOString()
        });
        added++;
      });
      persist(); renderVault(); renderStats(); renderFolderManager(); refreshFolderSelects();
      showToast(`Imported ${added} from CSV`);
    } catch { showToast('Could not read CSV', 'error'); }
  };
  reader.readAsText(file);
  event.target.value = '';
}

function clearVault() {
  if(!confirm('⚠ Wipe entire vault?')) return;
  if (window.Cloud) Cloud.tombstoneAll(entries.map(e => e.id));
  entries=[]; persist(); renderVault(); renderStats(); showToast('Vault wiped');
}

// ── TOAST ─────────────────────────────────────────────────────────
let _toastTimer=null;
function showToast(msg,type='') {
  const t=document.getElementById('toast');
  t.textContent=msg; t.className='toast'+(type?' '+type:'');
  setTimeout(()=>t.classList.add('show'),10);
  if(_toastTimer) clearTimeout(_toastTimer);
  _toastTimer=setTimeout(()=>t.classList.remove('show'),2200);
}


// ── HISTORY MODAL ─────────────────────────────────────────────────
function openHistoryModal(id) {
  const e = entries.find(x => x.id === id);
  if (!e) return;

  document.getElementById('historyModalLabel').textContent = `${e.label}  ·  ${e.username}`;

  const list = document.getElementById('historyList');
  // Normalise — old entries may be plain ISO strings, new are {ts, status}
  const history = (e.loginHistory || [])
    .map(h => typeof h === 'string' ? { ts: h, status: 'success' } : h)
    .slice().reverse(); // newest first

  if (!history.length) {
    list.innerHTML = '<div class="history-empty">NO LOGIN HISTORY YET</div>';
  } else {
    list.innerHTML = history.map((h, i) => {
      const dt      = new Date(h.ts);
      const pad     = n => String(n).padStart(2,'0');
      const fmt     = `${dt.getFullYear()}-${pad(dt.getMonth()+1)}-${pad(dt.getDate())}  ${pad(dt.getHours())}:${pad(dt.getMinutes())}:${pad(dt.getSeconds())}`;
      const ago     = timeAgo(dt);
      const ok      = h.status === 'success';
      const badge   = ok
        ? `<div class="history-badge success">✓ OK</div>`
        : `<div class="history-badge fail">✕ FAIL</div>`;
      return `
        <div class="history-row ${ok ? '' : 'history-fail'}">
          <div class="history-num">${history.length - i}</div>
          <div>
            <div class="history-dt">${fmt}</div>
            <div class="history-ago">${ago}</div>
          </div>
          ${badge}
        </div>`;
    }).join('');
  }

  document.getElementById('historyModal').classList.add('open');
}

function closeHistoryModal() {
  document.getElementById('historyModal').classList.remove('open');
}

function timeAgo(date) {
  const sec  = Math.floor((Date.now() - date) / 1000);
  if (sec < 60)   return `${sec}s ago`;
  const min  = Math.floor(sec / 60);
  if (min < 60)   return `${min}m ago`;
  const hr   = Math.floor(min / 60);
  if (hr < 24)    return `${hr}h ago`;
  const days = Math.floor(hr / 24);
  if (days < 30)  return `${days}d ago`;
  const mo   = Math.floor(days / 30);
  if (mo < 12)    return `${mo}mo ago`;
  return `${Math.floor(mo/12)}y ago`;
}




// ── MASTER PIN ────────────────────────────────────────────────────
let _pinCallback = null;

function savePinProtectState(value) {
  // Save pinProtect to the currently open entry immediately
  const editId = document.getElementById('editId')?.value;
  if (!editId) return;
  const idx = entries.findIndex(x => x.id === editId);
  if (idx < 0) return;
  entries[idx].pinProtect = value;
  persist();
}

function updatePinEyeIcon() {
  const eye       = document.getElementById('editPwEye');
  const pinToggle = document.getElementById('editPinProtect');
  if (!eye) return;
  const isProtected = settings.masterPin && (pinToggle ? pinToggle.checked : true);
  const isVisible   = document.getElementById('editPassword')?.type === 'text';
  // Sync toggle disabled state
  if (pinToggle) {
    pinToggle.disabled = !settings.masterPin;
    const pinLabel = document.getElementById('pinProtectLabel');
    if (pinLabel) pinLabel.style.opacity = settings.masterPin ? '1' : '0.4';
  }
  if (isVisible) {
    eye.textContent = '👁';
    eye.title = 'Hide password';
    return;
  }
  eye.textContent = isProtected ? '🔒' : '👁';
  eye.title = isProtected ? 'Reveal password (PIN required)' : 'Reveal password';
}

function saveMasterPin() {
  const inp = document.getElementById('masterPinInput');
  const val = inp.value.trim();
  if (!val) { showToast('Enter a PIN first', 'error'); return; }
  if (!/^\d{6}$/.test(val)) { showToast('PIN must be exactly 6 digits', 'error'); return; }
  settings.masterPin = val;
  chrome.storage.local.set({ settings });
  applySettings();
  showToast('✓ Master PIN saved');
  updatePinEyeIcon();
}

function resetMasterPin() {
  if (!confirm('⚠ Reset PIN and wipe all credentials?\n\nThis will delete your Master PIN and ALL saved passwords. This cannot be undone.')) return;
  // Wipe PIN
  delete settings.masterPin;
  chrome.storage.local.set({ settings });
  // Wipe entire vault
  if (window.Cloud) Cloud.tombstoneAll(entries.map(e => e.id));
  entries = [];
  persist();
  applySettings();
  renderVault();
  renderStats();
  showToast('PIN and vault wiped — fresh start');
  updatePinEyeIcon();
}

function openPinModal(callback) {
  _pinCallback = callback;
  document.getElementById('pinInput').value = '';
  document.getElementById('pinInput').type  = 'password';
  document.getElementById('pinError').textContent = '';
  document.getElementById('pinInput').classList.remove('pin-error');
  document.getElementById('pinModal').style.display = 'flex';
  setTimeout(() => document.getElementById('pinInput').focus(), 50);
}

function closePinModal() {
  document.getElementById('pinModal').style.display = 'none';
  _pinCallback = null;
}

function confirmPin() {
  const entered = document.getElementById('pinInput').value;
  const errEl   = document.getElementById('pinError');
  if (entered === settings.masterPin) {
    markUnlocked();
    const cb = _pinCallback;   // save BEFORE closing (closePinModal nulls it)
    closePinModal();
    if (cb) cb();              // now call it safely
  } else {
    errEl.textContent = '✕ INCORRECT PIN';
    const inp = document.getElementById('pinInput');
    inp.classList.add('pin-error');
    inp.value = '';
    setTimeout(() => {
      inp.classList.remove('pin-error');
      errEl.textContent = '';
    }, 1000);
  }
}


// ── PER-ENTRY BEHAVIOUR TOGGLES ──────────────────────────────────
// mode: null = GLOBAL (follow Config), true/false = INDIVIDUAL override
function loadBehaviourToggles(e) {
  setBehaviourRow('Autofill',   e.autofill,   settings.autofill);
  setBehaviourRow('Autosubmit', e.autosubmit, settings.autosubmit);
}

function setBehaviourRow(name, entryVal, globalVal) {
  const toggle  = document.getElementById(`edit${name}Toggle`);
  const modeBtn = document.getElementById(`edit${name}ModeBtn`);
  const desc    = document.getElementById(`edit${name}Desc`);
  if (!toggle || !modeBtn) return;

  const isIndividual = entryVal !== null && entryVal !== undefined;

  if (isIndividual) {
    // Individual mode — toggle is active, shows entry's own value
    toggle.checked = !!entryVal;
    toggle.parentElement.classList.remove('entry-toggle-disabled');
    modeBtn.textContent = 'INDIVIDUAL';
    modeBtn.classList.add('individual');
    if (desc) desc.textContent = 'Using individual setting';
  } else {
    // Global mode — toggle mirrors global setting but is inactive
    toggle.checked = !!globalVal;
    toggle.parentElement.classList.add('entry-toggle-disabled');
    modeBtn.textContent = 'GLOBAL';
    modeBtn.classList.remove('individual');
    if (desc) desc.textContent = 'Following global setting';
  }
}

// ── FIELD HIGHLIGHT ───────────────────────────────────────────────
let _hlTab = null;
function handleHighlightOver(e) {
  const btn = e.target.closest('button[data-highlight]');
  if (!btn || !currentTab) return;
  const type = btn.dataset.highlight; // 'user' or 'pass'
  const selector = btn.dataset.selector || '';
  chrome.tabs.sendMessage(currentTab.id, {
    action: 'highlightField', fieldType: type, selector
  }).catch(() => {});
}
function handleHighlightOut(e) {
  const btn = e.target.closest('button[data-highlight]');
  if (!btn || !currentTab) return;
  chrome.tabs.sendMessage(currentTab.id, {
    action: 'clearHighlight'
  }).catch(() => {});
}

// ── UTILS ─────────────────────────────────────────────────────────
function extractDomain(url) { try { return new URL(url).hostname; } catch { return url; } }
function escHtml(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function escAttr(s) { return String(s).replace(/"/g,'&quot;'); }