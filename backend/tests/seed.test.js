'use strict';
// Seed data must reproduce the same demonstration on a clean database (sprint review checklist).
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { resetDatabase, db, request } = require('./helpers');
const { createApp } = require('../src/app');
const { seed, ADMIN_EMAIL } = require('../db/seeds/seed');
const variants = require('../src/services/variants');

const PASSWORD = 'seed-test-admin-pass';

const snapshot = async () => {
  const [cats, prods, skus] = await Promise.all([
    db.query('SELECT id, name, slug, parent_id, is_active FROM categories ORDER BY id'),
    db.query('SELECT id, name, slug, status, category_id, specifications FROM products ORDER BY id'),
    db.query('SELECT id, product_id, variant_id, code, price::text, stock_quantity, is_active FROM skus ORDER BY id'),
  ]);
  return { cats: cats.rows, prods: prods.rows, skus: skus.rows };
};

describe('seed data', () => {
  let first;
  before(async () => {
    await resetDatabase();
    await seed({ adminPassword: PASSWORD });
    first = await snapshot();
  });
  after(() => db.pool.end());

  it('meets the Sprint 2 minimums: >=2 category levels, >=3 products, >=4 SKUs', async () => {
    assert.ok(first.cats.length >= 2);
    assert.ok(first.cats.some((c) => c.parent_id !== null), 'a child category exists');
    assert.ok(first.cats.some((c) => c.parent_id === null), 'a root category exists');
    assert.ok(first.prods.length >= 3);
    assert.ok(first.skus.length >= 4);
  });

  it('includes a multi-variant product, a variant-less product and a SKU-less draft', async () => {
    const counts = (await db.query(
      `SELECT p.slug, p.status,
              (SELECT count(*) FROM variants v WHERE v.product_id = p.id)::int AS variants,
              (SELECT count(*) FROM skus s WHERE s.product_id = p.id)::int AS skus
         FROM products p ORDER BY p.id`
    )).rows;
    const by = Object.fromEntries(counts.map((r) => [r.slug, r]));
    assert.equal(by['parlor-palm'].variants, 3);
    assert.equal(by['parlor-palm'].skus, 3);
    assert.equal(by['cast-iron-plant'].variants, 0);
    assert.equal(by['cast-iron-plant'].skus, 1);
    assert.equal(by['aroid-potting-mix-5l'].status, 'draft');
    assert.equal(by['aroid-potting-mix-5l'].skus, 0);
  });

  it('has an intentionally unavailable combination: Parlor Palm Medium / Terracotta does not exist', async () => {
    const palm = (await db.query("SELECT id FROM products WHERE slug = 'parlor-palm'")).rows[0].id;
    const offered = await variants.findByOptions(db, palm, { Size: 'Medium', Pot: 'White' });
    const missing = await variants.findByOptions(db, palm, { Size: 'Medium', Pot: 'Terracotta' });
    assert.ok(offered.variant);
    assert.equal(missing.variant, null);
    const row = await db.query("SELECT 1 FROM skus WHERE code LIKE 'PALM-MD-TERRA%'");
    assert.equal(row.rowCount, 0);
  });

  it('has one SKU that is out of stock and all prices are positive exact decimals', async () => {
    const out = first.skus.filter((s) => s.stock_quantity === 0);
    assert.deepEqual(out.map((s) => s.code), ['PALM-SM-WHITE']);
    assert.ok(first.skus.every((s) => /^\d+\.\d{2}$/.test(s.price) && Number(s.price) > 0));
  });

  it('is reproducible: running the seed again yields identical ids and data', async () => {
    await seed({ adminPassword: PASSWORD });
    assert.deepEqual(await snapshot(), first);
  });

  it('the seeded admin can log in and read the catalog through the admin API', async () => {
    const app = createApp();
    const login = await request(app).post('/api/v1/auth/login').send({ email: ADMIN_EMAIL, password: PASSWORD });
    assert.equal(login.status, 200);
    const res = await request(app).get('/api/v1/admin/products').set('Authorization', `Bearer ${login.body.token}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.meta.total, first.prods.length);
  });

  it('refuses to seed without an admin password', async () => {
    await assert.rejects(seed({}), /SEED_ADMIN_PASSWORD/);
  });
});
