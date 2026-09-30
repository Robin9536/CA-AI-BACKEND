const express = require('express');
const { query, pool } = require('./pool');
const { asyncRoute } = require('./errorHandler');
const { requireAuth } = require('./auth');
const { getOrCreateWallet } = require('./credits');

const router = express.Router();
router.use(requireAuth);

// GET /api/wallet/me — balance + purchased/used summary
router.get('/me', asyncRoute(async (req, res) => {
  const client = await pool.connect();
  let wallet;
  try {
    await client.query('BEGIN');
    wallet = await getOrCreateWallet(client, req.user.id);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  const summary = await query(
    `SELECT
       COALESCE(SUM(amount) FILTER (WHERE amount > 0), 0)::int AS total_credited,
       COALESCE(SUM(-amount) FILTER (WHERE amount < 0), 0)::int AS total_used
     FROM credit_transactions WHERE user_id = $1`,
    [req.user.id]
  );

  const threshold = await query(`SELECT value FROM admin_settings WHERE key = 'low_credit_warning_threshold'`);
  const lowThreshold = threshold.rows.length ? Number(threshold.rows[0].value) : 50;

  res.json({
    balance: wallet.balance,
    total_credited: summary.rows[0].total_credited,
    total_used: summary.rows[0].total_used,
    is_low: wallet.balance > 0 && wallet.balance <= lowThreshold,
    is_zero: wallet.balance <= 0,
  });
}));

// GET /api/wallet/transactions?limit=&before=
router.get('/transactions', asyncRoute(async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 30, 100);
  const { rows } = await query(
    `SELECT id, type, amount, balance_after, description, created_at
     FROM credit_transactions WHERE user_id = $1
     ORDER BY created_at DESC LIMIT $2`,
    [req.user.id, limit]
  );
  res.json(rows);
}));

// GET /api/wallet/ai-costs — public-to-authenticated list of what each AI feature costs
router.get('/ai-costs', asyncRoute(async (req, res) => {
  const { rows } = await query('SELECT feature_key, label, credit_cost FROM ai_feature_costs ORDER BY credit_cost');
  res.json(rows);
}));

module.exports = router;
