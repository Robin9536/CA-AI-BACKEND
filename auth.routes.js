const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { query, pool } = require('./pool');
const { asyncRoute, HttpError } = require('./errorHandler');
const { requireAuth } = require('./auth');
const { grantCredits } = require('./credits');

const router = express.Router();

function signToken(user) {
  return jwt.sign({ sub: user.id, role: user.role }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  });
}

function isValidEmail(email) {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// POST /api/auth/signup
router.post('/signup', asyncRoute(async (req, res) => {
  const { email, password, fullName, role } = req.body;

  if (!isValidEmail(email)) throw new HttpError(400, 'Enter a valid email address');
  if (!password || password.length < 8) throw new HttpError(400, 'Password must be at least 8 characters');
  if (!fullName || !fullName.trim()) throw new HttpError(400, 'Full name is required');
  if (!['business_owner', 'ca'].includes(role)) throw new HttpError(400, 'Role must be business_owner or ca');
  // Note: admin accounts are provisioned directly in the database, never via public signup.

  const existing = await query('SELECT id FROM users WHERE email = $1', [email]);
  if (existing.rows.length) throw new HttpError(409, 'An account with that email already exists');

  const passwordHash = await bcrypt.hash(password, Number(process.env.BCRYPT_SALT_ROUNDS || 12));

  const client = await pool.connect();
  let user;
  try {
    await client.query('BEGIN');

    const inserted = await client.query(
      `INSERT INTO users (email, password_hash, role, full_name)
       VALUES ($1, $2, $3, $4)
       RETURNING id, email, role, full_name, created_at`,
      [email, passwordHash, role, fullName.trim()]
    );
    user = inserted.rows[0];

    // Every user needs a matching profile row to actually use the product.
    if (role === 'business_owner') {
      await client.query(`INSERT INTO business_profiles (user_id, business_name) VALUES ($1, $2)`, [user.id, `${fullName.trim()}'s Business`]);
    } else if (role === 'ca') {
      await client.query(`INSERT INTO ca_profiles (user_id) VALUES ($1)`, [user.id]);
    }

    const bonusSetting = await client.query(`SELECT value FROM admin_settings WHERE key = 'signup_bonus_credits'`);
    const bonus = bonusSetting.rows.length ? Number(bonusSetting.rows[0].value) : 100;
    if (bonus > 0) {
      await grantCredits(client, {
        userId: user.id,
        amount: bonus,
        type: 'signup_bonus',
        description: 'Welcome bonus',
        referenceId: `signup-bonus-${user.id}`, // one per user, ever — can't be granted twice
      });
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  res.status(201).json({ token: signToken(user), user });
}));

// POST /api/auth/login
router.post('/login', asyncRoute(async (req, res) => {
  const { email, password } = req.body;
  if (!isValidEmail(email) || !password) throw new HttpError(400, 'Email and password are required');

  const { rows } = await query(
    'SELECT id, email, role, full_name, password_hash, is_active FROM users WHERE email = $1',
    [email]
  );
  const user = rows[0];
  // Same error for "no such user" and "wrong password" — don't leak which one it was.
  if (!user || !user.is_active) throw new HttpError(401, 'Incorrect email or password');

  const match = await bcrypt.compare(password, user.password_hash);
  if (!match) throw new HttpError(401, 'Incorrect email or password');

  delete user.password_hash;
  res.json({ token: signToken(user), user });
}));

// GET /api/auth/me
router.get('/me', requireAuth, asyncRoute(async (req, res) => {
  const { rows } = await query(
    'SELECT id, email, role, full_name, phone, created_at FROM users WHERE id = $1',
    [req.user.id]
  );
  if (!rows.length) throw new HttpError(404, 'User not found');
  res.json(rows[0]);
}));

module.exports = router;
