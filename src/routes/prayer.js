'use strict';

const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const { getCurrent, getSettings, updateSettings } = require('../controllers/prayerController');
const auth = require('../middleware/auth');
const validate = require('../middleware/validate');

// Public: get active prayer event
router.get('/current', getCurrent);

// Admin: get prayer settings
router.get('/admin/settings', auth, getSettings);

// Admin: update prayer settings
router.put(
  '/admin/settings',
  auth,
  [
    body('prayer_time')
      .optional()
      .matches(/^\d{2}:\d{2}$/)
      .withMessage('prayer_time must be in HH:MM format'),
    body('timezone').optional().isString().trim(),
    body('enabled').optional().isBoolean().withMessage('enabled must be a boolean'),
  ],
  validate,
  updateSettings
);

module.exports = router;
