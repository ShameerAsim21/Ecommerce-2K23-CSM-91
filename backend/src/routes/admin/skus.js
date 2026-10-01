'use strict';
const express = require('express');
const skus = require('../../services/skus');
const { validateBody, idParam, asyncHandler } = require('../../middleware/validate');
const { skuUpdate } = require('../../schemas');

const router = express.Router();

router.get('/:id', asyncHandler(async (req, res) => {
  res.json({ data: await skus.getById(idParam(req)) });
}));

router.patch('/:id', validateBody(skuUpdate), asyncHandler(async (req, res) => {
  res.json({ data: await skus.update(idParam(req), req.body) });
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  await skus.remove(idParam(req));
  res.status(204).end();
}));

module.exports = router;
