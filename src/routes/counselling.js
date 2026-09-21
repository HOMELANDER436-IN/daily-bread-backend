'use strict';

const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const { submit, adminList, adminCounts, adminGetOne, markViewed } = require('../controllers/counsellingController');
const auth = require('../middleware/auth');
const validate = require('../middleware/validate');
const { counsellingLimiter } = require('../middleware/rateLimiter');

// Public: submit a counselling request
router.post(
  '/',
  counsellingLimiter,
  [
    body('full_name')
      .notEmpty().trim()
      .isLength({ min: 2, max: 100 })
      .withMessage('Full name is required (2–100 characters)'),
    body('contact_number')
      .notEmpty().trim()
      .isLength({ min: 6, max: 20 })
      .withMessage('Valid contact number is required'),
    body('comment')
      .optional({ nullable: true })
      .trim()
      .isLength({ max: 2000 })
      .withMessage('Comment must be under 2000 characters'),
  ],
  validate,
  submit
);

// Admin: list with filter
router.get('/admin', auth, adminList);

// Admin: counts summary
router.get('/admin/counts', auth, adminCounts);

// Admin: single request detail
router.get('/admin/:id', auth, adminGetOne);

// Admin: mark as viewed
router.patch('/admin/:id/viewed', auth, markViewed);

module.exports = router;
