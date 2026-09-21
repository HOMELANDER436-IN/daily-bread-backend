'use strict';

const admin  = require('firebase-admin');
const { getDb } = require('../config/firebase');
const { ok, fail, serverError } = require('../utils/response');

// Reactions stored as subcollection: messages/{messageId}/reactions
// Document ID = device_id (ensures one reaction per device per message)

// ─── Get Reactions ────────────────────────────────────────────
const getReactions = async (req, res) => {
  const db = getDb();
  if (!db) return serverError(res, 'Database not initialized');

  const { id: messageId }    = req.params;
  const { device_id }        = req.query;

  try {
    const reactionsRef = db.collection('messages').doc(messageId).collection('reactions');
    const snap = await reactionsRef.get();

    let likes = 0, dislikes = 0, myReaction = null;

    snap.forEach(doc => {
      const data = doc.data();
      if (data.reaction === 'like')    likes++;
      if (data.reaction === 'dislike') dislikes++;
      if (device_id && doc.id === device_id) myReaction = data.reaction;
    });

    return ok(res, { likes, dislikes, myReaction });
  } catch (err) {
    return serverError(res, err.message);
  }
};

// ─── Upsert Reaction ──────────────────────────────────────────
const upsertReaction = async (req, res) => {
  const db = getDb();
  if (!db) return serverError(res, 'Database not initialized');

  const { id: messageId } = req.params;
  const { device_id, reaction } = req.body;

  try {
    // Verify message exists
    const msgDoc = await db.collection('messages').doc(messageId).get();
    if (!msgDoc.exists) return fail(res, 'Message not found', 404);

    const reactionRef = db
      .collection('messages').doc(messageId)
      .collection('reactions').doc(device_id);

    const existing = await reactionRef.get();
    const now = admin.firestore.Timestamp.now();

    let action;

    if (existing.exists && existing.data().reaction === reaction) {
      // Same reaction → remove (toggle off)
      await reactionRef.delete();
      action = 'removed';
    } else {
      // New or different reaction → set
      await reactionRef.set({
        reaction,
        device_id,
        created_at: existing.exists ? existing.data().created_at : now,
        updated_at: now,
      });
      action = existing.exists ? 'changed' : 'added';
    }

    // Recount
    const snap = await db.collection('messages').doc(messageId).collection('reactions').get();
    let likes = 0, dislikes = 0, myReaction = null;
    snap.forEach(doc => {
      const d = doc.data();
      if (d.reaction === 'like')    likes++;
      if (d.reaction === 'dislike') dislikes++;
      if (doc.id === device_id) myReaction = d.reaction;
    });

    return ok(res, { action, myReaction, likes, dislikes });
  } catch (err) {
    return serverError(res, err.message);
  }
};

// ─── Remove Reaction ──────────────────────────────────────────
const removeReaction = async (req, res) => {
  const db = getDb();
  if (!db) return serverError(res, 'Database not initialized');

  const { id: messageId } = req.params;
  const { device_id } = req.body;

  try {
    await db.collection('messages').doc(messageId)
      .collection('reactions').doc(device_id)
      .delete();

    return ok(res, null, 'Reaction removed');
  } catch (err) {
    return serverError(res, err.message);
  }
};

module.exports = { getReactions, upsertReaction, removeReaction };
