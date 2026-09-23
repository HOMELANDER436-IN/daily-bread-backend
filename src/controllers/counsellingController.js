'use strict';

const admin  = require('firebase-admin');
const { getDb } = require('../config/firebase');
const { ok, fail, serverError } = require('../utils/response');

const COLLECTION = 'counselling_requests';
const PAGE_SIZE  = 20;

const getDocMillis = (doc) => {
  const data = doc.data();
  if (data.created_at?.toMillis) return data.created_at.toMillis();
  if (data.created_at?.seconds) return data.created_at.seconds * 1000;
  return new Date(data.created_at || 0).getTime();
};

// ─── Public: Submit ───────────────────────────────────────────
const submit = async (req, res) => {
  const db = getDb();
  if (!db) return serverError(res, 'Database not initialized');

  const { full_name, contact_number, comment } = req.body;
  const now = admin.firestore.Timestamp.now();

  try {
    const ref = await db.collection(COLLECTION).add({
      full_name:      full_name.trim(),
      contact_number: contact_number.trim(),
      comment:        comment?.trim() || null,
      is_viewed:      false,
      viewed_at:      null,
      created_at:     now,
    });

    return ok(res, { id: ref.id }, 'Request submitted', 201);
  } catch (err) {
    return serverError(res, err.message);
  }
};

// ─── Admin: List ──────────────────────────────────────────────
const adminList = async (req, res) => {
  const db     = getDb();
  if (!db) return serverError(res, 'Database not initialized');

  const filter = req.query.filter || 'all'; // 'all' | 'unread' | 'viewed'
  const page   = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const limit  = Math.min(parseInt(req.query.limit, 10) || PAGE_SIZE, 100);

  try {
    try {
      let query = db.collection(COLLECTION).orderBy('created_at', 'desc');

      if (filter === 'unread') query = query.where('is_viewed', '==', false);
      if (filter === 'viewed')  query = query.where('is_viewed', '==', true);

      const countSnap = await query.select().get();
      const total = countSnap.size;

      const offset = (page - 1) * limit;
      const pageSnap = await query.limit(limit).offset(offset).get();
      const requests = pageSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

      return ok(res, { requests, total, page, limit });
    } catch (queryErr) {
      if (queryErr.message && queryErr.message.includes('requires an index')) {
        const snap = await db.collection(COLLECTION).get();
        let docs = snap.docs;
        if (filter === 'unread') docs = docs.filter(d => !d.data().is_viewed);
        if (filter === 'viewed')  docs = docs.filter(d => d.data().is_viewed);

        docs.sort((a, b) => getDocMillis(b) - getDocMillis(a));
        const total = docs.length;
        const offset = (page - 1) * limit;
        const paginatedDocs = docs.slice(offset, offset + limit);
        const requests = paginatedDocs.map(doc => ({ id: doc.id, ...doc.data() }));

        return ok(res, { requests, total, page, limit });
      }
      throw queryErr;
    }
  } catch (err) {
    return serverError(res, err.message);
  }
};

// ─── Admin: Counts ────────────────────────────────────────────
const adminCounts = async (_req, res) => {
  const db = getDb();
  if (!db) return serverError(res, 'Database not initialized');

  try {
    const snap = await db.collection(COLLECTION).get();
    const total = snap.size;
    let unread = 0;
    snap.forEach(doc => {
      if (!doc.data().is_viewed) unread++;
    });

    return ok(res, {
      total,
      unread,
      viewed: total - unread,
    });
  } catch (err) {
    return serverError(res, err.message);
  }
};

// ─── Admin: Single ────────────────────────────────────────────
const adminGetOne = async (req, res) => {
  const db = getDb();
  if (!db) return serverError(res, 'Database not initialized');

  try {
    const doc = await db.collection(COLLECTION).doc(req.params.id).get();
    if (!doc.exists) return fail(res, 'Request not found', 404);
    return ok(res, { id: doc.id, ...doc.data() });
  } catch (err) {
    return serverError(res, err.message);
  }
};

// ─── Admin: Mark Viewed ───────────────────────────────────────
const markViewed = async (req, res) => {
  const db = getDb();
  if (!db) return serverError(res, 'Database not initialized');

  try {
    const ref = db.collection(COLLECTION).doc(req.params.id);
    const doc = await ref.get();
    if (!doc.exists) return fail(res, 'Request not found', 404);

    await ref.update({
      is_viewed: true,
      viewed_at: admin.firestore.Timestamp.now(),
    });

    const updated = await ref.get();
    return ok(res, { id: updated.id, ...updated.data() });
  } catch (err) {
    return serverError(res, err.message);
  }
};

// ─── Admin: Delete One ────────────────────────────────────────
const deleteOne = async (req, res) => {
  const db = getDb();
  if (!db) return serverError(res, 'Database not initialized');

  try {
    const ref = db.collection(COLLECTION).doc(req.params.id);
    const doc = await ref.get();
    if (!doc.exists) return fail(res, 'Request not found', 404);

    await ref.delete();
    return ok(res, null, 'Request deleted');
  } catch (err) {
    return serverError(res, err.message);
  }
};

// ─── Admin: Delete All ────────────────────────────────────────
const deleteAll = async (_req, res) => {
  const db = getDb();
  if (!db) return serverError(res, 'Database not initialized');

  try {
    const snap = await db.collection(COLLECTION).get();
    if (snap.empty) return ok(res, { deleted: 0 }, 'No requests to delete');

    const BATCH_SIZE = 400;
    let deleted = 0;

    for (let i = 0; i < snap.docs.length; i += BATCH_SIZE) {
      const batch = db.batch();
      snap.docs.slice(i, i + BATCH_SIZE).forEach(doc => {
        batch.delete(doc.ref);
        deleted++;
      });
      await batch.commit();
    }

    return ok(res, { deleted }, `${deleted} request(s) deleted`);
  } catch (err) {
    return serverError(res, err.message);
  }
};

module.exports = { submit, adminList, adminCounts, adminGetOne, markViewed, deleteOne, deleteAll };
