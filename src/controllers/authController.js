'use strict';

const bcrypt    = require('bcryptjs');
const jwt       = require('jsonwebtoken');
const { getDb } = require('../config/firebase');
const { ok, fail, serverError } = require('../utils/response');

const ADMIN_COLLECTION = 'admin_users';

// ─── Login ────────────────────────────────────────────────────
const login = async (req, res) => {
  const db = getDb();
  if (!db) return serverError(res, 'Database not initialized');

  const { email, password } = req.body;

  try {
    // Find admin by email
    const snap = await db
      .collection(ADMIN_COLLECTION)
      .where('email', '==', email.toLowerCase().trim())
      .limit(1)
      .get();

    if (snap.empty) {
      return fail(res, 'Invalid email or password', 401);
    }

    const adminDoc  = snap.docs[0];
    const adminData = adminDoc.data();

    const passwordMatch = await bcrypt.compare(password, adminData.password_hash);
    if (!passwordMatch) {
      return fail(res, 'Invalid email or password', 401);
    }

    const token = jwt.sign(
      { id: adminDoc.id, email: adminData.email, role: 'admin' },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );

    return ok(res, { token, email: adminData.email });
  } catch (err) {
    return serverError(res, err.message);
  }
};

// ─── Refresh Token ────────────────────────────────────────────
const refresh = async (req, res) => {
  const { id, email } = req.admin;

  const token = jwt.sign(
    { id, email, role: 'admin' },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );

  return ok(res, { token, email });
};

// ─── Logout ───────────────────────────────────────────────────
const logout = (_req, res) => {
  // JWT is stateless — client discards the token
  return ok(res, null, 'Logged out successfully');
};

module.exports = { login, refresh, logout };
