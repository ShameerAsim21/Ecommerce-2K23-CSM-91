'use strict';
/**
 * Reproducible demonstration data (npm run seed). Deterministic: it empties the catalog and
 * user tables first, so running it twice on any database gives the same result.
 *
 * Data goes through the same services as the admin API, so the seed itself obeys the business
 * rules (unique slugs, valid combinations, publish-needs-a-SKU, ...).
 *
 *   Categories : 6, three roots, two levels deep
 *   Products   : 4 (Parlor Palm has 3 variants; Cast Iron Plant has none; Aroid mix is a draft)
 *   SKUs       : 6 (PALM-SM-WHITE is out of stock)
 *   Unavailable combination: Parlor Palm "Medium / Terracotta" -> no variant, no SKU exists
 */
const bcrypt = require('bcryptjs');
const config = require('../../src/config');
const db = require('../../src/db');
const categories = require('../../src/services/categories');
const products = require('../../src/services/products');
const variants = require('../../src/services/variants');
const skus = require('../../src/services/skus');

const ADMIN_EMAIL = 'admin@rootandsprout.test';
const CUSTOMER_EMAIL = 'customer@rootandsprout.test';

async function seed({ adminPassword, customerPassword } = {}) {
  if (config.env === 'production') throw new Error('Refusing to seed a production database');
  if (!adminPassword) throw new Error('SEED_ADMIN_PASSWORD is required (see backend/.env.example)');

  await db.query(`TRUNCATE order_items, orders, cart_items, carts, assets, variant_option_values,
    option_values, product_options, skus, variants, products, categories, users RESTART IDENTITY CASCADE`);

  // --- users ---------------------------------------------------------------
  const hash = (pw) => bcrypt.hash(pw, config.bcryptRounds);
  await db.query(
    `INSERT INTO users (full_name, email, password_hash, role) VALUES ($1, $2, $3, 'admin')`,
    ['Nursery Admin', ADMIN_EMAIL, await hash(adminPassword)]
  );
  if (customerPassword) {
    await db.query(
      `INSERT INTO users (full_name, email, password_hash, role, shipping_address) VALUES ($1, $2, $3, 'customer', $4)`,
      ['Sarah Lin', CUSTOMER_EMAIL, await hash(customerPassword), '12 Garden Lane, Karachi']
    );
  }

  // --- category tree (two levels) ------------------------------------------
  const plants = await categories.create({ name: 'Plants', slug: 'plants' });
  const lowLight = await categories.create({ name: 'Low-Light Plants', slug: 'low-light-plants', parent_id: plants.id });
  const petSafe = await categories.create({ name: 'Pet-Friendly Plants', slug: 'pet-friendly-plants', parent_id: plants.id });
  const planters = await categories.create({ name: 'Planters', slug: 'planters' });
  const drainage = await categories.create({ name: 'Drainage Planters', slug: 'drainage-planters', parent_id: planters.id });
  const soil = await categories.create({ name: 'Soil & Substrates', slug: 'soil-substrates' });

  const publish = (id) => products.update(id, { status: 'active' });
  const setSpecs = (id, specs) =>
    db.query('UPDATE products SET specifications = $1::jsonb WHERE id = $2', [JSON.stringify(specs), id]);

  // --- 1. Parlor Palm: 3 valid variants, 1 intentionally unavailable combination ---
  const palm = await products.create({
    name: 'Parlor Palm', slug: 'parlor-palm', category_id: petSafe.id,
    description: 'Pet-safe, low-maintenance palm that tolerates low indirect light.',
  });
  await variants.create(palm.id, { options: { Size: 'Small', Pot: 'Terracotta' } });
  await variants.create(palm.id, { options: { Size: 'Small', Pot: 'White' } });
  await variants.create(palm.id, { options: { Size: 'Medium', Pot: 'White' } });
  // NOTE: Medium / Terracotta is deliberately NOT created: it is not offered.
  await skus.create(palm.id, { code: 'PALM-SM-TERRA', price: '18.50', stock_quantity: 25, options: { Size: 'Small', Pot: 'Terracotta' } });
  await skus.create(palm.id, { code: 'PALM-SM-WHITE', price: '19.00', stock_quantity: 0, options: { Size: 'Small', Pot: 'White' } });
  await skus.create(palm.id, { code: 'PALM-MD-WHITE', price: '27.50', stock_quantity: 12, options: { Size: 'Medium', Pot: 'White' } });
  await setSpecs(palm.id, { light_requirement: 'low_to_bright_indirect', pet_friendly: true, watering_interval_days: 7 });
  await publish(palm.id);

  // --- 2. Cast Iron Plant: no variants, one variant-less SKU ---------------
  const castIron = await products.create({
    name: 'Cast Iron Plant', slug: 'cast-iron-plant', category_id: lowLight.id,
    description: 'Nearly indestructible foliage plant for dim rooms.',
  });
  await skus.create(castIron.id, { code: 'CAST-IRON-STD', price: '22.00', stock_quantity: 18 });
  await setSpecs(castIron.id, { light_requirement: 'low', pet_friendly: true, watering_interval_days: 14 });
  await publish(castIron.id);

  // --- 3. Ceramic Drainage Planter: 2 variants ------------------------------
  const planter = await products.create({
    name: 'Ceramic Drainage Planter', slug: 'ceramic-drainage-planter', category_id: drainage.id,
    description: 'Glazed ceramic planter with drainage hole and saucer.',
  });
  await variants.create(planter.id, { options: { Diameter: '14 cm' } });
  await variants.create(planter.id, { options: { Diameter: '18 cm' } });
  await skus.create(planter.id, { code: 'PLANTER-CER-14', price: '16.00', stock_quantity: 40, options: { Diameter: '14 cm' } });
  await skus.create(planter.id, { code: 'PLANTER-CER-18', price: '21.00', stock_quantity: 30, options: { Diameter: '18 cm' } });
  await setSpecs(planter.id, { material: 'glazed_ceramic', has_drainage_hole: true });
  await publish(planter.id);

  // --- 4. Aroid Potting Mix: a DRAFT with no SKU yet ------------------------
  const mix = await products.create({
    name: 'Aroid Potting Mix 5L', slug: 'aroid-potting-mix-5l', category_id: soil.id,
    description: 'Chunky, fast-draining mix. Awaiting pricing.',
  });
  await setSpecs(mix.id, { volume_litres: 5 });

  return { adminEmail: ADMIN_EMAIL, customerEmail: customerPassword ? CUSTOMER_EMAIL : null };
}

module.exports = { seed, ADMIN_EMAIL, CUSTOMER_EMAIL };

if (require.main === module) {
  seed({ adminPassword: process.env.SEED_ADMIN_PASSWORD, customerPassword: process.env.SEED_CUSTOMER_PASSWORD })
    .then(async (r) => {
      const c = await db.query(`SELECT
        (SELECT count(*) FROM categories) AS categories, (SELECT count(*) FROM products) AS products,
        (SELECT count(*) FROM variants) AS variants, (SELECT count(*) FROM skus) AS skus`);
      console.log('seed complete:', c.rows[0], `admin: ${r.adminEmail}`);
    })
    .catch((err) => { console.error(err.message); process.exitCode = 1; })
    .finally(() => db.pool.end());
}
