'use strict';

const admin  = require('firebase-admin');
const { getDb } = require('../config/firebase');
const { ok, fail, serverError } = require('../utils/response');

const COLLECTION = 'messages';

// ─── Helpers ──────────────────────────────────────────────────
const docToMessage = (doc) => ({ id: doc.id, ...doc.data() });

const latestPublishedQuery = (db) =>
  db.collection(COLLECTION)
    .where('is_published', '==', true)
    .where('deleted_at', '==', null)
    .orderBy('created_at', 'desc')
    .limit(1);

// ─── Public: Latest Published ─────────────────────────────────
const getLatest = async (_req, res) => {
  const db = getDb();
  if (!db) return serverError(res, 'Database not initialized');

  try {
    const snap = await latestPublishedQuery(db).get();
    if (snap.empty) return ok(res, null);
    return ok(res, docToMessage(snap.docs[0]));
  } catch (err) {
    return serverError(res, err.message);
  }
};

// ─── Public: All Published (paginated) ───────────────────────
const getPublished = async (req, res) => {
  const db    = getDb();
  if (!db) return serverError(res, 'Database not initialized');

  const limit = Math.min(parseInt(req.query.limit) || 10, 50);

  try {
    let query = db.collection(COLLECTION)
      .where('is_published', '==', true)
      .where('deleted_at', '==', null)
      .orderBy('created_at', 'desc')
      .limit(limit);

    if (req.query.cursor) {
      const cursorDoc = await db.collection(COLLECTION).doc(req.query.cursor).get();
      if (cursorDoc.exists) query = query.startAfter(cursorDoc);
    }

    const snap = await query.get();
    const messages = snap.docs.map(docToMessage);
    const nextCursor = messages.length === limit ? messages[messages.length - 1].id : null;

    return ok(res, { messages, nextCursor });
  } catch (err) {
    return serverError(res, err.message);
  }
};

// ─── Admin: List All ──────────────────────────────────────────
const adminGetAll = async (_req, res) => {
  const db = getDb();
  if (!db) return serverError(res, 'Database not initialized');

  try {
    const snap = await db.collection(COLLECTION)
      .where('deleted_at', '==', null)
      .orderBy('created_at', 'desc')
      .get();

    return ok(res, snap.docs.map(docToMessage));
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
    if (!doc.exists || doc.data().deleted_at !== null) return fail(res, 'Message not found', 404);
    return ok(res, docToMessage(doc));
  } catch (err) {
    return serverError(res, err.message);
  }
};

// ─── Admin: Create ────────────────────────────────────────────
const create = async (req, res) => {
  const db = getDb();
  if (!db) return serverError(res, 'Database not initialized');

  const { title, content, reference, image_url, language, is_published } = req.body;
  const now = admin.firestore.Timestamp.now();

  try {
    const ref = await db.collection(COLLECTION).add({
      title:        title || null,
      content,
      reference:    reference || null,
      image_url:    image_url || null,
      language:     language || 'en',
      is_published: is_published || false,
      deleted_at:   null,
      created_at:   now,
      updated_at:   now,
    });

    const doc = await ref.get();
    return ok(res, docToMessage(doc), 'Message created', 201);
  } catch (err) {
    return serverError(res, err.message);
  }
};

// ─── Admin: Update ────────────────────────────────────────────
const update = async (req, res) => {
  const db = getDb();
  if (!db) return serverError(res, 'Database not initialized');

  const { title, content, reference, image_url, language, is_published } = req.body;

  try {
    const ref = db.collection(COLLECTION).doc(req.params.id);
    const doc = await ref.get();
    if (!doc.exists || doc.data().deleted_at !== null) return fail(res, 'Message not found', 404);

    const updates = {
      title:        title !== undefined ? (title || null) : doc.data().title,
      content:      content || doc.data().content,
      reference:    reference !== undefined ? (reference || null) : doc.data().reference,
      image_url:    image_url !== undefined ? (image_url || null) : doc.data().image_url,
      language:     language || doc.data().language,
      is_published: is_published !== undefined ? is_published : doc.data().is_published,
      updated_at:   admin.firestore.Timestamp.now(),
    };

    await ref.update(updates);
    const updated = await ref.get();
    return ok(res, docToMessage(updated));
  } catch (err) {
    return serverError(res, err.message);
  }
};

// ─── Admin: Soft Delete ───────────────────────────────────────
const deleteMessage = async (req, res) => {
  const db = getDb();
  if (!db) return serverError(res, 'Database not initialized');

  try {
    const ref = db.collection(COLLECTION).doc(req.params.id);
    const doc = await ref.get();
    if (!doc.exists) return fail(res, 'Message not found', 404);

    await ref.update({
      deleted_at:   admin.firestore.Timestamp.now(),
      is_published: false,
      updated_at:   admin.firestore.Timestamp.now(),
    });

    return ok(res, null, 'Message deleted');
  } catch (err) {
    return serverError(res, err.message);
  }
};

// ─── Admin: Toggle Publish ────────────────────────────────────
const togglePublish = async (req, res) => {
  const db = getDb();
  if (!db) return serverError(res, 'Database not initialized');

  const { is_published } = req.body;

  try {
    const ref = db.collection(COLLECTION).doc(req.params.id);
    const doc = await ref.get();
    if (!doc.exists || doc.data().deleted_at !== null) return fail(res, 'Message not found', 404);

    await ref.update({
      is_published,
      updated_at: admin.firestore.Timestamp.now(),
    });

    const updated = await ref.get();
    return ok(res, docToMessage(updated));
  } catch (err) {
    return serverError(res, err.message);
  }
};

module.exports = { getLatest, getPublished, adminGetAll, adminGetOne, create, update, deleteMessage, togglePublish };
