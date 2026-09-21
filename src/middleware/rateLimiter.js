'use strict';

const rateLimit = require('express-rate-limit');

const createLimiter = (windowMs, max, message) =>
  rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message },
    skip: (req) => process.env.NODE_ENV === 'test',
  });


// General API rate limit
const generalLimiter = createLimiter(
  15 * 60 * 1000, // 15 minutes
  200,
  'Too many requests. Please try again later.'
);

// Reaction-specific limiter (per-IP)
const reactionLimiter = createLimiter(
  60 * 1000, // 1 minute
  30,
  'Too many reactions. Please slow down.'
);

// Counselling submission limiter
const counsellingLimiter = createLimiter(
  60 * 60 * 1000, // 1 hour
  5,
  'Too many counselling submissions. Please try again later.'
);

module.exports = { generalLimiter, reactionLimiter, counsellingLimiter };
