'use strict';
const express = require('express');
const categories = require('../../services/categories');
const { validateBody, idParam, asyncHandler } = require('../../middleware/validate');
const { categoryCreate, categoryUpdate } = require('../../schemas');

const router = express.Router();

router.get('/', asyncHandler(async (req, res) => {
  res.json({ data: await categories.listTree() });
}));

router.post('/', validateBody(categoryCreate), asyncHandler(async (req, res) => {
  const category = await categories.create(req.body);
  res.status(201).location(`/api/v1/admin/categories/${category.id}`).json({ data: category });
}));

router.patch('/:id', validateBody(categoryUpdate), asyncHandler(async (req, res) => {
  res.json({ data: await categories.update(idParam(req), req.body) });
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  await categories.remove(idParam(req));
  res.status(204).end();
}));

module.exports = router;
