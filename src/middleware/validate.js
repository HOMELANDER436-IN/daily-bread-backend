'use strict';

const { validationResult } = require('express-validator');
const { error } = require('../utils/response');

/**
 * Middleware to handle express-validator validation results.
 * Returns 400 with error details if validation fails.
 */
const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return error(res, 'Validation failed', 400, errors.array());
  }
  next();
};

module.exports = validate;
