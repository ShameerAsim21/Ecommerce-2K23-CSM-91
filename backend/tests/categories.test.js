'use strict';
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { bootstrap, makeCategory, makeProduct, db } = require('./helpers');

const URL = '/api/v1/admin/categories';

describe('categories API', () => {
  let ctx;
  before(async () => { ctx = await bootstrap(); });
  after(() => db.pool.end());

  it('creates a root category and a child (201 + Location)', async () => {
    const root = await ctx.admin.post(URL).send({ name: 'Plants', slug: 'plants', description: 'All plants' });
    assert.equal(root.status, 201);
    assert.equal(root.headers.location, `${URL}/${root.body.data.id}`);
    assert.equal(root.body.data.parent_id, null);
    assert.equal(root.body.data.is_active, true);

    const child = await ctx.admin.post(URL).send({ name: 'Low Light', slug: 'low-light', parent_id: root.body.data.id });
    assert.equal(child.status, 201);
    assert.equal(child.body.data.parent_id, root.body.data.id);
  });

  it('rejects missing and malformed fields with field-level details (422)', async () => {
    const res = await ctx.admin.post(URL).send({ slug: 'Bad Slug!' });
    assert.equal(res.status, 422);
    assert.equal(res.body.error.code, 'VALIDATION_ERROR');
    const fields = res.body.error.details.map((d) => d.field).sort();
    assert.deepEqual(fields, ['name', 'slug']);
  });

  it('rejects unknown fields instead of ignoring them', async () => {
    const res = await ctx.admin.post(URL).send({ name: 'X', slug: 'x-unknown', id: 99 });
    assert.equal(res.status, 422);
  });

  it('rejects a duplicate slug with 409 and a clear code (no traceback)', async () => {
    await makeCategory(ctx, { slug: 'unique-one' });
    const res = await ctx.admin.post(URL).send({ name: 'Other', slug: 'unique-one' });
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, 'DUPLICATE_SLUG');
    assert.equal(res.body.error.details[0].field, 'slug');
    assert.ok(!JSON.stringify(res.body).includes('at '), 'no stack trace in body');
  });

  it('rejects an unknown parent (422)', async () => {
    const res = await ctx.admin.post(URL).send({ name: 'Orphan', slug: 'orphan-x', parent_id: 987654 });
    assert.equal(res.status, 422);
    assert.equal(res.body.error.code, 'PARENT_NOT_FOUND');
  });

  it('returns the category tree, nested, with product counts', async () => {
    const root = await makeCategory(ctx, { slug: 'tree-root', name: 'Tree Root' });
    const kid = await makeCategory(ctx, { slug: 'tree-kid', name: 'Tree Kid', parent_id: root.id });
    const grandkid = await makeCategory(ctx, { slug: 'tree-grandkid', name: 'Tree Grandkid', parent_id: kid.id });
    await makeProduct(ctx, grandkid.id);

    const res = await ctx.admin.get(URL);
    assert.equal(res.status, 200);
    const node = res.body.data.find((c) => c.id === root.id);
    assert.equal(node.children[0].id, kid.id);
    assert.equal(node.children[0].children[0].id, grandkid.id);
    assert.equal(node.children[0].children[0].product_count, 1);
    assert.deepEqual(node.children[0].children[0].children, []);
  });

  it('updates name and slug; a duplicate slug on update is 409', async () => {
    const a = await makeCategory(ctx, { slug: 'upd-a' });
    await makeCategory(ctx, { slug: 'upd-b' });
    const ok = await ctx.admin.patch(`${URL}/${a.id}`).send({ name: 'Renamed', slug: 'upd-a-renamed' });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.data.name, 'Renamed');
    const dup = await ctx.admin.patch(`${URL}/${a.id}`).send({ slug: 'upd-b' });
    assert.equal(dup.status, 409);
    assert.equal(dup.body.error.code, 'DUPLICATE_SLUG');
  });

  it('rejects an empty PATCH and an unknown id', async () => {
    const c = await makeCategory(ctx);
    assert.equal((await ctx.admin.patch(`${URL}/${c.id}`).send({})).status, 422);
    assert.equal((await ctx.admin.patch(`${URL}/999999`).send({ name: 'x' })).status, 404);
    assert.equal((await ctx.admin.patch(`${URL}/abc`).send({ name: 'x' })).status, 400);
  });

  describe('hierarchy validation (cycle prevention)', () => {
    it('rejects making a category its own parent', async () => {
      const a = await makeCategory(ctx);
      const res = await ctx.admin.patch(`${URL}/${a.id}`).send({ parent_id: a.id });
      assert.equal(res.status, 422);
      assert.equal(res.body.error.code, 'CATEGORY_CYCLE');
    });

    it('rejects moving a category under its own descendant', async () => {
      const a = await makeCategory(ctx);
      const b = await makeCategory(ctx, { parent_id: a.id });
      const c = await makeCategory(ctx, { parent_id: b.id });
      const res = await ctx.admin.patch(`${URL}/${a.id}`).send({ parent_id: c.id });
      assert.equal(res.status, 422);
      assert.equal(res.body.error.code, 'CATEGORY_CYCLE');
      // the tree is untouched
      const { rows } = await db.query('SELECT parent_id FROM categories WHERE id = $1', [a.id]);
      assert.equal(rows[0].parent_id, null);
    });

    it('allows a legitimate re-parent and moving to the root', async () => {
      const a = await makeCategory(ctx);
      const b = await makeCategory(ctx);
      const moved = await ctx.admin.patch(`${URL}/${b.id}`).send({ parent_id: a.id });
      assert.equal(moved.status, 200);
      assert.equal(moved.body.data.parent_id, a.id);
      const root = await ctx.admin.patch(`${URL}/${b.id}`).send({ parent_id: null });
      assert.equal(root.body.data.parent_id, null);
    });
  });

  describe('deactivation (business rule 3)', () => {
    it('deactivating a parent deactivates all descendants, and reports how many', async () => {
      const a = await makeCategory(ctx);
      const b = await makeCategory(ctx, { parent_id: a.id });
      const c = await makeCategory(ctx, { parent_id: b.id });
      const res = await ctx.admin.patch(`${URL}/${a.id}`).send({ is_active: false });
      assert.equal(res.status, 200);
      assert.equal(res.body.data.deactivated_descendants, 2);
      const { rows } = await db.query('SELECT id, is_active FROM categories WHERE id = ANY($1)', [[a.id, b.id, c.id]]);
      assert.ok(rows.every((r) => r.is_active === false));
    });

    it('does not delete products of a deactivated category', async () => {
      const a = await makeCategory(ctx);
      const p = await makeProduct(ctx, a.id);
      await ctx.admin.patch(`${URL}/${a.id}`).send({ is_active: false });
      const detail = await ctx.admin.get(`/api/v1/admin/products/${p.id}`);
      assert.equal(detail.status, 200);
      assert.equal(detail.body.data.category.is_active, false);
    });

    it('refuses to create a child under, or reactivate a child of, an inactive parent', async () => {
      const a = await makeCategory(ctx);
      const b = await makeCategory(ctx, { parent_id: a.id });
      await ctx.admin.patch(`${URL}/${a.id}`).send({ is_active: false });

      const create = await ctx.admin.post(URL).send({ name: 'N', slug: 'new-under-inactive', parent_id: a.id });
      assert.equal(create.status, 409);
      assert.equal(create.body.error.code, 'PARENT_INACTIVE');

      const reactivate = await ctx.admin.patch(`${URL}/${b.id}`).send({ is_active: true });
      assert.equal(reactivate.status, 409);
      assert.equal(reactivate.body.error.code, 'PARENT_INACTIVE');
    });

    it('reactivating a parent does NOT silently reactivate its children', async () => {
      const a = await makeCategory(ctx);
      const b = await makeCategory(ctx, { parent_id: a.id });
      await ctx.admin.patch(`${URL}/${a.id}`).send({ is_active: false });
      await ctx.admin.patch(`${URL}/${a.id}`).send({ is_active: true });
      const { rows } = await db.query('SELECT is_active FROM categories WHERE id = $1', [b.id]);
      assert.equal(rows[0].is_active, false);
    });
  });

  describe('delete', () => {
    it('deletes an empty leaf (204) then 404s', async () => {
      const c = await makeCategory(ctx);
      assert.equal((await ctx.admin.delete(`${URL}/${c.id}`)).status, 204);
      assert.equal((await ctx.admin.delete(`${URL}/${c.id}`)).status, 404);
    });

    it('refuses to delete a category with children or with products (409 IN_USE)', async () => {
      const parent = await makeCategory(ctx);
      const child = await makeCategory(ctx, { parent_id: parent.id });
      const withKids = await ctx.admin.delete(`${URL}/${parent.id}`);
      assert.equal(withKids.status, 409);
      assert.equal(withKids.body.error.code, 'IN_USE');
      assert.match(withKids.body.error.message, /child categories/);

      await makeProduct(ctx, child.id);
      const withProducts = await ctx.admin.delete(`${URL}/${child.id}`);
      assert.equal(withProducts.status, 409);
      assert.match(withProducts.body.error.message, /products/);
    });
  });

  it('answers malformed JSON with 400, not a server error', async () => {
    const res = await ctx.admin.post(URL).set('Content-Type', 'application/json').send('{"name": ');
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'INVALID_JSON');
  });
});
