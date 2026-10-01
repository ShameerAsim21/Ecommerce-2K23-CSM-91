'use strict';
/**
 * Sprint 2 demonstration: an administrator creates a category, product, variants and a SKU, then
 * retrieves them through the administration API. Prints Markdown evidence (tokens redacted).
 *
 *   npm run db:fresh && npm start          # terminal 1
 *   npm run demo                           # terminal 2  (needs a freshly seeded database)
 *
 * Env: API_URL (default http://localhost:3000), SEED_ADMIN_PASSWORD.
 */
require('dotenv').config();

const BASE = process.env.API_URL || `http://localhost:${process.env.PORT || 3000}`;
const ADMIN = { email: 'admin@rootandsprout.test', password: process.env.SEED_ADMIN_PASSWORD };
let token = null;
let step = 0;

const slimNode = (n) => ({ id: n.id, slug: n.slug, is_active: n.is_active, product_count: n.product_count, children: n.children.map(slimNode) });
const slimTree = (json) => ({ data: json.data.map(slimNode) });

const redact = (value) => JSON.parse(JSON.stringify(value, (k, v) => (k === 'token' ? '<redacted>' : v)));

async function call(title, method, path, body, { auth = true, headerNote, display, slimResponse } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth && token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;

  step += 1;
  const out = [`#### ${step}. ${title}`, '', '```http', `${method} ${path}`];
  if (auth && token) out.push('Authorization: Bearer <redacted>');
  else if (headerNote) out.push(headerNote);
  out.push('```', '');
  if (body !== undefined) out.push('Request body:', '', '```json', JSON.stringify(redact(display || body), null, 2), '```', '');
  out.push(`Response \`${res.status}\`${res.headers.get('location') ? ` (Location: \`${res.headers.get('location')}\`)` : ''}:`, '');
  if (json) {
    if (slimResponse) out.push('_(trimmed to id, slug, is_active, product_count and children; timestamps and descriptions omitted)_', '');
    out.push('```json', JSON.stringify(redact(slimResponse ? slimResponse(json) : json), null, 2), '```', '');
  }
  else out.push('_(empty body)_', '');
  console.log(out.join('\n'));
  return { status: res.status, body: json };
}

async function main() {
  if (!ADMIN.password) throw new Error('Set SEED_ADMIN_PASSWORD (same value used for the seed)');

  console.log('### Part A - required demonstration: create a category, product, variants and SKU\n');

  const login = await call('Administrator logs in', 'POST', '/api/v1/auth/login', ADMIN, {
    auth: false, headerNote: '(no Authorization header)', display: { email: ADMIN.email, password: '<redacted>' },
  });
  if (login.status !== 200) throw new Error(`Login failed (${login.status}); is the database seeded with this password?`);
  token = login.body.token;

  const tree = await call('Find the parent category', 'GET', '/api/v1/admin/categories', undefined, { slimResponse: slimTree });
  const plants = tree.body.data.find((c) => c.slug === 'plants');

  const category = await call('Create a category (child of "Plants")', 'POST', '/api/v1/admin/categories', {
    name: 'Succulents', slug: 'succulents', description: 'Water-wise plants for bright windowsills', parent_id: plants.id,
  });
  const product = await call('Create a draft product in that category', 'POST', '/api/v1/admin/products', {
    name: 'Jade Plant', slug: 'jade-plant', category_id: category.body.data.id,
    description: 'Easy-care succulent with thick glossy leaves.',
  });
  const pid = product.body.data.id;
  await call('Add the first variant (this defines the product\'s options)', 'POST', `/api/v1/admin/products/${pid}/variants`, {
    options: { Size: 'Small', Pot: 'Terracotta' },
  });
  await call('Add a second variant', 'POST', `/api/v1/admin/products/${pid}/variants`, {
    options: { Size: 'Medium', Pot: 'Terracotta' },
  });
  await call('Add a SKU for the first variant (looked up by option values)', 'POST', `/api/v1/admin/products/${pid}/skus`, {
    code: 'JADE-SM-TERRA', price: '14.50', stock_quantity: 20, options: { Size: 'Small', Pot: 'Terracotta' },
  });
  await call('Retrieve the product with its variants and SKUs', 'GET', `/api/v1/admin/products/${pid}`);
  await call('List products in the new category', 'GET', `/api/v1/admin/products?category_id=${category.body.data.id}`);
  await call('Retrieve the category tree', 'GET', '/api/v1/admin/categories', undefined, { slimResponse: slimTree });

  console.log('### Part B - rejection examples\n');
  await call('No token', 'GET', '/api/v1/admin/products', undefined, { auth: false, headerNote: '(no Authorization header)' });
  await call('Duplicate product slug', 'POST', '/api/v1/admin/products', { name: 'Another Jade', slug: 'jade-plant', category_id: category.body.data.id });
  await call('Duplicate SKU code (case-insensitive)', 'POST', `/api/v1/admin/products/${pid}/skus`, {
    code: 'jade-sm-terra', price: '15.00', stock_quantity: 1, options: { Size: 'Medium', Pot: 'Terracotta' },
  });
  await call('Combination that is not offered', 'POST', `/api/v1/admin/products/${pid}/skus`, {
    code: 'JADE-LG-TERRA', price: '30.00', stock_quantity: 0, options: { Size: 'Large', Pot: 'Terracotta' },
  });
  const sku = await call('Publish the product (allowed: it has an active SKU)', 'PATCH', `/api/v1/admin/products/${pid}`, { status: 'active' });
  const skuId = sku.body.data.skus[0].id;
  await call('Negative stock adjustment', 'PATCH', `/api/v1/admin/skus/${skuId}`, { stock_delta: -25 });
  await call('Category cycle', 'PATCH', `/api/v1/admin/categories/${plants.id}`, { parent_id: category.body.data.id });
  await call('Invalid price', 'POST', `/api/v1/admin/products/${pid}/skus`, {
    code: 'JADE-BAD', price: '12.999', options: { Size: 'Medium', Pot: 'Terracotta' },
  });
}

main().catch((err) => { console.error(err.message); process.exitCode = 1; });
