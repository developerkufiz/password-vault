import crypto from 'node:crypto';
import express from 'express';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { OAuth2Client } from 'google-auth-library';
import { pool, initSchema } from './db.js';

const app = express();
app.use(express.json({ limit: '8mb' }));
app.use(cors({ origin: true })); // reflects caller origin; fine for a personal single-user setup

const JWT_SECRET       = process.env.JWT_SECRET || 'dev-only-insecure-secret';
const DEFAULT_ITER     = 600000;
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const googleClient     = new OAuth2Client(GOOGLE_CLIENT_ID);
const norm = e => String(e || '').trim().toLowerCase();
const h = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function signToken(u) {
  return jwt.sign({ uid: String(u.id), email: u.email }, JWT_SECRET, { expiresIn: '30d' });
}

function auth(req, res, next) {
  const hdr = req.headers.authorization || '';
  const tok = hdr.startsWith('Bearer ') ? hdr.slice(7) : null;
  if (!tok) return res.status(401).json({ error: 'Not signed in' });
  try { req.user = jwt.verify(tok, JWT_SECRET); next(); }
  catch { res.status(401).json({ error: 'Session expired' }); }
}

app.get('/', (_req, res) => res.json({ ok: true, service: 'password-vault-sync' }));

// ── REGISTER ──────────────────────────────────────────────────────
app.post('/auth/register', h(async (req, res) => {
  const email      = norm(req.body.email);
  const kdfSalt    = req.body.kdfSalt;
  const authHash   = req.body.authHash;
  const iterations = Number(req.body.iterations) || DEFAULT_ITER;

  if (!email || !email.includes('@')) return res.status(400).json({ error: 'Valid email required' });
  if (!kdfSalt || !authHash)          return res.status(400).json({ error: 'Missing crypto fields' });

  const [existing] = await pool.query('SELECT id FROM users WHERE email = ?', [email]);
  if (existing.length) return res.status(409).json({ error: 'An account with this email already exists' });

  const stored = await bcrypt.hash(authHash, 12);
  const [r] = await pool.query(
    'INSERT INTO users (email, kdf_salt, kdf_iterations, auth_hash) VALUES (?,?,?,?)',
    [email, kdfSalt, iterations, stored]
  );
  res.json({ token: signToken({ id: r.insertId, email }) });
}));

// ── PRELOGIN (client needs the salt + iteration count to derive keys) ──
app.post('/auth/prelogin', h(async (req, res) => {
  const email = norm(req.body.email);
  const [rows] = await pool.query(
    "SELECT kdf_salt, kdf_iterations FROM users WHERE email = ? AND auth_method = 'password'", [email]
  );
  if (!rows.length) {
    // Do not reveal whether the account exists: hand back a stable dummy salt.
    const dummy = Buffer.from('dummy:' + email).toString('base64').slice(0, 24);
    return res.json({ kdfSalt: dummy, iterations: DEFAULT_ITER });
  }
  res.json({ kdfSalt: rows[0].kdf_salt, iterations: rows[0].kdf_iterations });
}));

// ── LOGIN ─────────────────────────────────────────────────────────
app.post('/auth/login', h(async (req, res) => {
  const email    = norm(req.body.email);
  const authHash = req.body.authHash || '';
  const [rows] = await pool.query('SELECT * FROM users WHERE email = ?', [email]);
  const fail = () => res.status(401).json({ error: 'Wrong email or master password' });
  const u = rows[0];
  if (!u || u.auth_method !== 'password' || !u.auth_hash) {
    await bcrypt.compare(authHash, '$2a$12$0000000000000000000000000000000000000000000000000000');
    return fail();
  }
  const ok = await bcrypt.compare(authHash, u.auth_hash);
  if (!ok) return fail();
  res.json({ token: signToken(u) });
}));

// ── SIGN IN WITH GOOGLE (server holds the vault key for these accounts) ──
app.post('/auth/google', h(async (req, res) => {
  if (!GOOGLE_CLIENT_ID) return res.status(500).json({ error: 'Google login is not configured on the server' });
  const { idToken } = req.body;
  if (!idToken) return res.status(400).json({ error: 'Missing idToken' });

  let payload;
  try {
    const ticket = await googleClient.verifyIdToken({ idToken, audience: GOOGLE_CLIENT_ID });
    payload = ticket.getPayload();
  } catch {
    return res.status(401).json({ error: 'Invalid Google token' });
  }
  const sub   = payload.sub;
  const email = norm(payload.email);
  if (!email || payload.email_verified === false) {
    return res.status(400).json({ error: 'Google account email not usable' });
  }

  const [rows] = await pool.query(
    'SELECT * FROM users WHERE google_sub = ? OR email = ?', [sub, email]
  );
  let user = rows[0];

  if (user && user.auth_method !== 'google') {
    return res.status(409).json({
      error: 'This email already has a master-password account. Sign in with your master password instead.',
    });
  }

  if (!user) {
    const vaultKey = crypto.randomBytes(32).toString('base64');
    const [r] = await pool.query(
      "INSERT INTO users (email, auth_method, google_sub, vault_key) VALUES (?, 'google', ?, ?)",
      [email, sub, vaultKey]
    );
    user = { id: r.insertId, email, vault_key: vaultKey };
  } else if (!user.google_sub) {
    await pool.query('UPDATE users SET google_sub = ? WHERE id = ?', [sub, user.id]);
  }

  res.json({ token: signToken(user), vaultKey: user.vault_key });
}));

// ── GET VAULT ─────────────────────────────────────────────────────
app.get('/vault', auth, h(async (req, res) => {
  const [rows] = await pool.query(
    'SELECT `blob`, iv, version FROM vaults WHERE user_id = ?', [req.user.uid]
  );
  if (!rows.length) return res.json({ version: 0, blob: null, iv: null });
  res.json(rows[0]);
}));

// ── PUT VAULT (optimistic concurrency on version) ─────────────────
app.put('/vault', auth, h(async (req, res) => {
  const { blob, iv } = req.body;
  const baseVersion = Number(req.body.baseVersion) || 0;
  if (!blob || !iv) return res.status(400).json({ error: 'Missing blob/iv' });

  const [rows] = await pool.query(
    'SELECT `blob`, iv, version FROM vaults WHERE user_id = ?', [req.user.uid]
  );
  const cur = rows[0];

  if (cur && cur.version !== baseVersion) {
    return res.status(409).json({
      error: 'Version conflict', version: cur.version, blob: cur.blob, iv: cur.iv,
    });
  }

  const nextVersion = (cur ? cur.version : 0) + 1;
  if (cur) {
    await pool.query(
      'UPDATE vaults SET `blob` = ?, iv = ?, version = ? WHERE user_id = ? AND version = ?',
      [blob, iv, nextVersion, req.user.uid, baseVersion]
    );
  } else {
    await pool.query(
      'INSERT INTO vaults (user_id, `blob`, iv, version) VALUES (?,?,?,?)',
      [req.user.uid, blob, iv, nextVersion]
    );
  }
  res.json({ version: nextVersion });
}));

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Server error' });
});

const port = process.env.PORT || 3000;
initSchema()
  .then(() => app.listen(port, () => console.log('password-vault-sync listening on ' + port)))
  .catch(err => { console.error('Startup failed (DB unreachable?)', err); process.exit(1); });
