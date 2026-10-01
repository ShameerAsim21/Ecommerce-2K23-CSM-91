'use strict';
// CAT03 / CAT04: variants represent VALID combinations only.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { bootstrap, makeCategory, makeProduct, makeSku, makeVariant, db } = require('./helpers');

describe('variants API and valid combinations', () => {
  let ctx;
  let cat;
  before(async () => {
    ctx = await bootstrap();
    cat = await makeCategory(ctx);
  });
  after(() => db.pool.end());

  const variantsUrl = (id) => `/api/v1/admin/products/${id}/variants`;
  const detail = async (id) => (await ctx.admin.get(`/api/v1/admin/products/${id}`)).body.data;

  it('the first variant defines the product options; the label joins the values', async () => {
    const p = await makeProduct(ctx, cat.id);
    const res = await ctx.admin.post(variantsUrl(p.id)).send({ options: { Size: 'Small', Pot: 'Terracotta' } });
    assert.equal(res.status, 201);
    assert.equal(res.body.data.label, 'Small / Terracotta');
    assert.deepEqual(res.body.data.options, { Size: 'Small', Pot: 'Terracotta' });
    const d = await detail(p.id);
    assert.deepEqual(d.options.map((o) => o.name), ['Size', 'Pot']);
  });

  it('a missing combination is NOT created as a fake or zero-stock SKU', async () => {
    const p = await makeProduct(ctx, cat.id);
    await makeVariant(ctx, p.id, { Size: 'Small', Pot: 'Terracotta' });
    await makeVariant(ctx, p.id, { Size: 'Small', Pot: 'White' });
    await makeVariant(ctx, p.id, { Size: 'Medium', Pot: 'White' });
    const d = await detail(p.id);

    // All four values exist as options, but only three of the four combinations are offered.
    assert.deepEqual(d.options.find((o) => o.name === 'Size').values, ['Small', 'Medium']);
    assert.deepEqual(d.options.find((o) => o.name === 'Pot').values, ['Terracotta', 'White']);
    assert.equal(d.variants.length, 3);
    assert.ok(!d.variants.some((v) => v.label === 'Medium / Terracotta'));
    assert.equal(d.skus.length, 0, 'creating variants must not fabricate SKUs');

    const sku = await ctx.admin.post(`/api/v1/admin/products/${p.id}/skus`)
      .send({ code: 'NOPE-MD-TERRA', price: '20.00', stock_quantity: 0, options: { Size: 'Medium', Pot: 'Terracotta' } });
    assert.equal(sku.status, 422);
    assert.equal(sku.body.error.code, 'COMBINATION_NOT_AVAILABLE');
    const rows = await db.query("SELECT count(*)::int AS n FROM skus WHERE code = 'NOPE-MD-TERRA'");
    assert.equal(rows.rows[0].n, 0);
  });

  it('rejects a duplicate combination (409 DUPLICATE_VARIANT), even with keys in another order', async () => {
    const p = await makeProduct(ctx, cat.id);
    await makeVariant(ctx, p.id, { Size: 'Small', Pot: 'White' });
    for (const options of [{ Size: 'Small', Pot: 'White' }, { Pot: 'White', Size: 'Small' }]) {
      const res = await ctx.admin.post(variantsUrl(p.id)).send({ options });
      assert.equal(res.status, 409);
      assert.equal(res.body.error.code, 'DUPLICATE_VARIANT');
    }
    assert.equal((await detail(p.id)).variants.length, 1);
  });

  it('every variant must use exactly the same option names as the product', async () => {
    const p = await makeProduct(ctx, cat.id);
    await makeVariant(ctx, p.id, { Size: 'Small', Pot: 'White' });
    for (const options of [{ Size: 'Large' }, { Size: 'Large', Colour: 'Red' }, { Size: 'Large', Pot: 'White', Extra: 'x' }]) {
      const res = await ctx.admin.post(variantsUrl(p.id)).send({ options });
      assert.equal(res.status, 422, JSON.stringify(options));
      assert.equal(res.body.error.code, 'OPTION_SET_MISMATCH');
    }
    // the failed attempts left no stray option values behind
    const d = await detail(p.id);
    assert.deepEqual(d.options.find((o) => o.name === 'Size').values, ['Small']);
  });

  it('validates the options payload', async () => {
    const p = await makeProduct(ctx, cat.id);
    const bad = [{}, { options: {} }, { options: { Size: '' } }, { options: { Size: 5 } },
      { options: { A: '1', B: '2', C: '3', D: '4' } }, { options: { Size: 'S' }, extra: true }];
    for (const body of bad) {
      const res = await ctx.admin.post(variantsUrl(p.id)).send(body);
      assert.equal(res.status, 422, JSON.stringify(body));
    }
    assert.equal((await ctx.admin.post(variantsUrl(999999)).send({ options: { Size: 'S' } })).status, 404);
  });

  it('a product that already sells variant-less SKUs cannot gain variants (409)', async () => {
    const p = await makeProduct(ctx, cat.id);
    await makeSku(ctx, p.id);
    const res = await ctx.admin.post(variantsUrl(p.id)).send({ options: { Size: 'S' } });
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, 'PRODUCT_HAS_SIMPLE_SKU');
  });

  it('deleting a variant that has SKUs is refused; without SKUs it works', async () => {
    const p = await makeProduct(ctx, cat.id);
    const withSku = await makeVariant(ctx, p.id, { Size: 'S' });
    const bare = await makeVariant(ctx, p.id, { Size: 'M' });
    await makeSku(ctx, p.id, { variant_id: withSku.id });

    const blocked = await ctx.admin.delete(`/api/v1/admin/variants/${withSku.id}`);
    assert.equal(blocked.status, 409);
    assert.equal(blocked.body.error.code, 'IN_USE');
    assert.equal((await ctx.admin.delete(`/api/v1/admin/variants/${bare.id}`)).status, 204);
    assert.equal((await ctx.admin.delete(`/api/v1/admin/variants/${bare.id}`)).status, 404);
  });

  it('deleting the last variant clears the option axes so the product can be re-modelled', async () => {
    const p = await makeProduct(ctx, cat.id);
    const v = await makeVariant(ctx, p.id, { Size: 'S' });
    await ctx.admin.delete(`/api/v1/admin/variants/${v.id}`);
    assert.deepEqual((await detail(p.id)).options, []);
    const again = await ctx.admin.post(variantsUrl(p.id)).send({ options: { Colour: 'Green' } });
    assert.equal(again.status, 201);
  });
});
