'use strict';
// CAT06: administrative operations reject unauthenticated and unauthorized requests.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
// helpers MUST be required first: it selects the test database before src/config is loaded.
const { bootstrap, request, authed, db, ADMIN, CUSTOMER, insertUser } = require('./helpers');
const jwt = require('jsonwebtoken');
const config = require('../src/config');

const ENDPOINTS = [
  ['get', '/api/v1/admin/categories'],
  ['post', '/api/v1/admin/categories'],
  ['patch', '/api/v1/admin/categories/1'],
  ['delete', '/api/v1/admin/categories/1'],
  ['get', '/api/v1/admin/products'],
  ['post', '/api/v1/admin/products'],
  ['get', '/api/v1/admin/products/1'],
  ['patch', '/api/v1/admin/products/1'],
  ['delete', '/api/v1/admin/products/1'],
  ['post', '/api/v1/admin/products/1/variants'],
  ['post', '/api/v1/admin/products/1/skus'],
  ['get', '/api/v1/admin/skus/1'],
  ['patch', '/api/v1/admin/skus/1'],
  ['delete', '/api/v1/admin/skus/1'],
  ['delete', '/api/v1/admin/variants/1'],
];

describe('authorization: admin endpoints', () => {
  let ctx;
  before(async () => { ctx = await bootstrap(); });

  for (const [method, url] of ENDPOINTS) {
    it(`${method.toUpperCase()} ${url} -> 401 without a token`, async () => {
      const res = await ctx.anon[method](url).send({});
      assert.equal(res.status, 401);
      assert.equal(res.body.error.code, 'UNAUTHENTICATED');
    });

    it(`${method.toUpperCase()} ${url} -> 403 for a customer token`, async () => {
      const res = await ctx.customer[method](url).send({});
      assert.equal(res.status, 403);
      assert.equal(res.body.error.code, 'FORBIDDEN');
    });

    it(`${method.toUpperCase()} ${url} -> reaches the handler for an admin`, async () => {
      const res = await ctx.admin[method](url).send({});
      assert.notEqual(res.status, 401);
      assert.notEqual(res.status, 403);
    });
  }

  it('rejects a malformed Authorization header', async () => {
    for (const header of ['Basic abc', 'Bearer', 'token abc', '']) {
      const res = await request(ctx.app).get('/api/v1/admin/products').set('Authorization', header);
      assert.equal(res.status, 401, header);
    }
  });

  it('rejects a garbage token, a wrongly signed token, and an expired token', async () => {
    const garbage = await authed(ctx.app, 'not.a.jwt').get('/api/v1/admin/products');
    assert.equal(garbage.status, 401);

    const forged = jwt.sign({ role: 'admin' }, 'some-other-secret', { subject: '1', expiresIn: '1h' });
    assert.equal((await authed(ctx.app, forged).get('/api/v1/admin/products')).status, 401);

    const expired = jwt.sign({ role: 'admin' }, config.jwtSecret, { subject: '1', expiresIn: -60 });
    const res = await authed(ctx.app, expired).get('/api/v1/admin/products');
    assert.equal(res.status, 401);
    assert.match(res.body.error.message, /expired/i);
  });

  it('rejects an unsigned ("alg: none") token', async () => {
    const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const none = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub: '1', role: 'admin' })}.`;
    assert.equal((await authed(ctx.app, none).get('/api/v1/admin/products')).status, 401);
  });

  it('trusts the database role, not the role claim: a customer with a forged admin claim gets 403', async () => {
    const { rows } = await db.query('SELECT id FROM users WHERE email = $1', [CUSTOMER.email]);
    const token = jwt.sign({ role: 'admin' }, config.jwtSecret, { subject: String(rows[0].id), expiresIn: '1h' });
    assert.equal((await authed(ctx.app, token).get('/api/v1/admin/products')).status, 403);
  });

  it('a valid token for a deleted account is rejected', async () => {
    const id = await insertUser({ email: 'temp-admin@test.local', password: 'temp-password-1', role: 'admin' });
    const token = (await request(ctx.app).post('/api/v1/auth/login').send({ email: 'temp-admin@test.local', password: 'temp-password-1' })).body.token;
    assert.equal((await authed(ctx.app, token).get('/api/v1/admin/products')).status, 200);
    await db.query('DELETE FROM users WHERE id = $1', [id]);
    assert.equal((await authed(ctx.app, token).get('/api/v1/admin/products')).status, 401);
  });

  it('a demoted admin loses access immediately', async () => {
    await insertUser({ email: 'demote@test.local', password: 'demote-password-1', role: 'admin' });
    const token = (await request(ctx.app).post('/api/v1/auth/login').send({ email: 'demote@test.local', password: 'demote-password-1' })).body.token;
    assert.equal((await authed(ctx.app, token).get('/api/v1/admin/products')).status, 200);
    await db.query("UPDATE users SET role = 'customer' WHERE email = 'demote@test.local'");
    assert.equal((await authed(ctx.app, token).get('/api/v1/admin/products')).status, 403);
  });
});

describe('authorization: login', () => {
  let ctx;
  before(async () => { ctx = await bootstrap(); });

  it('returns a bearer token and the user (never the password hash)', async () => {
    const res = await request(ctx.app).post('/api/v1/auth/login').send(ADMIN);
    assert.equal(res.status, 200);
    assert.equal(res.body.token_type, 'Bearer');
    assert.equal(res.body.user.role, 'admin');
    assert.ok(!JSON.stringify(res.body).includes('password_hash'));
  });

  it('accepts the email in any letter case', async () => {
    const res = await request(ctx.app).post('/api/v1/auth/login').send({ email: ADMIN.email.toUpperCase(), password: ADMIN.password });
    assert.equal(res.status, 200);
  });

  it('gives the same 401 for a wrong password and an unknown email', async () => {
    const wrong = await request(ctx.app).post('/api/v1/auth/login').send({ email: ADMIN.email, password: 'wrong-password' });
    const unknown = await request(ctx.app).post('/api/v1/auth/login').send({ email: 'nobody@test.local', password: 'whatever' });
    assert.equal(wrong.status, 401);
    assert.equal(unknown.status, 401);
    assert.deepEqual(wrong.body, unknown.body);
  });

  it('validates the login body', async () => {
    const res = await request(ctx.app).post('/api/v1/auth/login').send({ email: 'not-an-email' });
    assert.equal(res.status, 422);
    assert.equal(res.body.error.code, 'VALIDATION_ERROR');
  });
});

after(() => db.pool.end());
