'use strict';
const jwt = require('jsonwebtoken');
const config = require('../config');
const db = require('../db');
const { unauthorized, forbidden } = require('../errors');
const { asyncHandler } = require('./validate');

function signToken(user) {
  return jwt.sign({ role: user.role }, config.jwtSecret, {
    subject: String(user.id),
    algorithm: 'HS256',
    expiresIn: config.jwtExpiresIn,
  });
}

/** Verify the Bearer token and load the CURRENT user row (so demoted/deleted users lose access). */
const authenticate = asyncHandler(async (req, res, next) => {
  const header = req.get('Authorization') || '';
  const match = /^Bearer (.+)$/.exec(header);
  if (!match) throw unauthorized('Missing or malformed Authorization header');

  let payload;
  try {
    payload = jwt.verify(match[1], config.jwtSecret, { algorithms: ['HS256'] });
  } catch (err) {
    throw unauthorized(err.name === 'TokenExpiredError' ? 'Token has expired' : 'Invalid token');
  }
  const userId = Number(payload.sub);
  if (!Number.isInteger(userId)) throw unauthorized('Invalid token');

  const { rows } = await db.query('SELECT id, email, role FROM users WHERE id = $1', [userId]);
  if (rows.length === 0) throw unauthorized('Account no longer exists');
  req.user = rows[0];
  next();
});

function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') return next(forbidden());
  return next();
}

module.exports = { signToken, authenticate, requireAdmin };
