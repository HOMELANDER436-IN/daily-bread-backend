'use strict';

require('dotenv').config();

const app    = require('./app');
const { initializeFirebase } = require('./config/firebase');
const { startPrayerScheduler } = require('./services/prayerScheduler');

const PORT = process.env.PORT || 3000;

const start = async () => {
  try {
    // Initialize Firebase (Firestore + FCM)
    const firebase = initializeFirebase();

    if (firebase) {
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
