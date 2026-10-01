'use strict';
// Model / constraint tests: these bypass the API and talk to PostgreSQL directly, proving that
// integrity is enforced by the DATABASE and does not depend on API validation (CAT05).
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { db, resetDatabase } = require('./helpers');

/** Assert that a query is rejected with the given SQLSTATE (and optionally constraint name). */
async function rejects(promise, code, constraint) {
  await assert.rejects(promise, (err) => {
    assert.equal(err.code, code, `expected SQLSTATE ${code}, got ${err.code}: ${err.message}`);
    if (constraint) assert.equal(err.constraint, constraint);
    return true;
  });
}

const q = (text, params) => db.query(text, params);
const id = async (text, params) => (await q(text, params)).rows[0].id;

let n = 0;
const category = (parent = null) => id('INSERT INTO categories (parent_id, name, slug) VALUES ($1, $2, $3) RETURNING id', [parent, `C${++n}`, `c-${n}`]);
const product = (categoryId) => id('INSERT INTO products (category_id, name, slug) VALUES ($1, $2, $3) RETURNING id', [categoryId, `P${++n}`, `p-${n}`]);
const variant = (productId, key) => id('INSERT INTO variants (product_id, label, combination_key) VALUES ($1, $2, $3) RETURNING id', [productId, key, key]);
const sku = (productId, variantId, code, price = '9.99', stock = 1) =>
  id('INSERT INTO skus (product_id, variant_id, code, price, stock_quantity) VALUES ($1, $2, $3, $4, $5) RETURNING id', [productId, variantId, code, price, stock]);

describe('models: categories', () => {
  before(resetDatabase);

  it('rejects a duplicate slug', async () => {
    await q("INSERT INTO categories (name, slug) VALUES ('A', 'dup-slug')");
    await rejects(q("INSERT INTO categories (name, slug) VALUES ('B', 'dup-slug')"), '23505', 'categories_slug_key');
  });

  it('rejects malformed slugs', async () => {
    for (const bad of ['Has Space', 'UPPER', 'trailing-', '-leading', 'dou--ble', '']) {
      await rejects(q('INSERT INTO categories (name, slug) VALUES ($1, $2)', ['X', bad]), '23514', 'categories_slug_format_chk');
    }
  });

  it('rejects a category that is its own parent', async () => {
    const a = await category();
    // The BEFORE trigger fires ahead of CHECK constraints, so the trigger reports it first...
    await rejects(q('UPDATE categories SET parent_id = id WHERE id = $1', [a]), 'RS001');
    // ...and the CHECK constraint remains in place as a second, independent line of defence.
    const chk = await q("SELECT 1 FROM pg_constraint WHERE conname = 'categories_not_self_parent_chk' AND contype = 'c'");
    assert.equal(chk.rowCount, 1);
  });

  it('rejects a longer cycle (A -> B -> C, then A under C)', async () => {
    const a = await category();
    const b = await category(a);
    const c = await category(b);
    await rejects(q('UPDATE categories SET parent_id = $1 WHERE id = $2', [c, a]), 'RS001');
    // and the tree is unchanged
    assert.equal((await q('SELECT parent_id FROM categories WHERE id = $1', [a])).rows[0].parent_id, null);
  });

  it('rejects a parent that does not exist (foreign key)', async () => {
    await rejects(q("INSERT INTO categories (parent_id, name, slug) VALUES (999999, 'Orphan', 'orphan')"), '23503', 'categories_parent_fk');
  });

  it('RESTRICTs deleting a category that has children or products', async () => {
    const parent = await category();
    const child = await category(parent);
    await rejects(q('DELETE FROM categories WHERE id = $1', [parent]), '23503', 'categories_parent_fk');
    await product(child);
    await rejects(q('DELETE FROM categories WHERE id = $1', [child]), '23503', 'products_category_fk');
  });
});

describe('models: products', () => {
  let cat;
  before(async () => { await resetDatabase(); cat = await category(); });

  it('rejects a duplicate slug', async () => {
    await q("INSERT INTO products (category_id, name, slug) VALUES ($1, 'A', 'same')", [cat]);
    await rejects(q("INSERT INTO products (category_id, name, slug) VALUES ($1, 'B', 'same')", [cat]), '23505', 'products_slug_key');
  });

  it('requires an existing category', async () => {
    await rejects(q("INSERT INTO products (category_id, name, slug) VALUES (424242, 'A', 'no-cat')"), '23503', 'products_category_fk');
  });

  it('rejects an unknown status', async () => {
    await rejects(q("INSERT INTO products (category_id, name, slug, status) VALUES ($1, 'A', 'bad-status', 'published')", [cat]), '23514', 'products_status_chk');
  });

  it('defaults to draft and requires specifications to be a JSON object', async () => {
    const pid = await product(cat);
    assert.equal((await q('SELECT status FROM products WHERE id = $1', [pid])).rows[0].status, 'draft');
    await rejects(q("UPDATE products SET specifications = '[1,2]'::jsonb WHERE id = $1", [pid]), '23514', 'products_specs_object_chk');
    await rejects(q("UPDATE products SET specifications = '\"text\"'::jsonb WHERE id = $1", [pid]), '23514', 'products_specs_object_chk');
    await q(`UPDATE products SET specifications = '{"pet_friendly": true}'::jsonb WHERE id = $1`, [pid]);
  });
});

describe('models: SKUs (money, stock, codes)', () => {
  let pid;
  before(async () => { await resetDatabase(); pid = await product(await category()); });

  it('rejects duplicate SKU codes', async () => {
    await sku(pid, null, 'DUP-1');
    await rejects(sku(pid, null, 'DUP-1'), '23505', 'skus_code_key');
  });

  it('rejects lower-case or malformed codes (so duplicates cannot hide behind case)', async () => {
    await rejects(sku(pid, null, 'dup-1'), '23514', 'skus_code_format_chk');
    await rejects(sku(pid, null, 'HAS SPACE'), '23514', 'skus_code_format_chk');
  });

  it('rejects zero and negative prices', async () => {
    await rejects(sku(pid, null, 'P-ZERO', '0'), '23514', 'skus_price_positive_chk');
    await rejects(sku(pid, null, 'P-NEG', '-1.00'), '23514', 'skus_price_positive_chk');
  });

  it('stores money as an exact decimal (0.10 + 0.20 = 0.30, no float drift)', async () => {
    await sku(pid, null, 'M-1', '0.10');
    await sku(pid, null, 'M-2', '0.20');
    const { rows } = await q("SELECT sum(price)::text AS total FROM skus WHERE code IN ('M-1', 'M-2')");
    assert.equal(rows[0].total, '0.30');
    const col = await q("SELECT data_type, numeric_precision, numeric_scale FROM information_schema.columns WHERE table_name = 'skus' AND column_name = 'price'");
    assert.deepEqual(col.rows[0], { data_type: 'numeric', numeric_precision: 10, numeric_scale: 2 });
  });

  it('rejects negative stock on insert and on update', async () => {
    await rejects(sku(pid, null, 'S-NEG', '5.00', -1), '23514', 'skus_stock_nonneg_chk');
    const sid = await sku(pid, null, 'S-OK', '5.00', 3);
    await rejects(q('UPDATE skus SET stock_quantity = stock_quantity - 4 WHERE id = $1', [sid]), '23514', 'skus_stock_nonneg_chk');
    await q('UPDATE skus SET stock_quantity = stock_quantity - 3 WHERE id = $1', [sid]); // exactly zero is fine
  });
});

describe('models: variants and valid combinations', () => {
  before(resetDatabase);

  it('rejects a duplicate combination on the same product but allows it on another', async () => {
    const cat = await category();
    const p1 = await product(cat);
    const p2 = await product(cat);
    await variant(p1, '1:1|2:3');
    await rejects(variant(p1, '1:1|2:3'), '23505', 'variants_combination_key');
    await variant(p2, '1:1|2:3');
  });

  it('a SKU cannot point at a variant of a different product (composite FK)', async () => {
    const cat = await category();
    const p1 = await product(cat);
    const p2 = await product(cat);
    const v1 = await variant(p1, 'a');
    await rejects(sku(p2, v1, 'CROSS-1'), '23503', 'skus_variant_fk');
  });

  it('a variant-less SKU is rejected once the product has variants (no fake default SKU)', async () => {
    const p = await product(await category());
    await variant(p, 'a');
    await rejects(sku(p, null, 'FAKE-DEFAULT'), 'RS002');
  });

  it('a variant is rejected once the product already sells variant-less SKUs', async () => {
    const p = await product(await category());
    await sku(p, null, 'SIMPLE-1');
    await rejects(variant(p, 'a'), 'RS003');
  });

  it('a variant can hold only one value per option, and values must belong to the option', async () => {
    const p = await product(await category());
    const sizeOpt = await id("INSERT INTO product_options (product_id, name, position) VALUES ($1, 'Size', 1) RETURNING id", [p]);
    const potOpt = await id("INSERT INTO product_options (product_id, name, position) VALUES ($1, 'Pot', 2) RETURNING id", [p]);
    const small = await id("INSERT INTO option_values (option_id, value) VALUES ($1, 'Small') RETURNING id", [sizeOpt]);
    const large = await id("INSERT INTO option_values (option_id, value) VALUES ($1, 'Large') RETURNING id", [sizeOpt]);
    const white = await id("INSERT INTO option_values (option_id, value) VALUES ($1, 'White') RETURNING id", [potOpt]);
    const v = await variant(p, 'x');
    const link = (opt, val) => q('INSERT INTO variant_option_values (variant_id, product_id, option_id, option_value_id) VALUES ($1, $2, $3, $4)', [v, p, opt, val]);
    await link(sizeOpt, small);
    await rejects(link(sizeOpt, large), '23505');          // second Size value for one variant
    await rejects(link(potOpt, small), '23503', 'vov_value_fk'); // "Small" is not a Pot value
    await link(potOpt, white);
  });
});

describe('models: delete/update policies toward carts and orders', () => {
  let ctx;
  before(async () => {
    await resetDatabase();
    const cat = await category();
    const pid = await product(cat);
    const vid = await variant(pid, 'v');
    const sid = await sku(pid, vid, 'SOLD-1', '12.00', 5);
    const uid = await id("INSERT INTO users (full_name, email, password_hash) VALUES ('U', 'u@x.io', 'h') RETURNING id");
    ctx = { cat, pid, vid, sid, uid };
  });

  it('RESTRICTs deleting a SKU that is in a cart or on an order', async () => {
    const cartId = await id('INSERT INTO carts (user_id) VALUES ($1) RETURNING id', [ctx.uid]);
    await q('INSERT INTO cart_items (cart_id, sku_id, quantity) VALUES ($1, $2, 1)', [cartId, ctx.sid]);
    await rejects(q('DELETE FROM skus WHERE id = $1', [ctx.sid]), '23503', 'cart_items_sku_fk');
    await q('DELETE FROM cart_items WHERE cart_id = $1', [cartId]);

    const orderId = await id("INSERT INTO orders (user_id, total_amount, shipping_address) VALUES ($1, 12.00, 'addr') RETURNING id", [ctx.uid]);
    await q("INSERT INTO order_items (order_id, sku_id, sku_code_snapshot, product_name_snapshot, quantity, unit_price) VALUES ($1, $2, 'SOLD-1', 'P', 1, 12.00)", [orderId, ctx.sid]);
    await rejects(q('DELETE FROM skus WHERE id = $1', [ctx.sid]), '23503', 'order_items_sku_fk');
    // ...and therefore the product (whose delete cascades to its SKUs) is protected too
    await rejects(q('DELETE FROM products WHERE id = $1', [ctx.pid]), '23503', 'order_items_sku_fk');
  });

  it('cannot delete a variant that still has SKUs', async () => {
    await rejects(q('DELETE FROM variants WHERE id = $1', [ctx.vid]), '23503', 'skus_variant_fk');
  });

  it('cart rows: one line per SKU per cart, positive quantity', async () => {
    const cartId = await id('INSERT INTO carts (user_id) VALUES ($1) ON CONFLICT (user_id) DO UPDATE SET updated_at = now() RETURNING id', [ctx.uid]);
    await q('INSERT INTO cart_items (cart_id, sku_id, quantity) VALUES ($1, $2, 1)', [cartId, ctx.sid]);
    await rejects(q('INSERT INTO cart_items (cart_id, sku_id, quantity) VALUES ($1, $2, 2)', [cartId, ctx.sid]), '23505', 'cart_items_cart_sku_key');
    await rejects(q('INSERT INTO cart_items (cart_id, sku_id, quantity) VALUES ($1, $2, 0)', [cartId, 999999]), '23514', 'cart_items_quantity_chk');
    await rejects(q('INSERT INTO carts (user_id) VALUES ($1)', [ctx.uid]), '23505', 'carts_user_key');
  });

  it('a product with no order/cart history deletes cleanly and takes its children with it', async () => {
    const pid = await product(ctx.cat);
    const vid = await variant(pid, 'gone');
    await sku(pid, vid, 'GONE-1');
    await q('DELETE FROM products WHERE id = $1', [pid]);
    for (const table of ['variants', 'skus']) {
      assert.equal((await q(`SELECT count(*)::int AS n FROM ${table} WHERE product_id = $1`, [pid])).rows[0].n, 0);
    }
  });
});

describe('models: users', () => {
  before(resetDatabase);
  it('enforces unique lower-case emails and known roles', async () => {
    await q("INSERT INTO users (full_name, email, password_hash) VALUES ('A', 'a@x.io', 'h')");
    await rejects(q("INSERT INTO users (full_name, email, password_hash) VALUES ('B', 'a@x.io', 'h')"), '23505', 'users_email_key');
    await rejects(q("INSERT INTO users (full_name, email, password_hash) VALUES ('C', 'UPPER@x.io', 'h')"), '23514', 'users_email_format_chk');
    await rejects(q("INSERT INTO users (full_name, email, password_hash, role) VALUES ('D', 'd@x.io', 'h', 'root')"), '23514', 'users_role_chk');
  });
});

after(() => db.pool.end());
