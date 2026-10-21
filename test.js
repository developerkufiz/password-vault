// Crypto / escaping self-check. Run: node test.js
const assert = require('assert');
const src = require('fs').readFileSync(__dirname + '/popup.js', 'utf8').replace(/\r\n/g, '\n');
// one-line function, else multi-line up to the first closing brace at column 0
const grab = n => (src.match(new RegExp('^(async )?function ' + n + '\\(.*}$', 'm')) ||
                   src.match(new RegExp('^(async )?function ' + n + '\\([\\s\\S]*?\\n}', 'm')))[0];
const line = n => src.match(new RegExp('^const ' + n + ' .*$', 'm'))[0].replace('const', 'var');  // var: visible outside eval

let settings = {};
eval(['_tenc', '_tdec', '_kb64e', '_kb64d'].map(line).concat(
  ['pbkdf2B64', 'b64ToBytes', 'hashPin', 'checkPin', 'deriveDataKey', 'aesEncrypt', 'aesDecrypt', 'escHtml', 'pwnedCount', 'versionGt'].map(grab)
).join('\n'));

(async () => {
  // Master PIN: hashed, verifiable, never stored raw
  settings.masterPin = await hashPin('12345678');
  assert(!JSON.stringify(settings).includes('12345678'));
  assert.strictEqual(settings.masterPin.len, 8);
  assert.strictEqual(await checkPin('12345678'), true);
  assert.strictEqual(await checkPin('87654321'), false);
  settings = {};
  assert.strictEqual(await checkPin('12345678'), false);

  // Local vault encryption round-trip; wrong passphrase fails
  const salt = _kb64e(crypto.getRandomValues(new Uint8Array(16)));
  const key = await deriveDataKey('correct horse', salt, 1000);
  const rec = await aesEncrypt(key, [{ password: 'p@ss' }]);
  assert(!rec.blob.includes('p@ss'));
  assert.deepStrictEqual(await aesDecrypt(key, rec), [{ password: 'p@ss' }]);
  await assert.rejects(aesDecrypt(await deriveDataKey('wrong', salt, 1000), rec));

  assert.strictEqual(escHtml(`<a href="x" onclick='y'>&`), '&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;&amp;');
  // HIBP: only a 5-char prefix is sent; suffix match gives the count, padding (count 0) doesn't
  let sentUrl = '';
  global.fetch = async url => { sentUrl = url; return { ok: true, text: async () =>
    '0018A45C4D1DEF81644B54AB7F969B88D65:0\r\n1E4C9B93F3F0682250B6CF8331B7EE68FD8:9545824\r\n' }; };
  assert.strictEqual(await pwnedCount('password'), 9545824);   // SHA-1 = 5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8
  assert.strictEqual(sentUrl, 'https://api.pwnedpasswords.com/range/5BAA6');
  assert.strictEqual(await pwnedCount('not-in-list-xyz'), 0);

  // ── background.js in a sandbox; chrome.* APIs not given become no-ops ──
  const vm = require('vm'), fs = require('fs');
  const noop = new Proxy(function () {}, { get: () => noop, apply: () => {} });
  const orNoop = o => new Proxy(o, { get: (t, k) => (k in t ? t[k] : noop) });
  const loadBackground = chrome => {
    const box = { chrome: orNoop({ ...chrome, storage: orNoop(chrome.storage || {}) }), console, URL, atob, btoa, crypto, TextEncoder, TextDecoder, setTimeout, clearTimeout };
    box.importScripts = (...files) => files.forEach(f => vm.runInContext(fs.readFileSync(__dirname + '/' + f, 'utf8'), box));
    vm.createContext(box);
    vm.runInContext(fs.readFileSync(__dirname + '/background.js', 'utf8'), box);
    return box;
  };
  const tick = () => new Promise(r => setImmediate(r));

  // Auto-lock: PIN idle must NOT drop the vault key (auto-fill needs it); vault timer does
  const runAlarm = async (session, settings) => {
    let onAlarm; const removed = [];
    loadBackground({
      alarms: { create() {}, onAlarm: { addListener: f => { onAlarm = f; } } },
      storage: { session: { get: (k, cb) => cb(session), remove: k => removed.push(...k) }, local: { get: (k, cb) => cb({ settings }) } },
    });
    onAlarm({ name: 'pv-autolock' }); await tick();
    return removed;
  };
  const old = Date.now() - 10 * 60000;
  let r = await runAlarm({ pv_unlock: { at: old }, pv_vault_at: old }, { autoLockMin: 5, vaultLockMin: 0 });
  assert(r.includes('pv_unlock') && !r.includes('pv_datakey'), 'PIN idle dropped vault key: ' + r);
  r = await runAlarm({ pv_unlock: { at: old }, pv_vault_at: old }, { autoLockMin: 5, vaultLockMin: 5 });
  assert(r.includes('pv_datakey'), 'vault timer did not lock');
  r = await runAlarm({ pv_vault_at: Date.now() }, { autoLockMin: 5, vaultLockMin: 5 });
  assert(!r.includes('pv_datakey'), 'vault locked too early');

  // What's new: an update flags the old version + badges; reloading the same version doesn't
  const runInstalled = details => {
    const listeners = [], set = []; let badge = '';
    loadBackground({
      storage: { local: { set: o => set.push(o) } },
      action: { setBadgeText: o => { badge = o.text; }, setBadgeBackgroundColor() {} },
      runtime: orNoop({ onInstalled: { addListener: f => listeners.push(f) }, getManifest: () => ({ version: '3.20.0' }) }),
    });
    listeners.forEach(f => f(details));
    return { set: JSON.stringify(set), badge };  // JSON: objects come from the vm realm
  };
  let ins = runInstalled({ reason: 'update', previousVersion: '3.19.1' });
  assert.strictEqual(ins.set, '[{"whats_new_from":"3.19.1"}]'); assert.strictEqual(ins.badge, 'NEW');
  ins = runInstalled({ reason: 'update', previousVersion: '3.20.0' });
  assert.strictEqual(ins.set, '[]'); assert.strictEqual(ins.badge, '');
  ins = runInstalled({ reason: 'install' });
  assert.strictEqual(ins.set, '[]');

  // Toolbar badge: count of saved logins for the page, else NEW while unseen, else blank
  const badges = [];
  const runBadge = async (store, url) => {
    loadBackground({
      action: { setBadgeText: o => badges.push(o.text), setBadgeBackgroundColor() {} },
      storage: { local: { get: (k, cb) => cb(store) } },
    }).updateBadge(1, url);
    await tick();
  };
  const vault = [{ url: 'https://a.test/login' }, { url: 'https://a.test/' }, { url: 'https://b.test/' }];
  await runBadge({ vault, whats_new_from: '3.20.1' }, 'https://a.test/login');
  await runBadge({ vault, whats_new_from: '3.20.1' }, 'https://c.test/');
  await runBadge({ vault }, 'https://c.test/');
  assert.deepStrictEqual(badges, ['2', 'NEW', '']);

  // Generator (shared pwgen.js): length + every character class
  const { generatePassword } = loadBackground({});
  const pw = generatePassword(20);
  assert(pw.length === 20 && /[a-z]/.test(pw) && /[A-Z]/.test(pw) && /[0-9]/.test(pw) && /[^A-Za-z0-9]/.test(pw), pw);

  // What's new: numeric (not string) version compare
  assert(versionGt('3.19.1', '3.19.0') && versionGt('3.20.0', '3.9.9') && versionGt('3.16.0', '3.15'));
  assert(!versionGt('3.19.0', '3.19.0') && !versionGt('3.9.0', '3.10.0'));

  console.log('ok');
})().catch(e => { console.error(e); process.exit(1); });
