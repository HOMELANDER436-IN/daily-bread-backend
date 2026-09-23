'use strict';

require('dotenv').config();

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const { generalLimiter } = require('./middleware/rateLimiter');

// Route modules
const adminRoutes = require('./routes/admin');
const messagesRoutes = require('./routes/messages');
const reactionsRoutes = require('./routes/reactions');
const counsellingRoutes = require('./routes/counselling');
const prayerRoutes = require('./routes/prayer');
const devicesRoutes = require('./routes/devices');

const logger = require('./config/logger');

const app = express();

// ─── Security Middleware ──────────────────────────────────────────────────────
app.use(
  helmet({
    crossOriginEmbedderPolicy: false,
    contentSecurityPolicy: process.env.NODE_ENV === 'production',
  })
);

const rawOrigins = process.env.ALLOWED_ORIGINS;
const isWildcard = !rawOrigins || rawOrigins.trim() === '*' || rawOrigins.trim() === '';
const allowedOriginsList = isWildcard
  ? []
  : rawOrigins.split(',').map(o => o.trim()).filter(Boolean);

app.use(
  cors({
    origin: isWildcard
      ? '*'
      : (origin, callback) => {
          // Allow requests with no origin (such as mobile apps, curl, server-to-server)
          if (!origin || allowedOriginsList.includes(origin) || allowedOriginsList.includes('*')) {
            return callback(null, true);
          }
          return callback(null, false);
        },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: false,
  })
);

app.use(generalLimiter);

// ─── Body Parsing ─────────────────────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ─── Request Logging ─────────────────────────────────────────────────────────
app.use((req, _res, next) => {
  logger.debug(`${req.method} ${req.path}`);
  next();
});

// ─── Root & Health Check ──────────────────────────────────────────────────────
app.get('/', (_req, res) => {
  res.json({
    success: true,
    name: 'Daily Bread API',
    status: 'online',
    message: 'Backend server is running successfully.',
    endpoints: {
      health: '/health',
      latestMessage: '/api/messages/latest',
      currentPrayer: '/api/prayer/current',
      adminDashboard: '/api/admin/dashboard',
    },
  });
});

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', app: 'Daily Bread API' });
});

// ─── No-Cache Headers for Dynamic Data ──────────────────────────────────────
// Prevents browsers and CDN from caching live Firestore-backed responses.
// After Admin publishes/edits/deletes, Viewer always fetches fresh data.
app.use(['/api/messages', '/api/prayer', '/api/counselling', '/api/admin'], (_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

// ─── API Routes ───────────────────────────────────────────────────────────────
// Admin APIs (no login/token required)
app.use('/api/admin', adminRoutes);

// Public & Sub-resource APIs
app.use('/api/messages', messagesRoutes);
app.use('/api/messages', reactionsRoutes);   // reactions share /api/messages/:id prefix
app.use('/api/counselling', counsellingRoutes);
app.use('/api/prayer', prayerRoutes);
app.use('/api/devices', devicesRoutes);

// ─── 404 Handler ─────────────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ success: false, message: 'Route not found' });
});

// ─── Global Error Handler ─────────────────────────────────────────────────────
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  logger.error(`Unhandled error: ${err.stack || err.message}`);
  res.status(500).json({ success: false, message: 'Internal server error' });
});

module.exports = app;
