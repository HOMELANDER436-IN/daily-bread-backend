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
  deleteAll: deleteAllMessages,
  togglePublish,
} = require('../controllers/messagesController');

const {
  adminList,
  adminCounts,
  adminGetOne: adminGetOneCounselling,
  markViewed,
  deleteOne: deleteCounsellingOne,
  deleteAll: deleteAllCounselling,
} = require('../controllers/counsellingController');

const {
  getSettings,
  updateSettings,
  listSchedules,
  getSchedule,
  createSchedule,
  updateSchedule,
  deleteSchedule,
  toggleSchedule,
} = require('../controllers/prayerController');

// ─── Messages Admin APIs ──────────────────────────────────────
const messageBodyValidators = [
  body('content').notEmpty().trim().isLength({ max: 10000 }).withMessage('Content is required and must be under 10,000 characters'),
  body('title').optional({ nullable: true }).trim().isLength({ max: 200 }),
  body('reference').optional({ nullable: true }).trim().isLength({ max: 200 }),
  body('language').optional().isIn(['en', 'ml']).withMessage('Language must be "en" or "ml"'),
];

router.get('/messages', adminGetAll);
router.get('/messages/:id', adminGetOne);
router.post('/messages', messageBodyValidators, validate, create);
router.put('/messages/:id', messageBodyValidators, validate, update);
// NOTE: /messages/all MUST be before /messages/:id
router.delete('/messages/all', deleteAllMessages);
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

// NOTE: /counselling/all and /counselling/counts MUST be before /counselling/:id
router.get('/counselling', adminList);
router.get('/counselling/counts', adminCounts);
router.delete('/counselling/all', deleteAllCounselling);
router.get('/counselling/:id', adminGetOneCounselling);
router.patch('/counselling/:id/viewed', markViewed);
router.delete('/counselling/:id', deleteCounsellingOne);

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

// ─── Multiple Prayer Schedules Admin APIs ──────────────────────
router.get('/prayer-schedules', listSchedules);
router.post(
  '/prayer-schedules',
  [
    body('type').isIn(['daily', 'weekly', 'once']).withMessage('type must be daily, weekly, or once'),
    body('time').matches(/^\d{2}:\d{2}$/).withMessage('time must be HH:MM format'),
    body('enabled').optional().isBoolean(),
  ],
  validate,
  createSchedule
);
router.get('/prayer-schedules/:id', getSchedule);
router.put(
  '/prayer-schedules/:id',
  [
    body('type').optional().isIn(['daily', 'weekly', 'once']),
    body('time').optional().matches(/^\d{2}:\d{2}$/),
    body('enabled').optional().isBoolean(),
  ],
  validate,
  updateSchedule
);
router.patch('/prayer-schedules/:id/toggle', toggleSchedule);
router.delete('/prayer-schedules/:id', deleteSchedule);

module.exports = router;
