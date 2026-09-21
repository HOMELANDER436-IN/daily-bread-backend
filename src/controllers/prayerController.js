'use strict';

const admin  = require('firebase-admin');
const { getDb } = require('../config/firebase');
const { ok, fail, serverError } = require('../utils/response');

// prayer_settings stored as a single document: prayer_settings/main
// prayer_events stored with doc ID = 'yyyy-mm-dd' for idempotency
const SETTINGS_DOC   = 'prayer_settings/main';
const EVENTS_COLLECTION = 'prayer_events';

// ─── Public: Get Current Prayer Event ────────────────────────
// Returns an active prayer event if one exists within the 2-hour window
const getCurrent = async (_req, res) => {
  const db = getDb();
  if (!db) return serverError(res, 'Database not initialized');

  try {
    const now = admin.firestore.Timestamp.now();

    const snap = await db.collection(EVENTS_COLLECTION)
      .where('expires_at', '>', now)
      .orderBy('expires_at', 'asc')
      .limit(1)
      .get();

    if (snap.empty) return ok(res, null);

    const doc = snap.docs[0];
    return ok(res, { id: doc.id, ...doc.data() });
  } catch (err) {
    return serverError(res, err.message);
  }
};

// ─── Admin: Get Settings ──────────────────────────────────────
const getSettings = async (_req, res) => {
  const db = getDb();
  if (!db) return serverError(res, 'Database not initialized');

  try {
    const doc = await db.doc(SETTINGS_DOC).get();

    if (!doc.exists) {
      // Return defaults
      return ok(res, { prayer_time: '21:00', timezone: 'Asia/Kolkata', enabled: false });
    }

    return ok(res, { id: doc.id, ...doc.data() });
  } catch (err) {
    return serverError(res, err.message);
  }
};

// ─── Admin: Update Settings ───────────────────────────────────
const updateSettings = async (req, res) => {
  const db = getDb();
  if (!db) return serverError(res, 'Database not initialized');

  const { prayer_time, timezone, enabled } = req.body;

  try {
    const ref = db.doc(SETTINGS_DOC);
    const existing = await ref.get();

    const updates = {
      prayer_time: prayer_time ?? (existing.exists ? existing.data().prayer_time : '21:00'),
      timezone:    timezone    ?? (existing.exists ? existing.data().timezone    : 'Asia/Kolkata'),
      enabled:     enabled !== undefined ? enabled : (existing.exists ? existing.data().enabled : false),
      updated_at:  admin.firestore.Timestamp.now(),
    };

    await ref.set(updates, { merge: true });
    const updated = await ref.get();
    return ok(res, { id: updated.id, ...updated.data() });
  } catch (err) {
    return serverError(res, err.message);
  }
};

module.exports = { getCurrent, getSettings, updateSettings };
