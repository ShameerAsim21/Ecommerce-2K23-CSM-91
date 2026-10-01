'use strict';
// Must run before ./src/config is loaded so the suite talks to the TEST database.
process.env.NODE_ENV = 'test';

const request = require('supertest');
const config = require('../src/config');
const db = require('../src/db');
const bcrypt = require('bcryptjs');
const { migrateUp, resetSchema } = require('../db/migrate');
const { createApp } = require('../src/app');

// Safety net: the suite DROPs the schema, so refuse to run against anything not named *test*.
const dbName = new URL(config.databaseUrl).pathname;
if (!/test/i.test(dbName)) {
  throw new Error(`Refusing to run tests against database "${dbName}". Point TEST_DATABASE_URL at a *_test database.`);
}

const ADMIN = { email: 'admin@test.local', password: 'admin-test-password' };
const CUSTOMER = { email: 'customer@test.local', password: 'customer-test-password' };

async function resetDatabase() {
  await resetSchema(db.pool);
  await migrateUp(db.pool);
}

async function insertUser({ email, password, role, name }) {
  const hash = await bcrypt.hash(password, config.bcryptRounds);
  const { rows } = await db.query(
    'INSERT INTO users (full_name, email, password_hash, role) VALUES ($1, $2, $3, $4) RETURNING id',
    [name || role, email, hash, role]
  );
  return rows[0].id;
}

/** Wrap supertest so every call carries a bearer token. */
function authed(app, token) {
  const withToken = (req) => (token ? req.set('Authorization', `Bearer ${token}`) : req);
  return {
    get: (url) => withToken(request(app).get(url)),
    post: (url) => withToken(request(app).post(url)),
    patch: (url) => withToken(request(app).patch(url)),
    delete: (url) => withToken(request(app).delete(url)),
  };
}

/** Fresh database + an admin and a customer, each logged in through the real endpoint. */
async function bootstrap() {
  await resetDatabase();
  await insertUser({ ...ADMIN, role: 'admin' });
  await insertUser({ ...CUSTOMER, role: 'customer' });
  const app = createApp();
  const login = async (creds) => (await request(app).post('/api/v1/auth/login').send(creds)).body.token;
  const adminToken = await login(ADMIN);
  const customerToken = await login(CUSTOMER);
  return { app, adminToken, customerToken, admin: authed(app, adminToken), customer: authed(app, customerToken), anon: authed(app, null) };
}

let counter = 0;
const uniq = (prefix) => `${prefix}-${++counter}`;

/** Convenience factories that go through the real API. */
async function makeCategory(ctx, overrides = {}) {
  const slug = overrides.slug || uniq('cat');
  const res = await ctx.admin.post('/api/v1/admin/categories').send({ name: overrides.name || `Category ${slug}`, slug, ...overrides });
  if (res.status !== 201) throw new Error(`makeCategory failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.data;
}

async function makeProduct(ctx, categoryId, overrides = {}) {
  const slug = overrides.slug || uniq('prod');
  const res = await ctx.admin.post('/api/v1/admin/products').send({ name: `Product ${slug}`, slug, category_id: categoryId, ...overrides });
  if (res.status !== 201) throw new Error(`makeProduct failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.data;
}

async function makeSku(ctx, productId, overrides = {}) {
  const res = await ctx.admin.post(`/api/v1/admin/products/${productId}/skus`)
    .send({ code: uniq('SKU').toUpperCase(), price: '10.00', stock_quantity: 5, ...overrides });
  if (res.status !== 201) throw new Error(`makeSku failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.data;
}

async function makeVariant(ctx, productId, options) {
  const res = await ctx.admin.post(`/api/v1/admin/products/${productId}/variants`).send({ options });
  if (res.status !== 201) throw new Error(`makeVariant failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.data;
}

module.exports = {
  ADMIN, CUSTOMER, db, request, resetDatabase, insertUser, authed, bootstrap,
  makeCategory, makeProduct, makeSku, makeVariant, uniq,
};
