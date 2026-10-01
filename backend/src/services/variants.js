'use strict';
const db = require('../db');
const { notFound, unprocessable } = require('../errors');

/** Lock the product row for the rest of the transaction; serialises variant/SKU writes. */
async function lockProduct(client, productId) {
  const { rows } = await client.query('SELECT id, status FROM products WHERE id = $1 FOR UPDATE', [productId]);
  if (rows.length === 0) throw notFound('Product');
  return rows[0];
}

async function getOptions(client, productId) {
  const { rows } = await client.query(
    'SELECT id, name, position FROM product_options WHERE product_id = $1 ORDER BY position', [productId]
  );
  return rows;
}

function sameNames(existing, names) {
  return existing.length === names.length && existing.every((o) => names.includes(o.name));
}

const combinationKey = (pairs) => pairs.map((p) => `${p.optionId}:${p.valueId}`).join('|');

/**
 * Find the variant that matches an {optionName: value} map, or return null when the
 * combination is not offered. Never creates anything (CAT04).
 */
async function findByOptions(client, productId, options) {
  const existing = await getOptions(client, productId);
  const names = Object.keys(options);
  if (existing.length === 0 || !sameNames(existing, names)) return { variant: null, expected: existing.map((o) => o.name) };

  const pairs = [];
  for (const opt of existing) {
    const { rows } = await client.query(
      'SELECT id FROM option_values WHERE option_id = $1 AND value = $2', [opt.id, options[opt.name]]
    );
    if (rows.length === 0) return { variant: null, expected: existing.map((o) => o.name) };
    pairs.push({ optionId: opt.id, valueId: rows[0].id });
  }
  const { rows } = await client.query(
    'SELECT id FROM variants WHERE product_id = $1 AND combination_key = $2', [productId, combinationKey(pairs)]
  );
  return { variant: rows[0] || null, expected: existing.map((o) => o.name) };
}

async function format(client, variantId) {
  const { rows } = await client.query(
    `SELECT v.id, v.product_id, v.label, v.created_at,
            (SELECT json_object_agg(po.name, ov.value ORDER BY po.position)
               FROM variant_option_values vov
               JOIN product_options po ON po.id = vov.option_id
               JOIN option_values ov ON ov.id = vov.option_value_id
              WHERE vov.variant_id = v.id) AS options
       FROM variants v WHERE v.id = $1`, [variantId]
  );
  return rows[0];
}

async function create(productId, input) {
  return db.withTransaction(async (client) => {
    await lockProduct(client, productId);
    let existing = await getOptions(client, productId);
    const names = Object.keys(input.options);

    if (existing.length === 0) {
      // First variant defines the option axes of the product.
      for (let i = 0; i < names.length; i += 1) {
        await client.query(
          'INSERT INTO product_options (product_id, name, position) VALUES ($1, $2, $3)', [productId, names[i], i + 1]
        );
      }
      existing = await getOptions(client, productId);
    } else if (!sameNames(existing, names)) {
      throw unprocessable('OPTION_SET_MISMATCH', 'Variant must use exactly the product\'s option names', [
        { field: 'options', message: `expected options: ${existing.map((o) => o.name).join(', ')}` },
      ]);
    }

    const pairs = [];
    const labelParts = [];
    for (const opt of existing) {
      const value = input.options[opt.name];
      await client.query(
        'INSERT INTO option_values (option_id, value) VALUES ($1, $2) ON CONFLICT (option_id, value) DO NOTHING',
        [opt.id, value]
      );
      const { rows } = await client.query('SELECT id FROM option_values WHERE option_id = $1 AND value = $2', [opt.id, value]);
      pairs.push({ optionId: opt.id, valueId: rows[0].id });
      labelParts.push(value);
    }

    const { rows } = await client.query(
      'INSERT INTO variants (product_id, label, combination_key) VALUES ($1, $2, $3) RETURNING id',
      [productId, labelParts.join(' / '), combinationKey(pairs)]
    );
    const variantId = rows[0].id;
    for (const p of pairs) {
      await client.query(
        'INSERT INTO variant_option_values (variant_id, product_id, option_id, option_value_id) VALUES ($1, $2, $3, $4)',
        [variantId, productId, p.optionId, p.valueId]
      );
    }
    return format(client, variantId);
  });
}

async function remove(variantId) {
  return db.withTransaction(async (client) => {
    const { rows } = await client.query('SELECT product_id FROM variants WHERE id = $1', [variantId]);
    if (rows.length === 0) throw notFound('Variant');
    const productId = rows[0].product_id;
    await lockProduct(client, productId);
    await client.query('DELETE FROM variants WHERE id = $1', [variantId]);
    // When the last variant goes, forget the option axes so the product can be re-modelled.
    const left = await client.query('SELECT 1 FROM variants WHERE product_id = $1 LIMIT 1', [productId]);
    if (left.rowCount === 0) await client.query('DELETE FROM product_options WHERE product_id = $1', [productId]);
  });
}

module.exports = { create, remove, findByOptions, lockProduct };
