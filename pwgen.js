// ── pwgen.js — shared by popup.html and background.js (importScripts) ──
// Strong random password: at least one of each class, no look-alike chars.
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
