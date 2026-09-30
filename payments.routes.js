const express = require('express');
const { query, pool } = require('./pool');
const { asyncRoute, HttpError } = require('./errorHandler');
const { requireAuth, requireRole } = require('./auth');
const { calculateCommission } = require('./commission');

const router = express.Router();
router.use(requireAuth);

async function getOwnBusinessId(userId) {
  const { rows } = await query('SELECT id FROM business_profiles WHERE user_id = $1', [userId]);
  if (!rows.length) throw new HttpError(404, 'Business profile not found');
  return rows[0].id;
}

// POST /api/payments — create a payment for a request and split the platform fee
// NOTE: this records the payment and computes the split; it does not itself move money.
// Wire `provider` + `provider_ref` up to a real gateway (Razorpay/Stripe) webhook to
// flip status from 'pending' to 'succeeded' once the charge actually clears. Card
// details are never sent to or stored by this API — the gateway's client SDK handles that.
router.post('/', requireRole('business_owner'), asyncRoute(async (req, res) => {
  const businessId = await getOwnBusinessId(req.user.id);
  const { requestId, caId, amountPaise } = req.body;
  if (!caId) throw new HttpError(400, 'caId is required');
  if (!Number.isInteger(amountPaise) || amountPaise <= 0) throw new HttpError(400, 'amountPaise must be a positive integer');

  const { feePaise, percent } = await calculateCommission(amountPaise);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const payment = await client.query(
      `INSERT INTO payments (request_id, business_id, ca_id, amount_paise, platform_fee_paise, status)
       VALUES ($1,$2,$3,$4,$5,'pending') RETURNING *`,
      [requestId || null, businessId, caId, amountPaise, feePaise]
    );
    await client.query(
      `INSERT INTO commissions (payment_id, percent_applied, amount_paise) VALUES ($1,$2,$3)`,
      [payment.rows[0].id, percent, feePaise]
    );
    await client.query('COMMIT');
    res.status(201).json(payment.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}));

// PATCH /api/payments/:id/settle — mark succeeded (call this from your gateway webhook handler)
router.patch('/:id/settle', asyncRoute(async (req, res) => {
  const { status, providerRef, provider } = req.body;
  if (!['succeeded', 'failed', 'refunded'].includes(status)) throw new HttpError(400, 'Invalid status');

  const { rows } = await query(
    `UPDATE payments SET status = $1, provider = $2, provider_ref = $3,
       settled_at = CASE WHEN $1 = 'succeeded' THEN now() ELSE settled_at END
     WHERE id = $4 RETURNING *`,
    [status, provider || null, providerRef || null, req.params.id]
  );
  if (!rows.length) throw new HttpError(404, 'Payment not found');
  res.json(rows[0]);
}));

// GET /api/payments/history
router.get('/history', asyncRoute(async (req, res) => {
  let rows;
  if (req.user.role === 'business_owner') {
    const businessId = await getOwnBusinessId(req.user.id);
    ({ rows } = await query(
      `SELECT p.*, u.full_name AS ca_name FROM payments p
       JOIN ca_profiles cp ON cp.id = p.ca_id JOIN users u ON u.id = cp.user_id
       WHERE p.business_id = $1 ORDER BY p.created_at DESC LIMIT 100`,
      [businessId]
    ));
  } else if (req.user.role === 'ca') {
    const { rows: caRows } = await query('SELECT id FROM ca_profiles WHERE user_id = $1', [req.user.id]);
    if (!caRows.length) throw new HttpError(404, 'CA profile not found');
    ({ rows } = await query(
      `SELECT p.*, bp.business_name FROM payments p
       JOIN business_profiles bp ON bp.id = p.business_id
       WHERE p.ca_id = $1 ORDER BY p.created_at DESC LIMIT 100`,
      [caRows[0].id]
    ));
  } else {
    ({ rows } = await query(`SELECT * FROM payments ORDER BY created_at DESC LIMIT 100`));
  }
  res.json(rows);
}));

module.exports = router;
