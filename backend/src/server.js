'use strict';
const config = require('./config');
const { createApp } = require('./app');
const { pool } = require('./db');

const server = createApp().listen(config.port, () => {
  console.log(`Root & Sprout API listening on http://localhost:${config.port} (${config.env})`);
});

function shutdown() {
  server.close(() => pool.end().then(() => process.exit(0)));
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
