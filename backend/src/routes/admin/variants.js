'use strict';
const express = require('express');
const variants = require('../../services/variants');
const { idParam, asyncHandler } = require('../../middleware/validate');

const router = express.Router();

router.delete('/:id', asyncHandler(async (req, res) => {
  await variants.remove(idParam(req));
  res.status(204).end();
}));

module.exports = router;
