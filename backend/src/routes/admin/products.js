'use strict';
const express = require('express');
const products = require('../../services/products');
const skus = require('../../services/skus');
const variants = require('../../services/variants');
const { validateBody, validateQuery, idParam, asyncHandler } = require('../../middleware/validate');
const { productCreate, productUpdate, productListQuery, skuCreate, variantCreate } = require('../../schemas');

const router = express.Router();

router.get('/', validateQuery(productListQuery), asyncHandler(async (req, res) => {
  res.json(await products.list(req.query));
}));

router.post('/', validateBody(productCreate), asyncHandler(async (req, res) => {
  const product = await products.create(req.body);
  res.status(201).location(`/api/v1/admin/products/${product.id}`).json({ data: product });
}));

router.get('/:id', asyncHandler(async (req, res) => {
  res.json({ data: await products.getById(idParam(req)) });
}));

router.patch('/:id', validateBody(productUpdate), asyncHandler(async (req, res) => {
  res.json({ data: await products.update(idParam(req), req.body) });
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  await products.remove(idParam(req));
  res.status(204).end();
}));

router.post('/:id/variants', validateBody(variantCreate), asyncHandler(async (req, res) => {
  const variant = await variants.create(idParam(req), req.body);
  res.status(201).json({ data: variant });
}));

router.post('/:id/skus', validateBody(skuCreate), asyncHandler(async (req, res) => {
  const sku = await skus.create(idParam(req), req.body);
  res.status(201).location(`/api/v1/admin/skus/${sku.id}`).json({ data: sku });
}));

module.exports = router;
