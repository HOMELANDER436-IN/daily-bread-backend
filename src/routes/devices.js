'use strict';

const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const { register, deactivate } = require('../controllers/devicesController');
const validate = require('../middleware/validate');

router.post(
  '/register',
  [
    body('device_id').notEmpty().isString().trim().withMessage('device_id is required'),
    body('fcm_token').notEmpty().isString().trim().withMessage('fcm_token is required'),
    body('platform').optional().isIn(['web', 'android', 'ios']),
    body('language').optional().isIn(['en', 'ml']),
  ],
  validate,
  register
);

router.delete('/:deviceId', deactivate);

module.exports = router;
