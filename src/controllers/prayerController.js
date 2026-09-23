'use strict';

const admin  = require('firebase-admin');
const { getDb } = require('../config/firebase');
const { ok, fail, serverError } = require('../utils/response');

// prayer_settings stored as a document: prayer_settings/current
// prayer_events stored with doc ID = 'yyyy-mm-dd' for idempotency
const SETTINGS_DOC   = 'prayer_settings/current';
const FALLBACK_DOC   = 'prayer_settings/main';
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
    const data = doc.data();
    return ok(res, {
      id: doc.id,
      date: data.event_date || data.date || doc.id,
      scheduledTime: data.scheduled_time || data.scheduledTime || '',
      sentAt: data.sent_at || data.sentAt || data.scheduled_at,
      expiresAt: data.expires_at || data.expiresAt,
      message: data.message || 'It is prayer time. Take a moment to pray.',
      isActive: true,
      ...data,
    });
  } catch (err) {
    return serverError(res, err.message);
  }
};

// ─── Admin: Get Settings ──────────────────────────────────────
const getSettings = async (_req, res) => {
  const db = getDb();
  if (!db) return serverError(res, 'Database not initialized');

  try {
    let doc = await db.doc(SETTINGS_DOC).get();
    if (!doc.exists) {
      doc = await db.doc(FALLBACK_DOC).get();
    }

    if (!doc.exists) {
      // Return defaults
      return ok(res, {
        enabled: false,
        hour: 21,
        minute: 0,
        prayer_time: '21:00',
        timezone: 'Asia/Kolkata',
      });
    }

    const data = doc.data();
    let hour = data.hour;
    let minute = data.minute;
    let prayer_time = data.prayer_time;

    if (prayer_time && (hour === undefined || minute === undefined)) {
      const parts = prayer_time.split(':');
      hour = parseInt(parts[0], 10) || 0;
      minute = parseInt(parts[1], 10) || 0;
    } else if (hour !== undefined && minute !== undefined && !prayer_time) {
      prayer_time = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
    }

    return ok(res, {
      id: doc.id,
      enabled: data.enabled ?? false,
      hour: hour ?? 21,
      minute: minute ?? 0,
      prayer_time: prayer_time || '21:00',
      timezone: data.timezone || 'Asia/Kolkata',
      updatedAt: data.updatedAt || data.updated_at,
      ...data,
    });
  } catch (err) {
    return serverError(res, err.message);
  }
};

// ─── Admin: Update Settings ───────────────────────────────────
const updateSettings = async (req, res) => {
  const db = getDb();
  if (!db) return serverError(res, 'Database not initialized');

  let { prayer_time, hour, minute, timezone, enabled } = req.body;

  if (prayer_time && (hour === undefined || minute === undefined)) {
    const parts = prayer_time.split(':');
    hour = parseInt(parts[0], 10) || 0;
    minute = parseInt(parts[1], 10) || 0;
  } else if (hour !== undefined && minute !== undefined && !prayer_time) {
    prayer_time = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  }

  try {
    const ref = db.doc(SETTINGS_DOC);
    const existing = await ref.get();
    const exData = existing.exists ? existing.data() : {};
    const now = admin.firestore.Timestamp.now();

    const finalPrayerTime = prayer_time ?? exData.prayer_time ?? '21:00';
    const finalHour = hour !== undefined ? parseInt(hour, 10) : (exData.hour ?? 21);
    const finalMinute = minute !== undefined ? parseInt(minute, 10) : (exData.minute ?? 0);
    const finalTimezone = timezone ?? exData.timezone ?? 'Asia/Kolkata';
    const finalEnabled = enabled !== undefined ? Boolean(enabled) : (exData.enabled ?? false);

    const updates = {
      enabled: finalEnabled,
      hour: finalHour,
      minute: finalMinute,
      prayer_time: finalPrayerTime,
      timezone: finalTimezone,
      updatedAt: now,
      updated_at: now,
    };

    await ref.set(updates, { merge: true });
    // Also update fallback doc for sync
    await db.doc(FALLBACK_DOC).set(updates, { merge: true }).catch(() => null);

    return ok(res, { id: 'current', ...updates });
  } catch (err) {
    return serverError(res, err.message);
  }
};

// ─── Admin: Multiple Prayer Schedules CRUD ──────────────────
const SCHEDULES_COLLECTION = 'prayer_schedules';

const listSchedules = async (_req, res) => {
  const db = getDb();
  if (!db) return serverError(res, 'Database not initialized');
  try {
    const snap = await db.collection(SCHEDULES_COLLECTION).get();
    const schedules = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    // Sort by time ascending
    schedules.sort((a, b) => (a.time || '').localeCompare(b.time || ''));
    return ok(res, schedules);
  } catch (err) {
    return serverError(res, err.message);
  }
};

const getSchedule = async (req, res) => {
  const db = getDb();
  if (!db) return serverError(res, 'Database not initialized');
  try {
    const doc = await db.collection(SCHEDULES_COLLECTION).doc(req.params.id).get();
    if (!doc.exists) return fail(res, 'Schedule not found', 404);
    return ok(res, { id: doc.id, ...doc.data() });
  } catch (err) {
    return serverError(res, err.message);
  }
};

const createSchedule = async (req, res) => {
  const db = getDb();
  if (!db) return serverError(res, 'Database not initialized');

  const { type, time, daysOfWeek, date, enabled, timezone, label } = req.body;
  if (!type || !['daily', 'weekly', 'once'].includes(type)) {
    return fail(res, 'Invalid schedule type. Must be daily, weekly, or once', 400);
  }
  if (!time || !time.match(/^\d{2}:\d{2}$/)) {
    return fail(res, 'Invalid time format. Must be HH:MM (e.g. 21:00)', 400);
  }
  if (type === 'weekly' && (!Array.isArray(daysOfWeek) || daysOfWeek.length === 0)) {
    return fail(res, 'daysOfWeek must be a non-empty array of day numbers for weekly schedule', 400);
  }
  if (type === 'once' && (!date || !date.match(/^\d{4}-\d{2}-\d{2}$/))) {
    return fail(res, 'date is required in YYYY-MM-DD format for once schedule', 400);
  }

  const now = admin.firestore.Timestamp.now();
  try {
    const payload = {
      type,
      time,
      daysOfWeek: type === 'daily' ? [0, 1, 2, 3, 4, 5, 6] : (daysOfWeek ? daysOfWeek.map(Number) : []),
      date: type === 'once' ? date : null,
      label: label ? String(label).trim() : '',
      enabled: enabled !== undefined ? Boolean(enabled) : true,
      completed: false,
      timezone: timezone || 'Asia/Kolkata',
      createdAt: now,
      created_at: now,
      updatedAt: now,
      updated_at: now,
    };

    const ref = await db.collection(SCHEDULES_COLLECTION).add(payload);
    const savedDoc = await ref.get();
    return ok(res, { id: savedDoc.id, ...savedDoc.data() }, 'Prayer schedule created', 201);
  } catch (err) {
    return serverError(res, err.message);
  }
};

const updateSchedule = async (req, res) => {
  const db = getDb();
  if (!db) return serverError(res, 'Database not initialized');

  const { type, time, daysOfWeek, date, enabled, timezone, label } = req.body;
  try {
    const ref = db.collection(SCHEDULES_COLLECTION).doc(req.params.id);
    const existing = await ref.get();
    if (!existing.exists) return fail(res, 'Schedule not found', 404);

    const ex = existing.data();
    const finalType = type || ex.type || 'daily';
    const finalTime = time || ex.time || '21:00';
    const finalDays = finalType === 'daily'
      ? [0, 1, 2, 3, 4, 5, 6]
      : (daysOfWeek !== undefined ? (Array.isArray(daysOfWeek) ? daysOfWeek.map(Number) : []) : (ex.daysOfWeek || []));
    const finalDate = finalType === 'once' ? (date || ex.date || null) : null;
    const finalEnabled = enabled !== undefined ? Boolean(enabled) : (ex.enabled ?? true);
    const now = admin.firestore.Timestamp.now();

    const updates = {
      type: finalType,
      time: finalTime,
      daysOfWeek: finalDays,
      date: finalDate,
      enabled: finalEnabled,
      timezone: timezone || ex.timezone || 'Asia/Kolkata',
      updatedAt: now,
      updated_at: now,
    };
    if (label !== undefined) updates.label = String(label).trim();

    await ref.update(updates);
    const updated = await ref.get();
    return ok(res, { id: updated.id, ...updated.data() }, 'Prayer schedule updated');
  } catch (err) {
    return serverError(res, err.message);
  }
};

const deleteSchedule = async (req, res) => {
  const db = getDb();
  if (!db) return serverError(res, 'Database not initialized');
  try {
    const ref = db.collection(SCHEDULES_COLLECTION).doc(req.params.id);
    const existing = await ref.get();
    if (!existing.exists) return fail(res, 'Schedule not found', 404);
    await ref.delete();
    return ok(res, null, 'Prayer schedule deleted');
  } catch (err) {
    return serverError(res, err.message);
  }
};

const toggleSchedule = async (req, res) => {
  const db = getDb();
  if (!db) return serverError(res, 'Database not initialized');
  const { enabled } = req.body;
  try {
    const ref = db.collection(SCHEDULES_COLLECTION).doc(req.params.id);
    const existing = await ref.get();
    if (!existing.exists) return fail(res, 'Schedule not found', 404);

    const newEnabled = enabled !== undefined ? Boolean(enabled) : !existing.data().enabled;
    const now = admin.firestore.Timestamp.now();
    await ref.update({
      enabled: newEnabled,
      updatedAt: now,
      updated_at: now,
    });
    const updated = await ref.get();
    return ok(res, { id: updated.id, ...updated.data() });
  } catch (err) {
    return serverError(res, err.message);
  }
};

module.exports = {
  getCurrent,
  getSettings,
  updateSettings,
  listSchedules,
  getSchedule,
  createSchedule,
  updateSchedule,
  deleteSchedule,
  toggleSchedule,
};
