'use strict';

const admin = require('firebase-admin');

let firebaseInitialized = false;

/**
 * Initialize Firebase Admin SDK (Firestore + FCM).
 * Called once at server startup. Safe to call multiple times.
 */
const initializeFirebase = () => {
  if (firebaseInitialized || admin.apps.length > 0) {
    firebaseInitialized = true;
    return admin;
  }

  const projectId   = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey  = process.env.FIREBASE_PRIVATE_KEY;

  if (!projectId || !clientEmail || !privateKey) {
    console.warn(
      '[Firebase] Missing credentials (FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY).\n' +
      '  FCM notifications and database access will not work.\n' +
      '  Add a Firebase service account to your .env file.'
    );
    return null;
  }

  try {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId,
        clientEmail,
        // Format private key safely: strip surrounding quotes and unescape \n
        privateKey: privateKey.trim().replace(/^["']|["']$/g, '').replace(/\\n/g, '\n'),
      }),
    });
    firebaseInitialized = true;
    console.info('[Firebase] Admin SDK initialized — project:', projectId);
  } catch (err) {
    console.error('[Firebase] Initialization failed:', err.message);
    return null;
  }

  return admin;
};

/**
 * Get the Firestore database instance.
 * Returns a stub that logs an error if Firebase is not initialized.
 */
const getDb = () => {
  if (!firebaseInitialized || admin.apps.length === 0) {
    console.error('[Firestore] Not initialized. Call initializeFirebase() first.');
    return null;
  }
  return admin.firestore();
};

module.exports = { initializeFirebase, getDb, admin };
