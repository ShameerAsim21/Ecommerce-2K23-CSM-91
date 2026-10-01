'use strict';
require('dotenv').config();

function required(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name} (see backend/.env.example)`);
  }
  return value;
}

const isTest = process.env.NODE_ENV === 'test';

module.exports = {
  env: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT || 3000),
  databaseUrl: isTest
    ? process.env.TEST_DATABASE_URL || required('DATABASE_URL')
    : required('DATABASE_URL'),
  jwtSecret: process.env.JWT_SECRET || (isTest ? 'test-only-secret-not-for-real-use-0123456789' : required('JWT_SECRET')),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '1h',
  bcryptRounds: Number(process.env.BCRYPT_ROUNDS || (isTest ? 4 : 12)),
};
