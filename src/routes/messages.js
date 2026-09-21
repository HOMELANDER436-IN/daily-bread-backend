'use strict';

const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const {
  getLatest, getPublished,
  adminGetAll, adminGetOne, create, update, deleteMessage, togglePublish,
} = require('../controllers/messagesController');
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

// Admin routes (no auth required)
router.get('/admin', adminGetAll);
router.get('/admin/:id', adminGetOne);
router.post('/admin', messageBodyValidators, validate, create);
router.put('/admin/:id', messageBodyValidators, validate, update);
router.delete('/admin/:id', deleteMessage);
router.patch(
  '/admin/:id/publish',
  [body().custom(b => b.is_published !== undefined || b.isPublished !== undefined).withMessage('is_published or isPublished must be boolean')],
  validate,
  (req, res, next) => {
    if (req.body.is_published === undefined && req.body.isPublished !== undefined) {
      req.body.is_published = req.body.isPublished;
    }
    next();
  },
  togglePublish
);

module.exports = router;
