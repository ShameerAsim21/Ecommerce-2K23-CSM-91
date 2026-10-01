-- 002_catalog.sql
-- Sprint 2 catalog foundation: categories, products, options, variants, SKUs, assets.
--
-- Custom SQLSTATE codes raised by triggers (mapped to HTTP errors in src/errors.js):
--   RS001  category hierarchy cycle
--   RS002  SKU without variant on a product that has variants
--   RS003  variant added to a product that already has variant-less SKUs

-- ---------------------------------------------------------------- categories
CREATE TABLE categories (
  id          INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  parent_id   INTEGER,
  name        VARCHAR(120) NOT NULL,
  slug        VARCHAR(140) NOT NULL,
  description TEXT,
  is_active   BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT categories_slug_key           UNIQUE (slug),
  CONSTRAINT categories_slug_format_chk    CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  CONSTRAINT categories_name_chk           CHECK (length(btrim(name)) > 0),
  CONSTRAINT categories_not_self_parent_chk CHECK (parent_id IS NULL OR parent_id <> id),
  CONSTRAINT categories_parent_fk FOREIGN KEY (parent_id)
    REFERENCES categories (id) ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX categories_parent_id_idx ON categories (parent_id);

-- A category may never become its own ancestor (CAT01). The CHECK above stops the
-- one-step cycle; this trigger walks the ancestor chain to stop longer cycles.
CREATE FUNCTION rs_prevent_category_cycle() RETURNS trigger AS $$
DECLARE
  cur INTEGER;
BEGIN
  IF NEW.parent_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.parent_id = NEW.id THEN
    RAISE EXCEPTION 'category % cannot be its own parent', NEW.id USING ERRCODE = 'RS001';
  END IF;
  cur := NEW.parent_id;
  WHILE cur IS NOT NULL LOOP
    IF cur = NEW.id THEN
      RAISE EXCEPTION 'category % cannot become its own ancestor', NEW.id USING ERRCODE = 'RS001';
    END IF;
    SELECT parent_id INTO cur FROM categories WHERE id = cur;
  END LOOP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER categories_no_cycle
  BEFORE INSERT OR UPDATE OF parent_id ON categories
  FOR EACH ROW EXECUTE FUNCTION rs_prevent_category_cycle();
CREATE TRIGGER categories_touch BEFORE UPDATE ON categories
  FOR EACH ROW EXECUTE FUNCTION rs_touch_updated_at();

-- ------------------------------------------------------------------ products
CREATE TABLE products (
  id             INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  category_id    INTEGER      NOT NULL,
  name           VARCHAR(160) NOT NULL,
  slug           VARCHAR(180) NOT NULL,
  description    TEXT         NOT NULL DEFAULT '',
  status         VARCHAR(20)  NOT NULL DEFAULT 'draft',
  -- Specification strategy: validated JSONB (see docs/SPRINT_2.md section 3.3).
  -- Sprint 2 only guarantees the top level is a JSON object; per-key validation is Sprint 3.
  specifications JSONB        NOT NULL DEFAULT '{}'::jsonb,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT products_slug_key         UNIQUE (slug),
  CONSTRAINT products_slug_format_chk  CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  CONSTRAINT products_name_chk         CHECK (length(btrim(name)) > 0),
  CONSTRAINT products_status_chk       CHECK (status IN ('draft', 'active', 'archived')),
  CONSTRAINT products_specs_object_chk CHECK (jsonb_typeof(specifications) = 'object'),
  CONSTRAINT products_category_fk FOREIGN KEY (category_id)
    REFERENCES categories (id) ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX products_category_id_idx ON products (category_id);
CREATE INDEX products_status_idx ON products (status);
CREATE TRIGGER products_touch BEFORE UPDATE ON products
  FOR EACH ROW EXECUTE FUNCTION rs_touch_updated_at();

-- ------------------------------------------- options (the axes of a variant)
-- e.g. product "Parlor Palm" has options "Size" and "Pot"; values "Small", "Terracotta"...
CREATE TABLE product_options (
  id         INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  product_id INTEGER     NOT NULL,
  name       VARCHAR(60) NOT NULL,
  position   INTEGER     NOT NULL,
  CONSTRAINT product_options_name_key    UNIQUE (product_id, name),
  CONSTRAINT product_options_position_key UNIQUE (product_id, position),
  CONSTRAINT product_options_id_product_key UNIQUE (id, product_id),
  CONSTRAINT product_options_name_chk    CHECK (length(btrim(name)) > 0),
  CONSTRAINT product_options_position_chk CHECK (position > 0),
  CONSTRAINT product_options_product_fk FOREIGN KEY (product_id)
    REFERENCES products (id) ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE option_values (
  id        INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  option_id INTEGER     NOT NULL,
  value     VARCHAR(60) NOT NULL,
  CONSTRAINT option_values_value_key     UNIQUE (option_id, value),
  CONSTRAINT option_values_id_option_key UNIQUE (id, option_id),
  CONSTRAINT option_values_value_chk     CHECK (length(btrim(value)) > 0),
  CONSTRAINT option_values_option_fk FOREIGN KEY (option_id)
    REFERENCES product_options (id) ON DELETE CASCADE ON UPDATE CASCADE
);

-- ------------------------------------------------------------------ variants
-- A variant is one VALID combination of option values. A combination that is not
-- offered simply has no row here (CAT04): nothing is stored as a fake or zero-stock SKU.
CREATE TABLE variants (
  id              INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  product_id      INTEGER      NOT NULL,
  label           VARCHAR(255) NOT NULL,
  combination_key VARCHAR(255) NOT NULL,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT variants_combination_key UNIQUE (product_id, combination_key),
  CONSTRAINT variants_id_product_key  UNIQUE (id, product_id),
  CONSTRAINT variants_product_fk FOREIGN KEY (product_id)
    REFERENCES products (id) ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TRIGGER variants_touch BEFORE UPDATE ON variants
  FOR EACH ROW EXECUTE FUNCTION rs_touch_updated_at();

-- One value per option per variant, and every referenced option/value must belong to
-- the same product (composite foreign keys make cross-product mixing impossible).
CREATE TABLE variant_option_values (
  variant_id      INTEGER NOT NULL,
  product_id      INTEGER NOT NULL,
  option_id       INTEGER NOT NULL,
  option_value_id INTEGER NOT NULL,
  PRIMARY KEY (variant_id, option_id),
  CONSTRAINT vov_variant_fk FOREIGN KEY (variant_id, product_id)
    REFERENCES variants (id, product_id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT vov_option_fk FOREIGN KEY (option_id, product_id)
    REFERENCES product_options (id, product_id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT vov_value_fk FOREIGN KEY (option_value_id, option_id)
    REFERENCES option_values (id, option_id) ON DELETE NO ACTION ON UPDATE CASCADE
);

-- ---------------------------------------------------------------------- SKUs
-- A SKU is the sellable unit: own code, price and stock. It "materializes" a variant.
-- A product with no variants sells through variant-less SKUs (variant_id IS NULL).
CREATE TABLE skus (
  id             INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  product_id     INTEGER       NOT NULL,
  variant_id     INTEGER,
  code           VARCHAR(64)   NOT NULL,
  price          NUMERIC(10,2) NOT NULL,
  stock_quantity INTEGER       NOT NULL DEFAULT 0,
  is_active      BOOLEAN       NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ   NOT NULL DEFAULT now(),
  CONSTRAINT skus_code_key            UNIQUE (code),
  CONSTRAINT skus_code_format_chk     CHECK (code ~ '^[A-Z0-9]+(-[A-Z0-9]+)*$'),
  CONSTRAINT skus_price_positive_chk  CHECK (price > 0),
  CONSTRAINT skus_stock_nonneg_chk    CHECK (stock_quantity >= 0),
  CONSTRAINT skus_product_fk FOREIGN KEY (product_id)
    REFERENCES products (id) ON DELETE CASCADE ON UPDATE CASCADE,
  -- Composite FK guarantees the variant belongs to the SAME product (MATCH SIMPLE:
  -- not enforced when variant_id is NULL, which is the variant-less case).
  CONSTRAINT skus_variant_fk FOREIGN KEY (variant_id, product_id)
    REFERENCES variants (id, product_id) ON DELETE NO ACTION ON UPDATE CASCADE
);
CREATE INDEX skus_product_id_idx ON skus (product_id);
CREATE INDEX skus_variant_id_idx ON skus (variant_id);
CREATE TRIGGER skus_touch BEFORE UPDATE ON skus
  FOR EACH ROW EXECUTE FUNCTION rs_touch_updated_at();

-- A product is either "simple" (variant-less SKUs) or "variant-based" (every SKU points at
-- a variant). Mixing would create ambiguous combinations (CAT04). The product row is locked
-- so two concurrent inserts cannot slip past each other.
CREATE FUNCTION rs_sku_requires_variant() RETURNS trigger AS $$
BEGIN
  IF NEW.variant_id IS NULL THEN
    PERFORM 1 FROM products WHERE id = NEW.product_id FOR UPDATE;
    IF EXISTS (SELECT 1 FROM variants WHERE product_id = NEW.product_id) THEN
      RAISE EXCEPTION 'product % has variants: the SKU must reference one', NEW.product_id
        USING ERRCODE = 'RS002';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER skus_requires_variant
  BEFORE INSERT OR UPDATE OF variant_id, product_id ON skus
  FOR EACH ROW EXECUTE FUNCTION rs_sku_requires_variant();

CREATE FUNCTION rs_variant_needs_no_simple_sku() RETURNS trigger AS $$
BEGIN
  PERFORM 1 FROM products WHERE id = NEW.product_id FOR UPDATE;
  IF EXISTS (SELECT 1 FROM skus WHERE product_id = NEW.product_id AND variant_id IS NULL) THEN
    RAISE EXCEPTION 'product % already has variant-less SKUs', NEW.product_id
      USING ERRCODE = 'RS003';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER variants_no_simple_sku
  BEFORE INSERT ON variants
  FOR EACH ROW EXECUTE FUNCTION rs_variant_needs_no_simple_sku();

-- -------------------------------------------------------------------- assets
-- Schema only in Sprint 2. Upload and management endpoints belong to Sprint 3.
CREATE TABLE assets (
  id          INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  product_id  INTEGER      NOT NULL,
  variant_id  INTEGER,
  storage_key VARCHAR(500) NOT NULL,
  role        VARCHAR(20)  NOT NULL DEFAULT 'gallery',
  alt_text    VARCHAR(255) NOT NULL DEFAULT '',
  sort_order  INTEGER      NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT assets_role_chk       CHECK (role IN ('primary', 'gallery', 'thumbnail')),
  CONSTRAINT assets_sort_order_chk CHECK (sort_order >= 0),
  CONSTRAINT assets_key_chk        CHECK (length(btrim(storage_key)) > 0),
  CONSTRAINT assets_product_fk FOREIGN KEY (product_id)
    REFERENCES products (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT assets_variant_fk FOREIGN KEY (variant_id, product_id)
    REFERENCES variants (id, product_id) ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX assets_product_id_idx ON assets (product_id);
-- At most one primary product-level image.
CREATE UNIQUE INDEX assets_one_primary_per_product
  ON assets (product_id) WHERE role = 'primary' AND variant_id IS NULL;
