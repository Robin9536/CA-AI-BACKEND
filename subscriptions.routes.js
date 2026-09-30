const express = require('express');
const { query } = require('./pool');
const { asyncRoute, HttpError } = require('./errorHandler');
const { requireAuth } = require('./auth');

const router = express.Router();

// GET /api/subscriptions/plans?audience=business_owner|ca  (public)
router.get('/plans', asyncRoute(async (req, res) => {
  const { audience } = req.query;
  const { rows } = audience
    ? await query('SELECT * FROM plans WHERE audience = $1 ORDER BY price_paise', [audience])
    : await query('SELECT * FROM plans ORDER BY audience, price_paise');
  res.json(rows);
}));

router.use(requireAuth);

// GET /api/subscriptions/me
router.get('/me', asyncRoute(async (req, res) => {
  const { rows } = await query(
    `SELECT s.*, p.name AS plan_name, p.code AS plan_code, p.features
     FROM subscriptions s JOIN plans p ON p.id = s.plan_id
     WHERE s.user_id = $1 AND s.status IN ('active','trialing') ORDER BY s.created_at DESC LIMIT 1`,
    [req.user.id]
  );
  res.json(rows[0] || null);
}));

// POST /api/subscriptions — subscribe to a plan
// NOTE: like payments.routes.js, this records the subscription state; actual
// recurring billing needs a payment-gateway subscription object wired in.
router.post('/', asyncRoute(async (req, res) => {
  const { planId } = req.body;
  const plan = await query('SELECT * FROM plans WHERE id = $1', [planId]);
  if (!plan.rows.length) throw new HttpError(404, 'Plan not found');
  if (plan.rows[0].audience !== req.user.role) throw new HttpError(400, 'That plan is not available for your account type');

  await query(`UPDATE subscriptions SET status = 'cancelled' WHERE user_id = $1 AND status = 'active'`, [req.user.id]);
  const periodEnd = new Date();
  periodEnd.setMonth(periodEnd.getMonth() + 1);

  const { rows } = await query(
    `INSERT INTO subscriptions (user_id, plan_id, status, current_period_end) VALUES ($1,$2,'active',$3) RETURNING *`,
    [req.user.id, planId, periodEnd]
  );
  res.status(201).json(rows[0]);
}));

// DELETE /api/subscriptions/me — cancel at period end
router.delete('/me', asyncRoute(async (req, res) => {
  const { rows } = await query(
    `UPDATE subscriptions SET status = 'cancelled' WHERE user_id = $1 AND status = 'active' RETURNING *`,
    [req.user.id]
  );
  if (!rows.length) throw new HttpError(404, 'No active subscription to cancel');
  res.json(rows[0]);
}));

module.exports = router;
