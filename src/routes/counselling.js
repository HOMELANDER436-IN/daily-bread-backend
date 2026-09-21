'use strict';

const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const { submit, adminList, adminCounts, adminGetOne, markViewed } = require('../controllers/counsellingController');
const validate = require('../middleware/validate');
const { counsellingLimiter } = require('../middleware/rateLimiter');

// Public: submit a counselling request (Accepts fullName or full_name, contactNumber or contact_number)
router.post(
  '/',
  counsellingLimiter,
  (req, res, next) => {
    if (!req.body.full_name && req.body.fullName) req.body.full_name = req.body.fullName;
    if (!req.body.contact_number && req.body.contactNumber) req.body.contact_number = req.body.contactNumber;
    next();
  },
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

// Admin: list with filter (no auth required)
router.get('/admin', adminList);

// Admin: counts summary
router.get('/admin/counts', adminCounts);

// Admin: single request detail
router.get('/admin/:id', adminGetOne);

// Admin: mark as viewed
router.patch('/admin/:id/viewed', markViewed);

module.exports = router;
