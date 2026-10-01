'use strict';
const { z } = require('zod');

const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const SKU_CODE_RE = /^[A-Z0-9]+(-[A-Z0-9]+)*$/;
const MONEY_RE = /^\d{1,8}(\.\d{1,2})?$/;

const slug = (max) =>
  z.string({ required_error: 'is required' }).trim().min(1, 'is required').max(max)
    .regex(SLUG_RE, 'must be lowercase letters and digits separated by single hyphens');

const shortText = (max) => z.string({ required_error: 'is required' }).trim().min(1, 'must not be blank').max(max);

// Money is accepted as a decimal string or a JSON number, converted to a string and checked
// against a strict 2-decimal pattern. It is never held as a floating-point value.
const money = z
  .union([z.string(), z.number()], { required_error: 'is required', invalid_type_error: 'must be a decimal amount' })
  .transform((v) => String(v).trim())
  .refine((v) => MONEY_RE.test(v), 'must be a decimal with at most 2 decimal places (e.g. "19.99")')
  .refine((v) => Number(v) > 0, 'must be greater than 0');

const stockQuantity = z
  .number({ invalid_type_error: 'must be an integer', required_error: 'is required' })
  .int('must be an integer').min(0, 'must be >= 0').max(1_000_000, 'must be <= 1000000');

const positiveId = z.number({ invalid_type_error: 'must be an integer' }).int().positive();

const optionMap = z
  .record(z.string().trim().min(1).max(60), z.string().trim().min(1, 'must not be blank').max(60))
  .refine((o) => Object.keys(o).length >= 1 && Object.keys(o).length <= 3, 'must contain 1 to 3 options');

const atLeastOneKey = (obj) => Object.keys(obj).length > 0;

// ------------------------------------------------------------------ auth
const loginBody = z.object({
  email: z.string({ required_error: 'is required' }).trim().toLowerCase().email().max(255),
  password: z.string({ required_error: 'is required' }).min(1).max(200),
}).strict();

// ------------------------------------------------------------ categories
const categoryCreate = z.object({
  name: shortText(120),
  slug: slug(140),
  description: z.string().trim().max(2000).nullish(),
  parent_id: positiveId.nullish(),
  is_active: z.boolean().optional(),
}).strict();

const categoryUpdate = z.object({
  name: shortText(120).optional(),
  slug: slug(140).optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  parent_id: positiveId.nullable().optional(),
  is_active: z.boolean().optional(),
}).strict().refine(atLeastOneKey, 'at least one field is required');

// -------------------------------------------------------------- products
// status is deliberately not accepted on create: new products are always drafts.
const productCreate = z.object({
  name: shortText(160),
  slug: slug(180),
  description: z.string().trim().max(10000).optional(),
  category_id: z.number({ required_error: 'is required', invalid_type_error: 'must be an integer' }).int().positive(),
}).strict();

const productUpdate = z.object({
  name: shortText(160).optional(),
  slug: slug(180).optional(),
  description: z.string().trim().max(10000).optional(),
  category_id: positiveId.optional(),
  status: z.enum(['draft', 'active', 'archived']).optional(),
}).strict().refine(atLeastOneKey, 'at least one field is required');

const productListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(['draft', 'active', 'archived']).optional(),
  category_id: z.coerce.number().int().positive().optional(),
  q: z.string().trim().min(1).max(100).optional(),
});

// -------------------------------------------------------------- variants
const variantCreate = z.object({ options: optionMap }).strict();

// ------------------------------------------------------------------ SKUs
const skuCreate = z.object({
  code: z.string({ required_error: 'is required' }).trim().toUpperCase().min(1, 'is required').max(64)
    .regex(SKU_CODE_RE, 'must contain only letters, digits and single hyphens (stored upper-case)'),
  price: money,
  stock_quantity: stockQuantity.default(0),
  is_active: z.boolean().default(true),
  variant_id: positiveId.optional(),
  options: optionMap.optional(),
}).strict().refine((v) => !(v.variant_id && v.options), {
  message: 'provide either variant_id or options, not both',
  path: ['options'],
});

// code is immutable after creation, so it is not accepted here (strict() rejects it).
const skuUpdate = z.object({
  price: money.optional(),
  stock_quantity: stockQuantity.optional(),
  stock_delta: z.number({ invalid_type_error: 'must be an integer' }).int().min(-1_000_000).max(1_000_000)
    .refine((n) => n !== 0, 'must not be 0').optional(),
  is_active: z.boolean().optional(),
}).strict()
  .refine(atLeastOneKey, 'at least one field is required')
  .refine((v) => !(v.stock_quantity !== undefined && v.stock_delta !== undefined), {
    message: 'provide either stock_quantity or stock_delta, not both',
    path: ['stock_delta'],
  });

module.exports = {
  loginBody, categoryCreate, categoryUpdate, productCreate, productUpdate, productListQuery,
  variantCreate, skuCreate, skuUpdate,
};
