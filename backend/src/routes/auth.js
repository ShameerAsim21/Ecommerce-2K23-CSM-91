'use strict';
const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const config = require('../config');
const { unauthorized } = require('../errors');
const { signToken } = require('../middleware/auth');
const { validateBody, asyncHandler } = require('../middleware/validate');
const { loginBody } = require('../schemas');

const router = express.Router();

// Compared against when the email is unknown, so response time does not reveal which emails exist.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', config.bcryptRounds);

router.post('/login', validateBody(loginBody), asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  const { rows } = await db.query('SELECT id, full_name, email, password_hash, role FROM users WHERE email = $1', [email]);
  const user = rows[0];
  const ok = await bcrypt.compare(password, user ? user.password_hash : DUMMY_HASH);
  if (!user || !ok) throw unauthorized('Invalid email or password');
  res.json({
    token: signToken(user),
    token_type: 'Bearer',
    user: { id: user.id, full_name: user.full_name, email: user.email, role: user.role },
  });
}));

module.exports = router;
