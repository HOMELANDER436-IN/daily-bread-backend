'use strict';

const express = require('express');
const router = express.Router();
const { body, query } = require('express-validator');
const { getReactions, upsertReaction, removeReaction } = require('../controllers/reactionsController');
const { reactionLimiter } = require('../middleware/rateLimiter');
const validate = require('../middleware/validate');

router.get(
  '/:id/reactions',
  [query('device_id').optional().isString().trim()],
  validate,
  getReactions
);

router.post(
  '/:id/reaction',
  reactionLimiter,
  [
    body('device_id').notEmpty().isString().trim().withMessage('device_id required'),
    body('reaction').isIn(['like', 'dislike']).withMessage('reaction must be "like" or "dislike"'),
  ],
  validate,
  upsertReaction
);

router.delete(
  '/:id/reaction',
  reactionLimiter,
  [body('device_id').notEmpty().isString().trim()],
  validate,
  removeReaction
);

module.exports = router;
