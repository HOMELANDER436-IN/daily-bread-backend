'use strict';

const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const { getCurrent, getSettings, updateSettings } = require('../controllers/prayerController');
const validate = require('../middleware/validate');

// Public: get active prayer event (within 2-hour window)
router.get('/current', getCurrent);

// Admin: get prayer settings (no auth required)
router.get('/admin/settings', getSettings);
router.get('/admin/prayer-settings', getSettings);

// Admin: update prayer settings
const prayerValidators = [
  body('prayer_time')
    .optional()
    .matches(/^\d{2}:\d{2}$/)
    .withMessage('prayer_time must be in HH:MM format'),
  body('hour').optional().isInt({ min: 0, max: 23 }),
  body('minute').optional().isInt({ min: 0, max: 59 }),
  body('timezone').optional().isString().trim(),
  body('enabled').optional().isBoolean().withMessage('enabled must be a boolean'),
];

router.put('/admin/settings', prayerValidators, validate, updateSettings);
router.put('/admin/prayer-settings', prayerValidators, validate, updateSettings);

module.exports = router;
