require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const { errorHandler } = require('./errorHandler');
const authRoutes = require('./auth.routes');
const businessRoutes = require('./business.routes');
const accountingRoutes = require('./accounting.routes');
const gstRoutes = require('./gst.routes');
const documentsRoutes = require('./documents.routes');
const marketplaceRoutes = require('./marketplace.routes');
const paymentsRoutes = require('./payments.routes');
const subscriptionsRoutes = require('./subscriptions.routes');
const adminRoutes = require('./admin.routes');
const aiRoutes = require('./ai.routes');
const walletRoutes = require('./wallet.routes');
const creditsRoutes = require('./credits.routes');

const app = express();

app.use(helmet());
app.use(cors({ origin: process.env.CLIENT_ORIGIN || '*', credentials: true }));
app.use(express.json({ limit: '2mb' }));

// Generous global limit; tighten per-route (e.g. /auth/login) if you see abuse.
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 600 }));

app.get('/api/health', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

app.use('/api/auth', authRoutes);
app.use('/api/business', businessRoutes);
app.use('/api/accounting', accountingRoutes);
app.use('/api/gst', gstRoutes);
app.use('/api/documents', documentsRoutes);
app.use('/api/marketplace', marketplaceRoutes);
app.use('/api/payments', paymentsRoutes);
app.use('/api/subscriptions', subscriptionsRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/wallet', walletRoutes);
app.use('/api/credits', creditsRoutes);

app.use((req, res) => res.status(404).json({ error: 'Not found' }));
app.use(errorHandler);

module.exports = app;
