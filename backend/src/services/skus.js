'use strict';
const db = require('../db');
const { notFound, conflict, unprocessable } = require('../errors');
const variants = require('./variants');

const SKU_SELECT = `
  SELECT s.id, s.product_id, s.variant_id, v.label AS variant_label, s.code, s.price, s.stock_quantity,
         s.is_active, s.created_at, s.updated_at
    FROM skus s LEFT JOIN variants v ON v.id = s.variant_id`;

/** How the SKU is represented to readers (business rule 4). Stock counts stay admin-only. */
function availability(sku) {
  if (!sku.is_active) return 'inactive';
  return sku.stock_quantity > 0 ? 'in_stock' : 'out_of_stock';
}

function present(row) {
  return { ...row, price: String(row.price), availability: availability(row) };
}

async function getById(id, client = db) {
  const { rows } = await client.query(`${SKU_SELECT} WHERE s.id = $1`, [id]);
  if (rows.length === 0) throw notFound('SKU');
  return present(rows[0]);
}

async function listForProduct(productId, client = db) {
  const { rows } = await client.query(`${SKU_SELECT} WHERE s.product_id = $1 ORDER BY s.id`, [productId]);
  return rows.map(present);
}

async function create(productId, input) {
  return db.withTransaction(async (client) => {
    await variants.lockProduct(client, productId);

    let variantId = null;
    if (input.options) {
      const { variant, expected } = await variants.findByOptions(client, productId, input.options);
      if (!variant) {
        throw unprocessable('COMBINATION_NOT_AVAILABLE',
          'This option combination is not offered for the product; create the variant first', [
            { field: 'options', message: expected.length ? `product options: ${expected.join(', ')}` : 'product has no variants' },
          ]);
      }
      variantId = variant.id;
    } else if (input.variant_id) {
      const { rows } = await client.query('SELECT id FROM variants WHERE id = $1 AND product_id = $2', [input.variant_id, productId]);
      if (rows.length === 0) {
        throw unprocessable('VARIANT_NOT_FOUND', 'Variant does not belong to this product', [
          { field: 'variant_id', message: 'no such variant on this product' },
        ]);
      }
      variantId = rows[0].id;
    }

    const { rows } = await client.query(
      `INSERT INTO skus (product_id, variant_id, code, price, stock_quantity, is_active)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [productId, variantId, input.code, input.price, input.stock_quantity ?? 0, input.is_active ?? true]
    );
    return getById(rows[0].id, client);
  });
}

/** True when deactivating/removing this SKU would leave an ACTIVE product with nothing sellable. */
async function wouldStrandActiveProduct(client, sku) {
  const { rows } = await client.query('SELECT status FROM products WHERE id = $1', [sku.product_id]);
  if (rows[0].status !== 'active' || !sku.is_active) return false;
  const others = await client.query(
    'SELECT 1 FROM skus WHERE product_id = $1 AND id <> $2 AND is_active LIMIT 1', [sku.product_id, sku.id]
  );
  return others.rowCount === 0;
}

const lastSkuError = () => conflict('LAST_ACTIVE_SKU',
  'An active product needs at least one active SKU; archive the product first');

async function update(id, input) {
  return db.withTransaction(async (client) => {
    const { rows } = await client.query('SELECT * FROM skus WHERE id = $1 FOR UPDATE', [id]);
    if (rows.length === 0) throw notFound('SKU');
    const current = rows[0];

    if (input.is_active === false && (await wouldStrandActiveProduct(client, current))) throw lastSkuError();

    let newStock = current.stock_quantity;
    if (input.stock_quantity !== undefined) newStock = input.stock_quantity;
    if (input.stock_delta !== undefined) {
      newStock = current.stock_quantity + input.stock_delta;
      if (newStock < 0) {
        throw unprocessable('NEGATIVE_STOCK',
          `Adjustment of ${input.stock_delta} would make stock negative (current: ${current.stock_quantity})`, [
            { field: 'stock_delta', message: 'result would be < 0' },
          ]);
      }
    }
    await client.query(
      `UPDATE skus SET price = $1, stock_quantity = $2, is_active = $3 WHERE id = $4`,
      [input.price ?? current.price, newStock, input.is_active ?? current.is_active, id]
    );
    return getById(id, client);
  });
}

async function remove(id) {
  return db.withTransaction(async (client) => {
    const { rows } = await client.query('SELECT * FROM skus WHERE id = $1 FOR UPDATE', [id]);
    if (rows.length === 0) throw notFound('SKU');
    if (await wouldStrandActiveProduct(client, rows[0])) throw lastSkuError();
    await client.query('DELETE FROM skus WHERE id = $1', [id]);
  });
}

module.exports = { create, update, remove, getById, listForProduct, availability };
