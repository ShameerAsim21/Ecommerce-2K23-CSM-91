'use strict';
const db = require('../db');
const { notFound, conflict, unprocessable } = require('../errors');
const skus = require('./skus');
const variants = require('./variants');

const PRODUCT_COLUMNS = 'id, category_id, name, slug, description, status, specifications, created_at, updated_at';

async function assertAssignableCategory(client, categoryId) {
  const { rows } = await client.query('SELECT is_active FROM categories WHERE id = $1', [categoryId]);
  if (rows.length === 0) {
    throw unprocessable('CATEGORY_NOT_FOUND', 'Category does not exist', [
      { field: 'category_id', message: 'no category with this id' },
    ]);
  }
  if (!rows[0].is_active) {
    throw conflict('CATEGORY_INACTIVE', 'Products cannot be assigned to an inactive category', [
      { field: 'category_id', message: 'category is inactive' },
    ]);
  }
}

async function getById(id, client = db) {
  const { rows } = await client.query(
    `SELECT p.id, p.category_id, p.name, p.slug, p.description, p.status, p.specifications,
            p.created_at, p.updated_at,
            json_build_object('id', c.id, 'name', c.name, 'slug', c.slug, 'is_active', c.is_active) AS category
       FROM products p JOIN categories c ON c.id = p.category_id
      WHERE p.id = $1`, [id]
  );
  if (rows.length === 0) throw notFound('Product');
  const product = rows[0];

  const opts = await client.query(
    `SELECT po.name, COALESCE(json_agg(ov.value ORDER BY ov.id) FILTER (WHERE ov.id IS NOT NULL), '[]') AS values
       FROM product_options po LEFT JOIN option_values ov ON ov.option_id = po.id
      WHERE po.product_id = $1 GROUP BY po.id ORDER BY po.position`, [id]
  );
  const vars = await client.query(
    `SELECT v.id, v.label,
            (SELECT json_object_agg(po.name, ov.value ORDER BY po.position)
               FROM variant_option_values vov
               JOIN product_options po ON po.id = vov.option_id
               JOIN option_values ov ON ov.id = vov.option_value_id
              WHERE vov.variant_id = v.id) AS options
       FROM variants v WHERE v.product_id = $1 ORDER BY v.id`, [id]
  );
  product.options = opts.rows;
  product.variants = vars.rows;
  product.skus = await skus.listForProduct(id, client);
  return product;
}

async function list({ page, page_size: pageSize, status, category_id: categoryId, q }) {
  const where = [];
  const params = [];
  if (status) { params.push(status); where.push(`p.status = $${params.length}`); }
  if (categoryId) { params.push(categoryId); where.push(`p.category_id = $${params.length}`); }
  if (q) { params.push(`%${q.replace(/[\\%_]/g, '\\$&')}%`); where.push(`(p.name ILIKE $${params.length} OR p.slug ILIKE $${params.length})`); }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const total = (await db.query(`SELECT count(*)::int AS n FROM products p ${whereSql}`, params)).rows[0].n;
  params.push(pageSize, (page - 1) * pageSize);
  const { rows } = await db.query(
    `SELECT p.id, p.name, p.slug, p.status, p.category_id, c.name AS category_name, c.slug AS category_slug,
            (SELECT count(*) FROM variants v WHERE v.product_id = p.id)::int AS variant_count,
            (SELECT count(*) FROM skus s WHERE s.product_id = p.id)::int AS sku_count,
            (SELECT count(*) FROM skus s WHERE s.product_id = p.id AND s.is_active AND s.stock_quantity > 0)::int AS in_stock_sku_count,
            (SELECT min(price) FROM skus s WHERE s.product_id = p.id AND s.is_active) AS min_price,
            (SELECT max(price) FROM skus s WHERE s.product_id = p.id AND s.is_active) AS max_price,
            p.created_at, p.updated_at
       FROM products p JOIN categories c ON c.id = p.category_id
       ${whereSql}
      ORDER BY p.id
      LIMIT $${params.length - 1} OFFSET $${params.length}`, params
  );
  return {
    data: rows.map((r) => ({
      ...r,
      min_price: r.min_price === null ? null : String(r.min_price),
      max_price: r.max_price === null ? null : String(r.max_price),
    })),
    meta: { page, page_size: pageSize, total },
  };
}

async function create(input) {
  return db.withTransaction(async (client) => {
    await assertAssignableCategory(client, input.category_id);
    const { rows } = await client.query(
      `INSERT INTO products (category_id, name, slug, description, status)
       VALUES ($1, $2, $3, $4, 'draft') RETURNING id`,
      [input.category_id, input.name, input.slug, input.description ?? '']
    );
    return getById(rows[0].id, client);
  });
}

async function update(id, input) {
  return db.withTransaction(async (client) => {
    await variants.lockProduct(client, id);
    if (input.category_id !== undefined) await assertAssignableCategory(client, input.category_id);

    if (input.status === 'active') {
      const { rowCount } = await client.query('SELECT 1 FROM skus WHERE product_id = $1 AND is_active LIMIT 1', [id]);
      if (rowCount === 0) {
        throw conflict('NO_ACTIVE_SKU', 'A product needs at least one active SKU before it can be set to active', [
          { field: 'status', message: 'add an active SKU first' },
        ]);
      }
    }

    const sets = [];
    const values = [];
    for (const key of ['name', 'slug', 'description', 'category_id', 'status']) {
      if (key in input) {
        values.push(input[key]);
        sets.push(`${key} = $${values.length}`);
      }
    }
    values.push(id);
    await client.query(`UPDATE products SET ${sets.join(', ')} WHERE id = $${values.length}`, values);
    return getById(id, client);
  });
}

async function remove(id) {
  return db.withTransaction(async (client) => {
    const product = await variants.lockProduct(client, id);
    if (product.status === 'active') {
      throw conflict('PRODUCT_ACTIVE', 'Active products cannot be deleted; archive the product first');
    }
    await client.query('DELETE FROM products WHERE id = $1', [id]);
  });
}

module.exports = { getById, list, create, update, remove, PRODUCT_COLUMNS };
