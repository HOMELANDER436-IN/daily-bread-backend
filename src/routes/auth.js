'use strict';

const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const { login, refresh, logout } = require('../controllers/authController');
const auth = require('../middleware/auth');
const validate = require('../middleware/validate');
const { authLimiter } = require('../middleware/rateLimiter');

router.post(
  '/login',
  authLimiter,
  [
    body('email').isEmail().normalizeEmail().withMessage('Valid email required'),
    body('password').notEmpty().withMessage('Password required'),
  ],
  validate,
  login
);

router.post('/refresh', auth, refresh);
router.post('/logout', auth, logout);

module.exports = router;
