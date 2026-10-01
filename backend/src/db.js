'use strict';
const { Pool } = require('pg');
const config = require('./config');

const pool = new Pool({ connectionString: config.databaseUrl });

/** Run a callback inside a transaction; commit on success, roll back on any error. */
async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (_) {
      /* connection already broken; original error is more useful */
    }
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { pool, withTransaction, query: (text, params) => pool.query(text, params) };
