'use strict';

const admin  = require('firebase-admin');
const { getDb } = require('../config/firebase');
const { ok, serverError } = require('../utils/response');

const COLLECTION = 'device_tokens';

// ─── Register / Update Device Token ──────────────────────────
// Document ID = device_id (upsert semantics)
const register = async (req, res) => {
  const db = getDb();
  if (!db) return serverError(res, 'Database not initialized');

  const device_id = req.body.device_id || req.body.deviceId;
  const fcm_token = req.body.fcm_token || req.body.token;
  const platform = req.body.platform || 'web';
  const language = req.body.language || 'en';
  const now = admin.firestore.Timestamp.now();

  try {
    const ref = db.collection(COLLECTION).doc(device_id);
    const existing = await ref.get();

    await ref.set({
      device_id,
      deviceId:   device_id,
      fcm_token,
      token:      fcm_token,
      platform,
      language,
      is_active:  true,
      isActive:   true,
      created_at: existing.exists ? existing.data().created_at : now,
      createdAt:  existing.exists ? (existing.data().createdAt || existing.data().created_at) : now,
      updated_at: now,
      updatedAt:  now,
    });

    return ok(res, { deviceId: device_id, device_id }, 'Device registered');
  } catch (err) {
    return serverError(res, err.message);
  }
};

// ─── Deactivate Device Token ──────────────────────────────────
const deactivate = async (req, res) => {
  const db = getDb();
  if (!db) return serverError(res, 'Database not initialized');

  try {
    const ref = db.collection(COLLECTION).doc(req.params.deviceId);
    const doc = await ref.get();

    if (doc.exists) {
      await ref.update({
        is_active:  false,
        updated_at: admin.firestore.Timestamp.now(),
      });
    }

    return ok(res, null, 'Device deactivated');
  } catch (err) {
    return serverError(res, err.message);
  }
};

module.exports = { register, deactivate };
