'use strict';

const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const { register, deactivate } = require('../controllers/devicesController');
const validate = require('../middleware/validate');

router.post(
  '/register',
  (req, res, next) => {
    if (!req.body.device_id && req.body.deviceId) req.body.device_id = req.body.deviceId;
    if (!req.body.fcm_token && req.body.token) req.body.fcm_token = req.body.token;
    next();
  },
  [
    body('device_id').notEmpty().isString().trim().withMessage('deviceId or device_id is required'),
    body('fcm_token').notEmpty().isString().trim().withMessage('token or fcm_token is required'),
    body('platform').optional().isIn(['web', 'android', 'ios']),
    body('language').optional().isIn(['en', 'ml']),
  ],
  validate,
  register
);

router.delete('/:deviceId', deactivate);

module.exports = router;
