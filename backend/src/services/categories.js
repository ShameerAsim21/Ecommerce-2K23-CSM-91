'use strict';
const db = require('../db');
const { notFound, conflict, unprocessable } = require('../errors');

const COLUMNS = 'id, parent_id, name, slug, description, is_active, created_at, updated_at';

async function listTree() {
  const { rows } = await db.query(
    `SELECT c.id, c.parent_id, c.name, c.slug, c.description, c.is_active, c.created_at, c.updated_at,
            (SELECT count(*) FROM products p WHERE p.category_id = c.id)::int AS product_count
       FROM categories c
      ORDER BY c.name, c.id`
  );
  const byId = new Map(rows.map((r) => [r.id, { ...r, children: [] }]));
  const roots = [];
  for (const node of byId.values()) {
    const parent = node.parent_id ? byId.get(node.parent_id) : null;
    (parent ? parent.children : roots).push(node);
  }
  return roots;
}

async function getById(id, client = db) {
  const { rows } = await client.query(`SELECT ${COLUMNS} FROM categories WHERE id = $1`, [id]);
  if (rows.length === 0) throw notFound('Category');
  return rows[0];
}

async function assertActiveParent(client, parentId) {
  const { rows } = await client.query('SELECT is_active FROM categories WHERE id = $1', [parentId]);
  if (rows.length === 0) {
    throw unprocessable('PARENT_NOT_FOUND', 'Parent category does not exist', [
      { field: 'parent_id', message: 'no category with this id' },
    ]);
  }
  if (!rows[0].is_active) {
    throw conflict('PARENT_INACTIVE', 'Parent category is inactive', [
      { field: 'parent_id', message: 'an active category cannot sit under an inactive parent' },
    ]);
  }
}

async function create(input) {
  if (input.parent_id) await assertActiveParent(db, input.parent_id);
  const { rows } = await db.query(
    `INSERT INTO categories (parent_id, name, slug, description, is_active)
     VALUES ($1, $2, $3, $4, $5) RETURNING ${COLUMNS}`,
    [input.parent_id ?? null, input.name, input.slug, input.description ?? null, input.is_active ?? true]
  );
  return rows[0];
}

/**
 * Update a category. Deactivating a category also deactivates every descendant in the same
 * transaction (business rule 3); reactivation is never cascaded downwards.
 */
async function update(id, input) {
  return db.withTransaction(async (client) => {
    const { rows: found } = await client.query(
      `SELECT ${COLUMNS} FROM categories WHERE id = $1 FOR UPDATE`, [id]
    );
    if (found.length === 0) throw notFound('Category');
    const current = found[0];

    const nextParent = 'parent_id' in input ? input.parent_id : current.parent_id;
    const nextActive = 'is_active' in input ? input.is_active : current.is_active;

    if (nextActive && nextParent && (nextParent !== current.parent_id || !current.is_active)) {
      await assertActiveParent(client, nextParent);
    }

    const sets = [];
    const values = [];
    for (const key of ['name', 'slug', 'description', 'parent_id', 'is_active']) {
      if (key in input) {
        values.push(input[key]);
        sets.push(`${key} = $${values.length}`);
      }
    }
    values.push(id);
    const { rows } = await client.query(
      `UPDATE categories SET ${sets.join(', ')} WHERE id = $${values.length} RETURNING ${COLUMNS}`, values
    );

    let deactivatedDescendants = 0;
    if (current.is_active && nextActive === false) {
      const res = await client.query(
        `WITH RECURSIVE tree AS (
           SELECT id FROM categories WHERE parent_id = $1
           UNION ALL
           SELECT c.id FROM categories c JOIN tree t ON c.parent_id = t.id
         )
         UPDATE categories SET is_active = FALSE
          WHERE id IN (SELECT id FROM tree) AND is_active`,
        [id]
      );
      deactivatedDescendants = res.rowCount;
    }
    return { ...rows[0], deactivated_descendants: deactivatedDescendants };
  });
}

async function remove(id) {
  const { rowCount } = await db.query('DELETE FROM categories WHERE id = $1', [id]);
  if (rowCount === 0) throw notFound('Category');
}

module.exports = { listTree, getById, create, update, remove };
