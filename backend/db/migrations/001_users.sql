-- 001_users.sql
-- Sprint 1 entity: USERS (kept as designed, now with SQL-compliant types and constraints).
-- Also defines the shared updated_at trigger function used by later migrations.

CREATE FUNCTION rs_touch_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TABLE users (
  id               INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  full_name        VARCHAR(120) NOT NULL,
  email            VARCHAR(255) NOT NULL,
  password_hash    VARCHAR(255) NOT NULL,
  role             VARCHAR(20)  NOT NULL DEFAULT 'customer',
  shipping_address TEXT,
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT users_email_key        UNIQUE (email),
  CONSTRAINT users_email_format_chk CHECK (email = lower(email) AND position('@' IN email) > 1),
  CONSTRAINT users_role_chk         CHECK (role IN ('customer', 'admin')),
  CONSTRAINT users_name_chk         CHECK (length(btrim(full_name)) > 0)
);
