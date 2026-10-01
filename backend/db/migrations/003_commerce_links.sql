-- 003_commerce_links.sql
-- Sprint 1 entities CARTS, CART_ITEMS, ORDERS, ORDER_ITEMS, re-pointed at SKUs.
-- SCHEMA ONLY: Sprint 2 exposes no cart or order behaviour. This migration exists so that
-- Sprint 3 consumes SKU identities through real foreign keys (see docs/SPRINT_2.md).

CREATE TABLE carts (
  id         INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id    INTEGER     NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT carts_user_key UNIQUE (user_id),
  CONSTRAINT carts_user_fk FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE cart_items (
  id       INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  cart_id  INTEGER NOT NULL,
  sku_id   INTEGER NOT NULL,
  quantity INTEGER NOT NULL,
  CONSTRAINT cart_items_cart_sku_key UNIQUE (cart_id, sku_id),
  CONSTRAINT cart_items_quantity_chk CHECK (quantity > 0),
  CONSTRAINT cart_items_cart_fk FOREIGN KEY (cart_id)
    REFERENCES carts (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT cart_items_sku_fk FOREIGN KEY (sku_id)
    REFERENCES skus (id) ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX cart_items_sku_id_idx ON cart_items (sku_id);

CREATE TABLE orders (
  id                INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id           INTEGER       NOT NULL,
  total_amount      NUMERIC(12,2) NOT NULL,
  order_status      VARCHAR(20)   NOT NULL DEFAULT 'pending',
  payment_status    VARCHAR(20)   NOT NULL DEFAULT 'unpaid',
  payment_reference VARCHAR(255),
  shipping_address  TEXT          NOT NULL,
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT now(),
  CONSTRAINT orders_total_chk          CHECK (total_amount >= 0),
  CONSTRAINT orders_status_chk         CHECK (order_status IN ('pending','paid','shipped','delivered','cancelled')),
  CONSTRAINT orders_payment_status_chk CHECK (payment_status IN ('unpaid','paid','failed','refunded')),
  CONSTRAINT orders_user_fk FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX orders_user_id_idx ON orders (user_id);

-- Order lines snapshot the SKU code, product name and unit price at purchase time, so history
-- survives later edits, deactivation, or renaming of catalog rows.
CREATE TABLE order_items (
  id                    INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id              INTEGER       NOT NULL,
  sku_id                INTEGER       NOT NULL,
  sku_code_snapshot     VARCHAR(64)   NOT NULL,
  product_name_snapshot VARCHAR(160)  NOT NULL,
  quantity              INTEGER       NOT NULL,
  unit_price            NUMERIC(10,2) NOT NULL,
  CONSTRAINT order_items_quantity_chk CHECK (quantity > 0),
  CONSTRAINT order_items_price_chk    CHECK (unit_price >= 0),
  CONSTRAINT order_items_order_fk FOREIGN KEY (order_id)
    REFERENCES orders (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT order_items_sku_fk FOREIGN KEY (sku_id)
    REFERENCES skus (id) ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX order_items_order_id_idx ON order_items (order_id);
CREATE INDEX order_items_sku_id_idx ON order_items (sku_id);
