'use strict';

require('dotenv').config();

const app    = require('./app');
const { initializeFirebase } = require('./config/firebase');
const { startPrayerScheduler } = require('./services/prayerScheduler');

const PORT = process.env.PORT || 3000;

/**
 * Seeds the admin user in Firestore on first run.
 * Only runs if ADMIN_EMAIL and ADMIN_PASSWORD are set.
 */
const seedAdmin = async () => {
  if (!process.env.ADMIN_EMAIL || !process.env.ADMIN_PASSWORD) {
    console.warn('[Seed] ADMIN_EMAIL or ADMIN_PASSWORD not set — skipping admin seed.');
    return;
  }

  try {
    const { getDb } = require('./config/firebase');
    const bcrypt    = require('bcryptjs');
    const db        = getDb();
    if (!db) return;

    const email = process.env.ADMIN_EMAIL.toLowerCase().trim();

    // Check if admin already exists
    const existing = await db.collection('admin_users')
      .where('email', '==', email)
      .limit(1)
      .get();

    if (!existing.empty) {
      console.debug(`[Seed] Admin user already exists: ${email}`);
      return;
    }

    const hash = await bcrypt.hash(process.env.ADMIN_PASSWORD, 12);
    await db.collection('admin_users').add({ email, password_hash: hash });
    console.info(`[Seed] Admin user seeded: ${email}`);
  } catch (err) {
    console.error(`[Seed] Admin seed failed: ${err.message}`);
  }
};

const start = async () => {
  try {
    // Initialize Firebase (Firestore + FCM)
    const firebase = initializeFirebase();

    if (firebase) {
      // Seed admin user
      await seedAdmin();
      // Start prayer notification scheduler
      startPrayerScheduler();
    }

    // Start HTTP server
    app.listen(PORT, () => {
      console.info(`[Server] Daily Bread API running on port ${PORT}`);
      console.info(`[Server] Environment: ${process.env.NODE_ENV || 'development'}`);
      console.info(`[Server] Health: http://localhost:${PORT}/health`);
    });
  } catch (err) {
    console.error(`[Server] Startup failed: ${err.message}`);
    process.exit(1);
  }
};

start();
