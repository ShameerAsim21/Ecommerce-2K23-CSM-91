'use strict';
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { bootstrap, makeCategory, makeProduct, makeSku, db } = require('./helpers');

const URL = '/api/v1/admin/products';

describe('products API', () => {
  let ctx;
  let cat;
  before(async () => {
    ctx = await bootstrap();
    cat = await makeCategory(ctx, { slug: 'products-base' });
  });
  after(() => db.pool.end());

  describe('create', () => {
    it('creates a DRAFT product with no SKU (business rule 1)', async () => {
      const res = await ctx.admin.post(URL).send({ name: 'Snake Plant', slug: 'snake-plant', description: 'Hardy.', category_id: cat.id });
      assert.equal(res.status, 201);
      assert.equal(res.headers.location, `${URL}/${res.body.data.id}`);
      const p = res.body.data;
      assert.equal(p.status, 'draft');
      assert.equal(p.category.id, cat.id);
      assert.deepEqual(p.skus, []);
      assert.deepEqual(p.variants, []);
      assert.deepEqual(p.specifications, {});
    });

    it('requires name, slug and category_id, reporting each missing field', async () => {
      const res = await ctx.admin.post(URL).send({});
      assert.equal(res.status, 422);
      assert.deepEqual(res.body.error.details.map((d) => d.field).sort(), ['category_id', 'name', 'slug']);
    });

    it('does not let a client create a non-draft product or set specifications', async () => {
      const status = await ctx.admin.post(URL).send({ name: 'X', slug: 'x-active', category_id: cat.id, status: 'active' });
      assert.equal(status.status, 422);
      const specs = await ctx.admin.post(URL).send({ name: 'X', slug: 'x-specs', category_id: cat.id, specifications: { a: 1 } });
      assert.equal(specs.status, 422);
    });

    it('rejects invalid slugs (422)', async () => {
      for (const slug of ['Has Space', 'UPPER', '-lead', 'a_b']) {
        const res = await ctx.admin.post(URL).send({ name: 'X', slug, category_id: cat.id });
        assert.equal(res.status, 422, slug);
      }
    });

    it('rejects a duplicate slug (409 DUPLICATE_SLUG)', async () => {
      await makeProduct(ctx, cat.id, { slug: 'dup-product' });
      const res = await ctx.admin.post(URL).send({ name: 'Again', slug: 'dup-product', category_id: cat.id });
      assert.equal(res.status, 409);
      assert.equal(res.body.error.code, 'DUPLICATE_SLUG');
    });

    it('rejects an unknown category (422) and an inactive category (409)', async () => {
      const unknown = await ctx.admin.post(URL).send({ name: 'X', slug: 'x-nocat', category_id: 424242 });
      assert.equal(unknown.status, 422);
      assert.equal(unknown.body.error.code, 'CATEGORY_NOT_FOUND');

      const inactive = await makeCategory(ctx);
      await ctx.admin.patch(`/api/v1/admin/categories/${inactive.id}`).send({ is_active: false });
      const res = await ctx.admin.post(URL).send({ name: 'X', slug: 'x-inactive-cat', category_id: inactive.id });
      assert.equal(res.status, 409);
      assert.equal(res.body.error.code, 'CATEGORY_INACTIVE');
    });
  });

  describe('publish rules (business rule 1)', () => {
    it('a product cannot become active without an active SKU', async () => {
      const p = await makeProduct(ctx, cat.id);
      const none = await ctx.admin.patch(`${URL}/${p.id}`).send({ status: 'active' });
      assert.equal(none.status, 409);
      assert.equal(none.body.error.code, 'NO_ACTIVE_SKU');

      await makeSku(ctx, p.id, { is_active: false });
      const inactiveOnly = await ctx.admin.patch(`${URL}/${p.id}`).send({ status: 'active' });
      assert.equal(inactiveOnly.status, 409);

      await makeSku(ctx, p.id, { is_active: true });
      const ok = await ctx.admin.patch(`${URL}/${p.id}`).send({ status: 'active' });
      assert.equal(ok.status, 200);
      assert.equal(ok.body.data.status, 'active');
    });

    it('a product can be archived without any SKU', async () => {
      const p = await makeProduct(ctx, cat.id);
      const res = await ctx.admin.patch(`${URL}/${p.id}`).send({ status: 'archived' });
      assert.equal(res.status, 200);
      assert.equal(res.body.data.status, 'archived');
    });
  });

  describe('update', () => {
    it('edits name, description and category', async () => {
      const other = await makeCategory(ctx);
      const p = await makeProduct(ctx, cat.id);
      const res = await ctx.admin.patch(`${URL}/${p.id}`).send({ name: 'New Name', description: 'New text', category_id: other.id });
      assert.equal(res.status, 200);
      assert.equal(res.body.data.name, 'New Name');
      assert.equal(res.body.data.category.id, other.id);
      assert.ok(new Date(res.body.data.updated_at) >= new Date(p.updated_at));
    });

    it('rejects a duplicate slug, an invalid status, an empty body, and an unknown id', async () => {
      const a = await makeProduct(ctx, cat.id);
      const b = await makeProduct(ctx, cat.id);
      assert.equal((await ctx.admin.patch(`${URL}/${a.id}`).send({ slug: b.slug })).status, 409);
      assert.equal((await ctx.admin.patch(`${URL}/${a.id}`).send({ status: 'published' })).status, 422);
      assert.equal((await ctx.admin.patch(`${URL}/${a.id}`).send({})).status, 422);
      assert.equal((await ctx.admin.patch(`${URL}/999999`).send({ name: 'x' })).status, 404);
    });

    it('refuses to move a product into an inactive category', async () => {
      const dead = await makeCategory(ctx);
      await ctx.admin.patch(`/api/v1/admin/categories/${dead.id}`).send({ is_active: false });
      const p = await makeProduct(ctx, cat.id);
      const res = await ctx.admin.patch(`${URL}/${p.id}`).send({ category_id: dead.id });
      assert.equal(res.status, 409);
    });
  });

  describe('read', () => {
    it('lists products with pagination metadata and SKU aggregates', async () => {
      const c = await makeCategory(ctx);
      const p = await makeProduct(ctx, c.id, { slug: 'list-me' });
      await makeSku(ctx, p.id, { price: '12.50', stock_quantity: 3 });
      await makeSku(ctx, p.id, { price: '30.00', stock_quantity: 0 });
      const res = await ctx.admin.get(`${URL}?category_id=${c.id}`);
      assert.equal(res.status, 200);
      assert.deepEqual(res.body.meta, { page: 1, page_size: 20, total: 1 });
      const row = res.body.data[0];
      assert.equal(row.sku_count, 2);
      assert.equal(row.in_stock_sku_count, 1);
      assert.equal(row.min_price, '12.50');
      assert.equal(row.max_price, '30.00');
      assert.equal(row.category_slug, c.slug);
    });

    it('filters by status and search text, and paginates', async () => {
      const c = await makeCategory(ctx);
      for (const name of ['Fern A', 'Fern B', 'Cactus']) await makeProduct(ctx, c.id, { name });
      const search = await ctx.admin.get(`${URL}?category_id=${c.id}&q=fern`);
      assert.equal(search.body.meta.total, 2);
      const page = await ctx.admin.get(`${URL}?category_id=${c.id}&page=2&page_size=2`);
      assert.equal(page.body.data.length, 1);
      assert.equal(page.body.meta.total, 3);
      const drafts = await ctx.admin.get(`${URL}?category_id=${c.id}&status=active`);
      assert.equal(drafts.body.meta.total, 0);
    });

    it('treats % and _ in search text literally', async () => {
      const res = await ctx.admin.get(`${URL}?q=%25`);
      assert.equal(res.status, 200);
      assert.equal(res.body.meta.total, 0);
    });

    it('validates query parameters (422)', async () => {
      assert.equal((await ctx.admin.get(`${URL}?page=0`)).status, 422);
      assert.equal((await ctx.admin.get(`${URL}?page_size=1000`)).status, 422);
      assert.equal((await ctx.admin.get(`${URL}?status=bogus`)).status, 422);
    });

    it('returns full detail; unknown id is 404, malformed id is 400', async () => {
      const p = await makeProduct(ctx, cat.id);
      const res = await ctx.admin.get(`${URL}/${p.id}`);
      assert.equal(res.status, 200);
      for (const key of ['category', 'options', 'variants', 'skus', 'specifications']) assert.ok(key in res.body.data, key);
      assert.equal((await ctx.admin.get(`${URL}/999999`)).status, 404);
      assert.equal((await ctx.admin.get(`${URL}/abc`)).status, 400);
    });
  });

  describe('delete (business rule 7)', () => {
    it('deletes a draft with its SKUs, then 404s', async () => {
      const p = await makeProduct(ctx, cat.id);
      await makeSku(ctx, p.id);
      assert.equal((await ctx.admin.delete(`${URL}/${p.id}`)).status, 204);
      assert.equal((await ctx.admin.get(`${URL}/${p.id}`)).status, 404);
      assert.equal((await ctx.admin.delete(`${URL}/${p.id}`)).status, 404);
    });

    it('refuses to delete an ACTIVE product until it is archived', async () => {
      const p = await makeProduct(ctx, cat.id);
      await makeSku(ctx, p.id);
      await ctx.admin.patch(`${URL}/${p.id}`).send({ status: 'active' });
      const res = await ctx.admin.delete(`${URL}/${p.id}`);
      assert.equal(res.status, 409);
      assert.equal(res.body.error.code, 'PRODUCT_ACTIVE');
    });

    it('a product whose SKU is on an order can never be deleted, only archived', async () => {
      const p = await makeProduct(ctx, cat.id);
      const sku = await makeSku(ctx, p.id, { code: 'ORDERED-1' });
      const user = (await db.query('SELECT id FROM users LIMIT 1')).rows[0].id;
      const order = (await db.query("INSERT INTO orders (user_id, total_amount, shipping_address) VALUES ($1, 10, 'a') RETURNING id", [user])).rows[0].id;
      await db.query("INSERT INTO order_items (order_id, sku_id, sku_code_snapshot, product_name_snapshot, quantity, unit_price) VALUES ($1, $2, 'ORDERED-1', $3, 1, 10)", [order, sku.id, p.name]);

      await ctx.admin.patch(`${URL}/${p.id}`).send({ status: 'active' });
      await ctx.admin.patch(`${URL}/${p.id}`).send({ status: 'archived' });
      const del = await ctx.admin.delete(`${URL}/${p.id}`);
      assert.equal(del.status, 409);
      assert.equal(del.body.error.code, 'IN_USE');
      // history intact
      assert.equal((await ctx.admin.get(`${URL}/${p.id}`)).body.data.status, 'archived');
    });
  });
});
