'use strict';
const { unprocessable, badRequest } = require('../errors');

/** Validate req.body with a zod schema; on success req.body is replaced by the parsed value. */
function validateBody(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body === undefined ? {} : req.body);
    if (!result.success) {
      const details = result.error.issues.map((issue) => ({
        field: issue.path.join('.') || '(body)',
        message: issue.message,
      }));
      return next(unprocessable('VALIDATION_ERROR', 'Request validation failed', details));
    }
    req.body = result.data;
    return next();
  };
}

function validateQuery(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      const details = result.error.issues.map((issue) => ({
        field: issue.path.join('.') || '(query)',
        message: issue.message,
      }));
      return next(unprocessable('VALIDATION_ERROR', 'Query validation failed', details));
    }
    req.query = result.data;
    return next();
  };
}

/** Parse a positive integer route parameter. */
function idParam(req, name = 'id') {
  const raw = req.params[name];
  if (!/^[1-9]\d{0,9}$/.test(raw) || Number(raw) > 2147483647) {
    throw badRequest('INVALID_ID', `Route parameter "${name}" must be a positive integer`);
  }
  return Number(raw);
}

const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

module.exports = { validateBody, validateQuery, idParam, asyncHandler };
