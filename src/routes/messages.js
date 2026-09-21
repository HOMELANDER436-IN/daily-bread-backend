'use strict';

const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const {
  getLatest, getPublished,
  adminGetAll, adminGetOne, create, update, deleteMessage, togglePublish,
} = require('../controllers/messagesController');
const auth = require('../middleware/auth');
const validate = require('../middleware/validate');

const messageBodyValidators = [
  body('content').notEmpty().trim().isLength({ max: 10000 }).withMessage('Content is required and must be under 10,000 characters'),
  body('title').optional({ nullable: true }).trim().isLength({ max: 200 }),
  body('reference').optional({ nullable: true }).trim().isLength({ max: 200 }),
  body('image_url').optional({ nullable: true }).trim(),
  body('language').optional().isIn(['en', 'ml']).withMessage('Language must be "en" or "ml"'),
];

// Public routes
router.get('/latest', getLatest);
router.get('/', getPublished);

// Admin routes
router.get('/admin', auth, adminGetAll);
router.get('/admin/:id', auth, adminGetOne);
router.post('/admin', auth, messageBodyValidators, validate, create);
router.put('/admin/:id', auth, messageBodyValidators, validate, update);
router.delete('/admin/:id', auth, deleteMessage);
router.patch(
  '/admin/:id/publish',
  auth,
  [body('is_published').isBoolean().withMessage('is_published must be boolean')],
  validate,
  togglePublish
);

module.exports = router;
