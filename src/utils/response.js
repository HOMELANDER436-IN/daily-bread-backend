'use strict';

/**
 * Standard API response utilities for Daily Bread backend.
 */

/**
 * Send a success response
 * @param {object} res - Express response object
 * @param {*} data - Response data
 * @param {string} [message='Success'] - Success message
 * @param {number} [statusCode=200] - HTTP status code
 */
const success = (res, data, message = 'Success', statusCode = 200) => {
  return res.status(statusCode).json({
    success: true,
    message,
    data,
  });
};

/**
 * Send an error response
 * @param {object} res - Express response object
 * @param {string} [message='An error occurred'] - Error message
 * @param {number} [statusCode=500] - HTTP status code
 * @param {Array|null} [errors=null] - Validation errors array
 */
const error = (res, message = 'An error occurred', statusCode = 500, errors = null) => {
  const payload = { success: false, message };
  if (errors) payload.errors = errors;
  return res.status(statusCode).json(payload);
};

// Aliases used across controllers
const ok = (res, data, message = 'Success', statusCode = 200) => {
  return success(res, data, message, statusCode);
};

const fail = (res, message = 'Bad request', statusCode = 400, errors = null) => {
  return error(res, message, statusCode, errors);
};

const serverError = (res, message = 'Internal server error') => {
  return error(res, message, 500);
};

module.exports = {
  success,
  error,
  ok,
  fail,
  serverError,
};
