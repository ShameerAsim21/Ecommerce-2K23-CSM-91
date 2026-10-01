'use strict';
const express = require('express');
const helmet = require('helmet');
const db = require('./db');
const { errorHandler, AppError } = require('./errors');

function createApp() {
  const app = express();
  app.use(helmet());
  app.use(express.json({ limit: '100kb' }));

  app.get('/api/v1/health', async (req, res, next) => {
    try {
      await db.query('SELECT 1');
      res.json({ status: 'ok' });
    } catch (err) {
      next(err);
    }
  });

  app.use('/api/v1/auth', require('./routes/auth'));
  app.use('/api/v1/admin', require('./routes/admin'));

  app.use((req, res, next) => next(new AppError(404, 'ROUTE_NOT_FOUND', `No route for ${req.method} ${req.path}`)));
  app.use(errorHandler);
  return app;
}

module.exports = { createApp };
