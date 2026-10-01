'use strict';
const express = require('express');
const { authenticate, requireAdmin } = require('../../middleware/auth');

const router = express.Router();

// Every /api/v1/admin route requires a valid token (401) belonging to an administrator (403).
router.use(authenticate, requireAdmin);
router.use('/categories', require('./categories'));
router.use('/products', require('./products'));
router.use('/skus', require('./skus'));
router.use('/variants', require('./variants'));

module.exports = router;
