'use strict';

const jwt = require('jsonwebtoken');
const { error } = require('../utils/response');

/**
 * Verifies a Bearer JWT token in the Authorization header.
 * Attaches decoded admin payload to req.admin.
 */
const auth = (req, res, next) => {
  const authHeader = req.headers['authorization'];

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return error(res, 'Authorization token required', 401);
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.admin = decoded;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return error(res, 'Token has expired. Please log in again.', 401);
    }
    if (err.name === 'JsonWebTokenError') {
      return error(res, 'Invalid token', 401);
    }
    return error(res, 'Authentication failed', 401);
  }
};

module.exports = auth;
