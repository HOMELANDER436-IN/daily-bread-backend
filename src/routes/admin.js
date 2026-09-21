'use strict';

const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const validate = require('../middleware/validate');

const {
  adminGetAll,
  adminGetOne,
  create,
  update,
  deleteMessage,
  togglePublish,
} = require('../controllers/messagesController');

const {
  adminList,
  adminCounts,
  adminGetOne: adminGetOneCounselling,
  markViewed,
} = require('../controllers/counsellingController');

const {
  getSettings,
  updateSettings,
} = require('../controllers/prayerController');

// ─── Messages Admin APIs ──────────────────────────────────────
const messageBodyValidators = [
  body('content').notEmpty().trim().isLength({ max: 10000 }).withMessage('Content is required and must be under 10,000 characters'),
  body('title').optional({ nullable: true }).trim().isLength({ max: 200 }),
  body('reference').optional({ nullable: true }).trim().isLength({ max: 200 }),
  body('image_url').optional({ nullable: true }).trim(),
  body('language').optional().isIn(['en', 'ml']).withMessage('Language must be "en" or "ml"'),
];

router.get('/messages', adminGetAll);
router.get('/messages/:id', adminGetOne);
router.post('/messages', messageBodyValidators, validate, create);
router.put('/messages/:id', messageBodyValidators, validate, update);
router.delete('/messages/:id', deleteMessage);
router.patch(
  '/messages/:id/publish',
  [
    body().custom(b => b.is_published !== undefined || b.isPublished !== undefined).withMessage('is_published or isPublished required'),
  ],
  validate,
  (req, res, next) => {
    if (req.body.is_published === undefined && req.body.isPublished !== undefined) {
      req.body.is_published = req.body.isPublished;
    }
    next();
  },
  togglePublish
);

// ─── Counselling Admin APIs ───────────────────────────────────
router.get('/counselling', adminList);
router.get('/counselling/counts', adminCounts);
router.get('/counselling/:id', adminGetOneCounselling);
router.patch('/counselling/:id/viewed', markViewed);

// ─── Prayer Settings Admin APIs ───────────────────────────────
router.get('/prayer-settings', getSettings);
router.put(
  '/prayer-settings',
  [
    body('prayer_time').optional().matches(/^\d{2}:\d{2}$/).withMessage('prayer_time must be HH:MM format'),
    body('hour').optional().isInt({ min: 0, max: 23 }),
    body('minute').optional().isInt({ min: 0, max: 59 }),
    body('timezone').optional().isString().trim(),
    body('enabled').optional().isBoolean().withMessage('enabled must be a boolean'),
  ],
  validate,
  updateSettings
);

module.exports = router;
