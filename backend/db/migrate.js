'use strict';
/**
 * Minimal SQL migration runner.
 *   node db/migrate.js up      apply pending migrations (each file in its own transaction)
 *   node db/migrate.js reset   DROP the public schema and recreate it (never in production)
 */
const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

async function resetSchema(pool) {
  await pool.query('DROP SCHEMA IF EXISTS public CASCADE');
  await pool.query('CREATE SCHEMA public');
}

async function migrateUp(pool, log = () => {}) {
  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    filename   VARCHAR(255) PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  const applied = new Set((await pool.query('SELECT filename FROM schema_migrations')).rows.map((r) => r.filename));
  const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
  const ran = [];
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
      await client.query('COMMIT');
      log(`applied ${file}`);
      ran.push(file);
    } catch (err) {
      await client.query('ROLLBACK');
      err.message = `Migration ${file} failed: ${err.message}`;
      throw err;
    } finally {
      client.release();
    }
  }
  if (ran.length === 0) log('database is up to date');
  return ran;
}

module.exports = { migrateUp, resetSchema };

if (require.main === module) {
  const config = require('../src/config');
  const command = process.argv[2] || 'up';
  const pool = new Pool({ connectionString: config.databaseUrl });
  (async () => {
    if (command === 'reset') {
      if (config.env === 'production') throw new Error('Refusing to reset a production database');
      await resetSchema(pool);
      console.log('schema reset');
    } else if (command === 'up') {
      await migrateUp(pool, console.log);
    } else {
      throw new Error(`Unknown command "${command}". Use "up" or "reset".`);
    }
  })()
    .catch((err) => {
      console.error(err.message);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}
