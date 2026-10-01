'use strict';

/** Error that maps directly onto an HTTP response with the project's consistent shape. */
class AppError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const badRequest = (code, message, details) => new AppError(400, code, message, details);
const unauthorized = (message = 'Authentication required') => new AppError(401, 'UNAUTHENTICATED', message);
const forbidden = (message = 'Administrator access required') => new AppError(403, 'FORBIDDEN', message);
const notFound = (what) => new AppError(404, 'NOT_FOUND', `${what} not found`);
const conflict = (code, message, details) => new AppError(409, code, message, details);
const unprocessable = (code, message, details) => new AppError(422, code, message, details);

// Constraint name -> friendly client error. The database stays the source of truth (CAT05);
// this table only translates its rejections into readable 4xx responses.
const UNIQUE_MESSAGES = {
  categories_slug_key: ['DUPLICATE_SLUG', 'slug', 'A category with this slug already exists'],
  products_slug_key: ['DUPLICATE_SLUG', 'slug', 'A product with this slug already exists'],
  skus_code_key: ['DUPLICATE_SKU_CODE', 'code', 'A SKU with this code already exists'],
  variants_combination_key: ['DUPLICATE_VARIANT', 'options', 'This option combination already exists for the product'],
  users_email_key: ['DUPLICATE_EMAIL', 'email', 'This email is already registered'],
};

const IN_USE_MESSAGES = {
  categories_parent_fk: 'Category still has child categories; move or delete them first',
  products_category_fk: 'Category still has products; reassign or delete them first',
  skus_variant_fk: 'Variant still has SKUs; delete or reassign the SKUs first',
  cart_items_sku_fk: 'A SKU of this product is in a cart; deactivate or archive instead of deleting',
  order_items_sku_fk: 'A SKU of this product appears on an order; deactivate or archive instead of deleting',
  vov_value_fk: 'Option value is still used by a variant',
};

/** Translate a pg / trigger error into an AppError, or return null if it is not one we know. */
function fromDatabaseError(err) {
  switch (err.code) {
    case '23505': {
      const known = UNIQUE_MESSAGES[err.constraint];
      if (known) {
        return conflict(known[0], known[2], [{ field: known[1], message: known[2] }]);
      }
      return conflict('DUPLICATE_VALUE', 'A record with the same unique value already exists', [
        { field: err.constraint || 'unknown', message: 'duplicate value' },
      ]);
    }
    case '23503': {
      // Deleting a referenced row vs. inserting a row that points at nothing.
      if (err.detail && /is still referenced/.test(err.detail)) {
        return conflict('IN_USE', IN_USE_MESSAGES[err.constraint] || 'Record is still referenced by other records');
      }
      return unprocessable('REFERENCE_NOT_FOUND', 'A referenced record does not exist', [
        { field: err.constraint || 'unknown', message: 'referenced record does not exist' },
      ]);
    }
    case '23514': {
      if (err.constraint === 'skus_stock_nonneg_chk') {
        return unprocessable('NEGATIVE_STOCK', 'Stock quantity cannot be negative', [
          { field: 'stock_quantity', message: 'must be >= 0' },
        ]);
      }
      return unprocessable('CONSTRAINT_VIOLATION', `Value rejected by database constraint ${err.constraint}`, [
        { field: err.constraint || 'unknown', message: 'violates a database check constraint' },
      ]);
    }
    case 'RS001':
      return unprocessable('CATEGORY_CYCLE', 'A category cannot be its own ancestor', [
        { field: 'parent_id', message: 'would create a cycle in the category tree' },
      ]);
    case 'RS002':
      return unprocessable('VARIANT_REQUIRED', 'This product has variants; the SKU must reference one', [
        { field: 'variant_id', message: 'required for products that have variants' },
      ]);
    case 'RS003':
      return conflict('PRODUCT_HAS_SIMPLE_SKU', 'This product already has variant-less SKUs; it cannot also have variants');
    case '22P02':
    case '22003':
      return unprocessable('INVALID_VALUE', 'A value has an invalid format or is out of range');
    default:
      return null;
  }
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  let appError = err instanceof AppError ? err : null;
  if (!appError && err.type === 'entity.parse.failed') {
    appError = badRequest('INVALID_JSON', 'Request body is not valid JSON');
  }
  if (!appError && err.type === 'entity.too.large') {
    appError = new AppError(413, 'PAYLOAD_TOO_LARGE', 'Request body is too large');
  }
  if (!appError) appError = fromDatabaseError(err);
  if (!appError) {
    // Unknown failure: log server-side, never leak a stack trace to the client.
    console.error('Unhandled error:', err);
    appError = new AppError(500, 'INTERNAL_ERROR', 'Unexpected server error');
  }
  const body = { error: { code: appError.code, message: appError.message } };
  if (appError.details) body.error.details = appError.details;
  res.status(appError.status).json(body);
}

module.exports = {
  AppError, badRequest, unauthorized, forbidden, notFound, conflict, unprocessable,
  fromDatabaseError, errorHandler,
};
