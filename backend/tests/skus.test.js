'use strict';
// CAT03 / CAT05: SKU identity, price, stock and their database-backed rules.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { bootstrap, makeCategory, makeProduct, makeSku, makeVariant, db } = require('./helpers');

describe('SKUs API', () => {
  let ctx;
  let cat;
  before(async () => {
    ctx = await bootstrap();
    cat = await makeCategory(ctx);
  });
  after(() => db.pool.end());

  const skusUrl = (pid) => `/api/v1/admin/products/${pid}/skus`;
  const skuUrl = (id) => `/api/v1/admin/skus/${id}`;
  const simpleProduct = () => makeProduct(ctx, cat.id);

  describe('creation with required fields', () => {
    it('creates a SKU with its own price and stock (201 + Location)', async () => {
      const p = await simpleProduct();
      const res = await ctx.admin.post(skusUrl(p.id)).send({ code: 'fern-std', price: '19.99', stock_quantity: 7 });
      assert.equal(res.status, 201);
      const sku = res.body.data;
      assert.equal(res.headers.location, skuUrl(sku.id));
      assert.equal(sku.code, 'FERN-STD', 'codes are stored upper-case');
      assert.equal(sku.price, '19.99', 'price is returned as an exact decimal string');
      assert.equal(sku.stock_quantity, 7);
      assert.equal(sku.is_active, true);
      assert.equal(sku.variant_id, null);
      assert.equal(sku.availability, 'in_stock');
    });

    it('requires code and price; stock defaults to 0 which reads as out_of_stock', async () => {
      const p = await simpleProduct();
      const missing = await ctx.admin.post(skusUrl(p.id)).send({});
      assert.equal(missing.status, 422);
      assert.deepEqual(missing.body.error.details.map((d) => d.field).sort(), ['code', 'price']);

      const res = await ctx.admin.post(skusUrl(p.id)).send({ code: 'NO-STOCK-YET', price: 5 });
      assert.equal(res.status, 201);
      assert.equal(res.body.data.stock_quantity, 0);
      assert.equal(res.body.data.availability, 'out_of_stock');
      assert.equal(res.body.data.price, '5.00', 'integers are normalised to 2 decimals');
    });

    it('404s for an unknown product', async () => {
      assert.equal((await ctx.admin.post(skusUrl(999999)).send({ code: 'A-1', price: '1.00' })).status, 404);
    });
  });

  describe('duplicate SKU code rejection (business rule 6)', () => {
    it('rejects an exact duplicate with 409 DUPLICATE_SKU_CODE, across products', async () => {
      const a = await simpleProduct();
      const b = await simpleProduct();
      await makeSku(ctx, a.id, { code: 'SHARED-CODE' });
      const res = await ctx.admin.post(skusUrl(b.id)).send({ code: 'SHARED-CODE', price: '1.00' });
      assert.equal(res.status, 409);
      assert.equal(res.body.error.code, 'DUPLICATE_SKU_CODE');
      assert.equal(res.body.error.details[0].field, 'code');
    });

    it('treats codes case-insensitively ("abc-1" duplicates "ABC-1")', async () => {
      const p = await simpleProduct();
      await makeSku(ctx, p.id, { code: 'CASE-1' });
      const res = await ctx.admin.post(skusUrl(p.id)).send({ code: 'case-1', price: '1.00' });
      assert.equal(res.status, 409);
    });

    it('two SKUs MAY share a price (business rule 5)', async () => {
      const p = await simpleProduct();
      await makeSku(ctx, p.id, { price: '9.00' });
      await makeSku(ctx, p.id, { price: '9.00' });
    });

    it('rejects malformed codes', async () => {
      const p = await simpleProduct();
      for (const code of ['has space', 'bad_underscore', '-lead', 'trail-', '', 'x'.repeat(65)]) {
        const res = await ctx.admin.post(skusUrl(p.id)).send({ code, price: '1.00' });
        assert.equal(res.status, 422, JSON.stringify(code));
      }
    });
  });

  describe('price rules (no floating-point money)', () => {
    it('accepts decimal strings and numbers with <= 2 decimals', async () => {
      const p = await simpleProduct();
      const a = await makeSku(ctx, p.id, { price: '0.10' });
      const b = await makeSku(ctx, p.id, { price: 19.5 });
      assert.equal(a.price, '0.10');
      assert.equal(b.price, '19.50');
    });

    it('rejects zero, negative, non-numeric, over-precise and float-noise prices', async () => {
      const p = await simpleProduct();
      const bad = ['0', '0.00', -1, '-5.00', 'abc', '', '1.234', 0.1 + 0.2, '1e3', '12345678901', null, true, {}];
      for (const price of bad) {
        const res = await ctx.admin.post(skusUrl(p.id)).send({ code: 'BAD-PRICE', price });
        assert.equal(res.status, 422, `price ${JSON.stringify(price)} should be rejected`);
        assert.ok(res.body.error.details.some((d) => d.field === 'price'));
      }
    });
  });

  describe('stock rules (business rule 6)', () => {
    it('rejects negative, fractional and non-integer stock on create', async () => {
      const p = await simpleProduct();
      for (const stock_quantity of [-1, 1.5, '5', null]) {
        const res = await ctx.admin.post(skusUrl(p.id)).send({ code: 'BAD-STOCK', price: '1.00', stock_quantity });
        assert.equal(res.status, 422, JSON.stringify(stock_quantity));
      }
    });

    it('PATCH sets an absolute stock quantity but never a negative one', async () => {
      const p = await simpleProduct();
      const sku = await makeSku(ctx, p.id, { stock_quantity: 5 });
      const ok = await ctx.admin.patch(skuUrl(sku.id)).send({ stock_quantity: 40 });
      assert.equal(ok.status, 200);
      assert.equal(ok.body.data.stock_quantity, 40);
      const neg = await ctx.admin.patch(skuUrl(sku.id)).send({ stock_quantity: -1 });
      assert.equal(neg.status, 422);
      assert.equal((await ctx.admin.get(skuUrl(sku.id))).body.data.stock_quantity, 40);
    });

    it('PATCH stock_delta adjusts atomically; a delta below zero is rejected and changes nothing', async () => {
      const p = await simpleProduct();
      const sku = await makeSku(ctx, p.id, { stock_quantity: 5 });
      const down = await ctx.admin.patch(skuUrl(sku.id)).send({ stock_delta: -3 });
      assert.equal(down.body.data.stock_quantity, 2);
      const tooFar = await ctx.admin.patch(skuUrl(sku.id)).send({ stock_delta: -10 });
      assert.equal(tooFar.status, 422);
      assert.equal(tooFar.body.error.code, 'NEGATIVE_STOCK');
      assert.equal((await ctx.admin.get(skuUrl(sku.id))).body.data.stock_quantity, 2);
      const toZero = await ctx.admin.patch(skuUrl(sku.id)).send({ stock_delta: -2 });
      assert.equal(toZero.body.data.stock_quantity, 0);
      assert.equal(toZero.body.data.availability, 'out_of_stock');
    });

    it('concurrent decrements can never drive stock below zero (row locking)', async () => {
      const p = await simpleProduct();
      const sku = await makeSku(ctx, p.id, { stock_quantity: 5 });
      const results = await Promise.all(
        Array.from({ length: 12 }, () => ctx.admin.patch(skuUrl(sku.id)).send({ stock_delta: -1 }))
      );
      const ok = results.filter((r) => r.status === 200).length;
      const rejected = results.filter((r) => r.status === 422).length;
      assert.equal(ok, 5);
      assert.equal(rejected, 7);
      assert.equal((await ctx.admin.get(skuUrl(sku.id))).body.data.stock_quantity, 0);
    });

    it('rejects sending stock_quantity and stock_delta together, and a zero delta', async () => {
      const p = await simpleProduct();
      const sku = await makeSku(ctx, p.id);
      assert.equal((await ctx.admin.patch(skuUrl(sku.id)).send({ stock_quantity: 1, stock_delta: 1 })).status, 422);
      assert.equal((await ctx.admin.patch(skuUrl(sku.id)).send({ stock_delta: 0 })).status, 422);
    });
  });

  describe('update price and active status', () => {
    it('changes price and toggles is_active; availability follows', async () => {
      const p = await simpleProduct();
      const sku = await makeSku(ctx, p.id, { price: '10.00', stock_quantity: 3 });
      const priced = await ctx.admin.patch(skuUrl(sku.id)).send({ price: '12.75' });
      assert.equal(priced.body.data.price, '12.75');
      const off = await ctx.admin.patch(skuUrl(sku.id)).send({ is_active: false });
      assert.equal(off.body.data.availability, 'inactive');
      const on = await ctx.admin.patch(skuUrl(sku.id)).send({ is_active: true });
      assert.equal(on.body.data.availability, 'in_stock');
    });

    it('the SKU code is immutable; empty and unknown PATCH bodies are rejected', async () => {
      const p = await simpleProduct();
      const sku = await makeSku(ctx, p.id);
      assert.equal((await ctx.admin.patch(skuUrl(sku.id)).send({ code: 'NEW-CODE' })).status, 422);
      assert.equal((await ctx.admin.patch(skuUrl(sku.id)).send({})).status, 422);
      assert.equal((await ctx.admin.patch(skuUrl(sku.id)).send({ product_id: 1 })).status, 422);
      assert.equal((await ctx.admin.patch(skuUrl(999999)).send({ price: '1.00' })).status, 404);
      assert.equal((await ctx.admin.patch(skuUrl('abc')).send({ price: '1.00' })).status, 400);
    });

    it('an active product keeps at least one active SKU', async () => {
      const p = await simpleProduct();
      const only = await makeSku(ctx, p.id);
      await ctx.admin.patch(`/api/v1/admin/products/${p.id}`).send({ status: 'active' });

      const off = await ctx.admin.patch(skuUrl(only.id)).send({ is_active: false });
      assert.equal(off.status, 409);
      assert.equal(off.body.error.code, 'LAST_ACTIVE_SKU');
      const del = await ctx.admin.delete(skuUrl(only.id));
      assert.equal(del.status, 409);

      const second = await makeSku(ctx, p.id);
      assert.equal((await ctx.admin.patch(skuUrl(only.id)).send({ is_active: false })).status, 200);
      assert.equal((await ctx.admin.patch(skuUrl(second.id)).send({ is_active: false })).status, 409);
    });
  });

  describe('variant / combination rules', () => {
    it('a product with variants requires SKUs to reference a variant (422 VARIANT_REQUIRED)', async () => {
      const p = await simpleProduct();
      await makeVariant(ctx, p.id, { Size: 'S' });
      const res = await ctx.admin.post(skusUrl(p.id)).send({ code: 'NO-VARIANT', price: '1.00' });
      assert.equal(res.status, 422);
      assert.equal(res.body.error.code, 'VARIANT_REQUIRED');
    });

    it('creates a SKU by variant_id or by option values', async () => {
      const p = await simpleProduct();
      const small = await makeVariant(ctx, p.id, { Size: 'S' });
      await makeVariant(ctx, p.id, { Size: 'M' });
      const byId = await ctx.admin.post(skusUrl(p.id)).send({ code: 'BY-ID', price: '5.00', variant_id: small.id });
      assert.equal(byId.status, 201);
      assert.equal(byId.body.data.variant_label, 'S');
      const byOptions = await ctx.admin.post(skusUrl(p.id)).send({ code: 'BY-OPT', price: '6.00', options: { Size: 'M' } });
      assert.equal(byOptions.status, 201);
      assert.equal(byOptions.body.data.variant_label, 'M');
    });

    it('rejects an unoffered combination, wrong option names, and a variant of another product', async () => {
      const p = await simpleProduct();
      const other = await simpleProduct();
      await makeVariant(ctx, p.id, { Size: 'S' });
      const foreign = await makeVariant(ctx, other.id, { Size: 'S' });

      const unoffered = await ctx.admin.post(skusUrl(p.id)).send({ code: 'X-1', price: '1.00', options: { Size: 'XL' } });
      assert.equal(unoffered.body.error.code, 'COMBINATION_NOT_AVAILABLE');
      const wrongNames = await ctx.admin.post(skusUrl(p.id)).send({ code: 'X-2', price: '1.00', options: { Colour: 'S' } });
      assert.equal(wrongNames.body.error.code, 'COMBINATION_NOT_AVAILABLE');
      const crossProduct = await ctx.admin.post(skusUrl(p.id)).send({ code: 'X-3', price: '1.00', variant_id: foreign.id });
      assert.equal(crossProduct.status, 422);
      assert.equal(crossProduct.body.error.code, 'VARIANT_NOT_FOUND');
      const both = await ctx.admin.post(skusUrl(p.id)).send({ code: 'X-4', price: '1.00', variant_id: foreign.id, options: { Size: 'S' } });
      assert.equal(both.status, 422);

      const none = await db.query("SELECT count(*)::int AS n FROM skus WHERE code LIKE 'X-%'");
      assert.equal(none.rows[0].n, 0);
    });

    it('options on a product without variants are refused', async () => {
      const p = await simpleProduct();
      const res = await ctx.admin.post(skusUrl(p.id)).send({ code: 'X-5', price: '1.00', options: { Size: 'S' } });
      assert.equal(res.status, 422);
      assert.equal(res.body.error.code, 'COMBINATION_NOT_AVAILABLE');
    });
  });

  describe('delete (business rule 7)', () => {
    it('deletes an unreferenced SKU; refuses one that is in a cart or on an order', async () => {
      const p = await simpleProduct();
      const free = await makeSku(ctx, p.id);
      const carted = await makeSku(ctx, p.id);
      const user = (await db.query('SELECT id FROM users LIMIT 1')).rows[0].id;
      const cart = (await db.query('INSERT INTO carts (user_id) VALUES ($1) ON CONFLICT (user_id) DO UPDATE SET updated_at = now() RETURNING id', [user])).rows[0].id;
      await db.query('INSERT INTO cart_items (cart_id, sku_id, quantity) VALUES ($1, $2, 1)', [cart, carted.id]);

      assert.equal((await ctx.admin.delete(skuUrl(free.id))).status, 204);
      const blocked = await ctx.admin.delete(skuUrl(carted.id));
      assert.equal(blocked.status, 409);
      assert.equal(blocked.body.error.code, 'IN_USE');
      // deactivation is the supported alternative
      assert.equal((await ctx.admin.patch(skuUrl(carted.id)).send({ is_active: false })).status, 200);
    });
  });
});
