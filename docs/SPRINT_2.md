# Sprint 2: Catalog Data Foundation

**Project:** Root & Sprout – Curated Botanical Nursery & Care Hub
**Stack (from Sprint 1):** React (not touched this sprint) · Node.js + Express · PostgreSQL
**Document file:** `docs/SPRINT_2.md`

## 1. Sprint goal and scope boundary

**Goal.** A catalog administrator can persist categories, products, variants and SKUs without losing identity, relationship, price or inventory meaning. Sprint 3 (specifications, assets, public reads, publication, cart readiness) builds on these tables.

### Delivered (in scope)

| ID | Capability | Where it is implemented / proven |
|---|---|---|
| CAT01 | Category tree: create, update, deactivate, list; unique slug; optional parent; no cycles | `categories` table + `categories_no_cycle` trigger; `src/services/categories.js`; `tests/categories.test.js`, `tests/models.test.js` |
| CAT02 | Product create/edit with name, slug, description, status, category; globally unique slug | `products` table; `src/services/products.js`; `tests/products.test.js` |
| CAT03 | Zero or more variants, one or more SKUs; SKU has unique code, own price and stock | `variants`, `skus` tables; `tests/skus.test.js`, `tests/variants.test.js` |
| CAT04 | Only valid combinations exist; a missing combination is never a fake or zero-stock SKU | `variants.combination_key` UNIQUE, composite FKs, two triggers (see 5.2); `tests/variants.test.js` |
| CAT05 | Constraints in the database, not just the API | Section 3.4 lists every constraint; `tests/models.test.js` bypasses the API to prove each one |
| CAT06 | Admin writes reject unauthenticated/unauthorized requests | `src/middleware/auth.js`; `tests/authorization.test.js` (all 15 admin endpoints × 3 identities) |

### Deliberately NOT delivered (out of scope, per the Sprint 2 manual)

Dynamic specification editing, asset upload, public catalog search/reads, publication workflows, payments, order placement, shipping and the shopper checkout flow. Two tables exist as **schema only** so the ERD is traceable: `assets` (no endpoints) and the Sprint 1 commerce tables `carts`, `cart_items`, `orders`, `order_items` (no endpoints). `products.specifications` exists as a column and is seeded, but the API cannot write it.

## 2. Sprint 1 decisions reused or changed

Traceable to [`docs/SPRINT_1.md`](SPRINT_1.md).

### Reused unchanged

| Sprint 1 decision | Use in Sprint 2 |
|---|---|
| Domain, persona (Sarah Lin), pain point: plant mortality from missing environmental data | Seed data is plant-care themed; `specifications` JSONB is where light, pet-safety and watering data live |
| React + Node.js/Express + PostgreSQL | Backend is Express on PostgreSQL (`pg`); React arrives with the storefront in Sprint 3 |
| JWT + password hashing, RBAC (Customer vs. Admin) | `bcryptjs` hashes, HS256 JWTs, `users.role` CHECK (`customer`, `admin`), `requireAdmin` middleware |
| PostgreSQL for ACID and row-level locking | Stock changes lock the SKU row (`SELECT … FOR UPDATE`); a concurrency test proves no negative stock |
| Snapshot pricing on `ORDER_ITEMS.unit_price`, shipping-address snapshot on `ORDERS` | Kept; snapshots extended with `sku_code_snapshot` and `product_name_snapshot` |
| Entities Users, Categories, Products, Carts, Cart_Items, Orders, Order_Items | All present in the migrations |
| Redis (optional) | Not used; nothing in Sprint 2 needs caching |

### Changed (with reasons)

| Sprint 1 design | Sprint 2 design | Reason |
|---|---|---|
| `PRODUCTS` held `sku`, `price`, `stock_quantity` | Moved to `SKUS` (`code`, `price`, `stock_quantity`); `PRODUCTS` keeps only identity and content | A product with sizes/pots needs a price and stock **per sellable unit** (CAT03) |
| `CART_ITEMS.product_id → PRODUCTS`, `ORDER_ITEMS.product_id → PRODUCTS` | `sku_id → SKUS` (`ON DELETE RESTRICT`) | A cart line must identify what is actually sold (size, pot, price). Sprint 3 consumes SKU identity instead of duplicating product/pricing logic |
| `PRODUCTS.light_requirement`, `PRODUCTS.is_pet_friendly` columns | Keys inside `products.specifications` JSONB | Sprint 1 chose these as fixed columns, but planters and soil have no light or pet rating; Sprint 3 needs per-category attributes. JSONB (option 1 of the Sprint 2 manual) avoids a sparse column table |
| `PRODUCTS.image_url` | `ASSETS` table (`storage_key`, `role`, `alt_text`, `sort_order`) | Multiple images per product/variant (Sprint 2 data model) |
| Types `string`, `int`, `decimal`, `boolean`, `timestamp` (illustrative) | `VARCHAR(n)`, `INTEGER … GENERATED ALWAYS AS IDENTITY`, `NUMERIC(10,2)`, `BOOLEAN`, `TIMESTAMPTZ` | SQL-compliant types; `TIMESTAMPTZ` stores an unambiguous instant |
| Free-text `role` and `order_status` | CHECK-constrained values | Rejects typos at the database |
| `ORDERS` had no payment fields | Added `payment_status`, `payment_reference` | Sprint 1 checkout feature (Stripe/mock) needs somewhere to record it |
| Restock tracking mentioned in the Admin MVP row | Stock is set with `stock_quantity` or adjusted atomically with `stock_delta`; a history table (`INVENTORY_LOGS`) is **not** built | Out of the Sprint 2 boundary; listed in the Sprint 3 backlog |

## 3. Updated ERD and data dictionary

### 3.1 Diagram

Original Sprint 1 entities (`USERS`, `CARTS`, `CART_ITEMS`, `ORDERS`, `ORDER_ITEMS`) are shown together with the new catalog entities. The connections the manual asks to plan are the last three relationships: **`SKUS → CART_ITEMS`** and **`SKUS → ORDER_ITEMS`**, plus `CARTS`/`ORDERS` through `USERS`. The diagram source is also available as [`docs/erd.mmd`](erd.mmd) and was checked with the Mermaid parser.

```mermaid
erDiagram
    CATEGORIES |o--o{ CATEGORIES : parent_of
    CATEGORIES ||--o{ PRODUCTS : contains
    PRODUCTS ||--o{ PRODUCT_OPTIONS : defines
    PRODUCT_OPTIONS ||--o{ OPTION_VALUES : offers
    PRODUCTS ||--o{ VARIANTS : has
    VARIANTS ||--|{ VARIANT_OPTION_VALUES : composed_of
    PRODUCT_OPTIONS ||--o{ VARIANT_OPTION_VALUES : axis_of
    OPTION_VALUES ||--o{ VARIANT_OPTION_VALUES : chosen_in
    PRODUCTS ||--o{ SKUS : sold_as
    VARIANTS |o--o{ SKUS : materializes
    PRODUCTS ||--o{ ASSETS : displays
    VARIANTS |o--o{ ASSETS : illustrated_by
    USERS ||--o| CARTS : owns
    CARTS ||--o{ CART_ITEMS : contains
    SKUS ||--o{ CART_ITEMS : selected_as
    USERS ||--o{ ORDERS : places
    ORDERS ||--|{ ORDER_ITEMS : contains
    SKUS ||--o{ ORDER_ITEMS : sold_as
    CATEGORIES {
        INTEGER id PK
        INTEGER parent_id FK "nullable, RESTRICT"
        VARCHAR(120) name
        VARCHAR(140) slug UK
        TEXT description
        BOOLEAN is_active
        TIMESTAMPTZ created_at
        TIMESTAMPTZ updated_at
    }
    PRODUCTS {
        INTEGER id PK
        INTEGER category_id FK "NOT NULL, RESTRICT"
        VARCHAR(160) name
        VARCHAR(180) slug UK
        TEXT description
        VARCHAR(20) status "draft, active, archived"
        JSONB specifications "object only"
        TIMESTAMPTZ created_at
        TIMESTAMPTZ updated_at
    }
    PRODUCT_OPTIONS {
        INTEGER id PK
        INTEGER product_id FK "CASCADE"
        VARCHAR(60) name "UK with product_id"
        INTEGER position "UK with product_id"
    }
    OPTION_VALUES {
        INTEGER id PK
        INTEGER option_id FK "CASCADE"
        VARCHAR(60) value "UK with option_id"
    }
    VARIANTS {
        INTEGER id PK
        INTEGER product_id FK "CASCADE"
        VARCHAR(255) label
        VARCHAR(255) combination_key "UK with product_id"
        TIMESTAMPTZ created_at
        TIMESTAMPTZ updated_at
    }
    VARIANT_OPTION_VALUES {
        INTEGER variant_id PK, FK
        INTEGER option_id PK, FK
        INTEGER product_id FK "keeps all parts in one product"
        INTEGER option_value_id FK "NO ACTION"
    }
    SKUS {
        INTEGER id PK
        INTEGER product_id FK "CASCADE"
        INTEGER variant_id FK "nullable, NO ACTION"
        VARCHAR(64) code UK "upper-case"
        NUMERIC(10,2) price "price greater than 0"
        INTEGER stock_quantity "at least 0"
        BOOLEAN is_active
        TIMESTAMPTZ created_at
        TIMESTAMPTZ updated_at
    }
    ASSETS {
        INTEGER id PK
        INTEGER product_id FK "CASCADE"
        INTEGER variant_id FK "nullable, CASCADE"
        VARCHAR(500) storage_key
        VARCHAR(20) role "primary, gallery, thumbnail"
        VARCHAR(255) alt_text
        INTEGER sort_order
        TIMESTAMPTZ created_at
    }
    USERS {
        INTEGER id PK
        VARCHAR(120) full_name
        VARCHAR(255) email UK
        VARCHAR(255) password_hash
        VARCHAR(20) role "customer, admin"
        TEXT shipping_address
        TIMESTAMPTZ created_at
    }
    CARTS {
        INTEGER id PK
        INTEGER user_id FK "UK, CASCADE"
        TIMESTAMPTZ updated_at
    }
    CART_ITEMS {
        INTEGER id PK
        INTEGER cart_id FK "CASCADE"
        INTEGER sku_id FK "RESTRICT"
        INTEGER quantity "greater than 0"
    }
    ORDERS {
        INTEGER id PK
        INTEGER user_id FK "RESTRICT"
        NUMERIC(12,2) total_amount
        VARCHAR(20) order_status
        VARCHAR(20) payment_status
        VARCHAR(255) payment_reference
        TEXT shipping_address
        TIMESTAMPTZ created_at
    }
    ORDER_ITEMS {
        INTEGER id PK
        INTEGER order_id FK "CASCADE"
        INTEGER sku_id FK "RESTRICT"
        VARCHAR(64) sku_code_snapshot
        VARCHAR(160) product_name_snapshot
        INTEGER quantity "greater than 0"
        NUMERIC(10,2) unit_price "price at purchase"
    }
```

### 3.2 Relationships, cardinality and delete/update policy

Every foreign key has an explicit policy. **All `ON UPDATE` policies are `CASCADE`** (identifiers are identity columns and never change; the policy is stated so it is explicit). `NO ACTION` means "reject if still referenced", checked at the end of the statement so a parent's cascading delete can remove its own children first.

| # | Parent → Child | Cardinality | FK (child column) | ON DELETE | Rationale |
|---|---|---|---|---|---|
| 1 | Category → Category | 1 : N, optional parent | `categories.parent_id` | RESTRICT | Never orphan a subtree; deactivate instead |
| 2 | Category → Product | 1 : N | `products.category_id` (NOT NULL) | RESTRICT | A product always has one canonical category |
| 3 | Product → Product option | 1 : N | `product_options.product_id` | CASCADE | Options are part of the product |
| 4 | Product option → Option value | 1 : N | `option_values.option_id` | CASCADE | Values belong to their option |
| 5 | Product → Variant | 1 : N | `variants.product_id` | CASCADE | A variant has no life outside its product |
| 6 | Variant ↔ Option value (via `variant_option_values`) | N : M, one value per option per variant | PK `(variant_id, option_id)` | CASCADE (variant, option) / NO ACTION (value) | A used value cannot be deleted |
| 7 | Product → SKU | 1 : N (at least one before activation) | `skus.product_id` | CASCADE | Deleting a draft removes its SKUs; blocked by rows 13/14 if carted or sold |
| 8 | Variant → SKU | 1 : N, `variant_id` nullable | `skus (variant_id, product_id)` composite | NO ACTION | Cannot delete a variant that still has SKUs; composite key forces the same product |
| 9 | Product → Asset | 1 : N | `assets.product_id` | CASCADE | Schema only in Sprint 2 |
| 10 | Variant → Asset | 1 : N, optional | `assets (variant_id, product_id)` | CASCADE | Variant-specific images go with the variant |
| 11 | User → Cart | 1 : 0..1 | `carts.user_id` UNIQUE | CASCADE | One cart per user |
| 12 | Cart → Cart item | 1 : N | `cart_items.cart_id` | CASCADE | Lines belong to the cart |
| 13 | SKU → Cart item | 1 : N (Product ↔ Cart is N : M through this) | `cart_items.sku_id` | **RESTRICT** | Cannot hard-delete a SKU that is in a cart |
| 14 | SKU → Order item | 1 : N (Product ↔ Order is N : M through this) | `order_items.sku_id` | **RESTRICT** | Sales history is never lost |
| 15 | User → Order | 1 : N | `orders.user_id` | RESTRICT | Orders outlive accounts until explicitly handled |
| 16 | Order → Order item | 1 : N (at least one) | `order_items.order_id` | CASCADE | Lines belong to the order |

**Variant vs. SKU.** A *variant* is one valid **combination of option values** that a shopper can choose (e.g. `Small / Terracotta`). A *SKU* is the **sellable stock-keeping unit** that materializes a variant: it has its own code, price and stock. A product with no variants sells through variant-less SKUs (`variant_id IS NULL`). In the seed data every variant has exactly one SKU; the model allows several (for example different suppliers or batches of the same choice).

### 3.3 Specification strategy (validated JSONB) and its written validation rule

The Sprint 1 EAV alternative was not selected; Sprint 2 uses **JSONB on `products.specifications`**.

> **Validation rule.** `specifications` must be a **JSON object** (never an array, string or number). This is enforced by the database CHECK `products_specs_object_chk` (`jsonb_typeof(specifications) = 'object'`). The column defaults to `{}`. Keys are `snake_case` strings; values are strings, numbers or booleans (for example `{"light_requirement": "low", "pet_friendly": true, "watering_interval_days": 14}`). Per-category key/type validation (for example "plants require `pet_friendly` as boolean") is **Sprint 3 work**, because specification editing is out of scope now.

### 3.4 Data dictionary

`PK` primary key · `FK` foreign key · `UQ` unique · `NN` NOT NULL · money is `NUMERIC(10,2)` (exact decimal, never floating point).

**categories**

| Column | Type | Constraints |
|---|---|---|
| id | INTEGER identity | PK |
| parent_id | INTEGER | FK → categories(id) RESTRICT; CHECK `parent_id <> id`; cycle trigger |
| name | VARCHAR(120) | NN, not blank |
| slug | VARCHAR(140) | NN, UQ (`categories_slug_key`), CHECK `^[a-z0-9]+(-[a-z0-9]+)*$` |
| description | TEXT | |
| is_active | BOOLEAN | NN, default TRUE |
| created_at / updated_at | TIMESTAMPTZ | NN, default `now()`; `updated_at` maintained by trigger |

**products**

| Column | Type | Constraints |
|---|---|---|
| id | INTEGER identity | PK |
| category_id | INTEGER | NN, FK → categories(id) RESTRICT |
| name | VARCHAR(160) | NN, not blank |
| slug | VARCHAR(180) | NN, UQ (`products_slug_key`), slug format CHECK |
| description | TEXT | NN, default `''` |
| status | VARCHAR(20) | NN, default `'draft'`, CHECK in (`draft`, `active`, `archived`) |
| specifications | JSONB | NN, default `{}`, CHECK is object (3.3) |
| created_at / updated_at | TIMESTAMPTZ | NN |

**product_options** — `id` PK; `product_id` FK CASCADE; `name` VARCHAR(60); `position` INTEGER (> 0). UQ `(product_id, name)`, UQ `(product_id, position)`, UQ `(id, product_id)`.

**option_values** — `id` PK; `option_id` FK CASCADE; `value` VARCHAR(60). UQ `(option_id, value)`, UQ `(id, option_id)`.

**variants**

| Column | Type | Constraints |
|---|---|---|
| id | INTEGER identity | PK |
| product_id | INTEGER | NN, FK → products CASCADE |
| label | VARCHAR(255) | NN, human label such as `Small / Terracotta` |
| combination_key | VARCHAR(255) | NN, **UQ with product_id**: the same combination cannot exist twice |
| created_at / updated_at | TIMESTAMPTZ | NN |

Extra: UQ `(id, product_id)` (target of composite FKs). Trigger `variants_no_simple_sku`.

**variant_option_values** — PK `(variant_id, option_id)` (one value per option). Composite FKs `(variant_id, product_id) → variants`, `(option_id, product_id) → product_options`, `(option_value_id, option_id) → option_values`: it is impossible to attach an option or value from another product.

**skus**

| Column | Type | Constraints |
|---|---|---|
| id | INTEGER identity | PK |
| product_id | INTEGER | NN, FK → products CASCADE |
| variant_id | INTEGER | nullable; composite FK `(variant_id, product_id) → variants(id, product_id)` NO ACTION |
| code | VARCHAR(64) | NN, **UQ** (`skus_code_key`), CHECK `^[A-Z0-9]+(-[A-Z0-9]+)*$` (upper-case only, so case cannot hide a duplicate) |
| price | NUMERIC(10,2) | NN, CHECK `price > 0` |
| stock_quantity | INTEGER | NN, default 0, CHECK `stock_quantity >= 0` |
| is_active | BOOLEAN | NN, default TRUE |
| created_at / updated_at | TIMESTAMPTZ | NN |

Triggers: `skus_requires_variant` (RS002), `skus_touch`.

**assets** (schema only) — `id` PK; `product_id` FK CASCADE; `variant_id` nullable composite FK CASCADE; `storage_key` VARCHAR(500); `role` CHECK in (`primary`, `gallery`, `thumbnail`); `alt_text` VARCHAR(255); `sort_order` INTEGER ≥ 0. Partial UQ index: at most one product-level `primary` asset per product.

**users** — `id` PK; `full_name` VARCHAR(120); `email` VARCHAR(255) UQ, lower-case CHECK; `password_hash` VARCHAR(255) (bcrypt); `role` CHECK in (`customer`, `admin`); `shipping_address` TEXT; `created_at`.

**carts / cart_items / orders / order_items** (schema only) — as in the diagram: UQ `carts.user_id`; UQ `(cart_id, sku_id)`; `quantity > 0`; `total_amount >= 0`; status columns CHECK-constrained; order lines snapshot `sku_code_snapshot`, `product_name_snapshot`, `unit_price`.

### 3.5 Migrations
| File | Contents |
|---|---|
| `backend/db/migrations/001_users.sql` | `rs_touch_updated_at()` function, `users` |
| `backend/db/migrations/002_catalog.sql` | categories, products, options, variants, SKUs, assets, all triggers |
| `backend/db/migrations/003_commerce_links.sql` | carts, cart_items, orders, order_items pointing at SKUs |

Each file runs in its own transaction and is recorded in `schema_migrations`; `npm run migrate` is idempotent.

Custom error codes raised by triggers: `RS001` category cycle · `RS002` SKU without variant on a product that has variants · `RS003` variant added to a product that already has variant-less SKUs.

## 4. Administration routes

All routes are under `/api/v1`. Base URL locally: `http://localhost:3000`. JSON in, JSON out.

### 4.1 Conventions

**Authentication.** `POST /api/v1/auth/login` `{ "email", "password" }` → `200 { "token", "token_type": "Bearer", "user" }`. Send `Authorization: Bearer <token>` on every admin call. Tokens are HS256 JWTs, valid 1 hour. The role is **re-read from the database on every request**, so a demoted or deleted admin loses access immediately.

**Success shapes.** Single record: `{ "data": {…} }`. Lists: `{ "data": [...], "meta": {…} }`. Creates return `201` with a `Location` header. Deletes return `204` with no body.

**Error shape (every failure).**

```json
{ "error": { "code": "DUPLICATE_SKU_CODE", "message": "A SKU with this code already exists",
             "details": [ { "field": "code", "message": "A SKU with this code already exists" } ] } }
```

| Status | Meaning | Typical `code` |
|---|---|---|
| 400 | Malformed request (bad JSON, non-integer id) | `INVALID_JSON`, `INVALID_ID` |
| 401 | Missing, invalid, expired token, or deleted account | `UNAUTHENTICATED` |
| 403 | Authenticated but not an administrator | `FORBIDDEN` |
| 404 | Record or route not found | `NOT_FOUND`, `ROUTE_NOT_FOUND` |
| 409 | Conflict with current state: duplicate, still referenced, illegal transition | `DUPLICATE_SLUG`, `DUPLICATE_SKU_CODE`, `DUPLICATE_VARIANT`, `IN_USE`, `NO_ACTIVE_SKU`, `LAST_ACTIVE_SKU`, `PARENT_INACTIVE`, `CATEGORY_INACTIVE`, `PRODUCT_ACTIVE`, `PRODUCT_HAS_SIMPLE_SKU` |
| 422 | Well-formed but invalid data | `VALIDATION_ERROR` (with per-field `details`), `CATEGORY_CYCLE`, `NEGATIVE_STOCK`, `COMBINATION_NOT_AVAILABLE`, `VARIANT_REQUIRED`, `OPTION_SET_MISMATCH`, `PARENT_NOT_FOUND`, `CATEGORY_NOT_FOUND`, `VARIANT_NOT_FOUND` |
| 500 | Unexpected; logged server-side, **never** returns a stack trace | `INTERNAL_ERROR` |

Unknown JSON fields are rejected (422), not silently ignored. Money is sent as a decimal string or number with ≤ 2 decimals and always returned as a string (`"14.50"`).

### 4.2 Required baseline routes

| Method | Route | Purpose | Auth |
|---|---|---|---|
| POST | `/api/v1/admin/products` | Create a draft product | admin |
| PATCH | `/api/v1/admin/products/:id` | Update content or status | admin |
| POST | `/api/v1/admin/products/:id/skus` | Add a validated SKU | admin |
| PATCH | `/api/v1/admin/skus/:id` | Update price, stock or active status | admin |
| GET | `/api/v1/admin/products` | List administrative product records | admin |
| POST | `/api/v1/admin/categories` | Create a category | admin |
| GET | `/api/v1/admin/categories` | Return the category tree | admin |

### 4.3 Additional routes (complete CRUD)

| Method | Route | Purpose |
|---|---|---|
| POST | `/api/v1/auth/login` | Obtain a token (no auth required) |
| GET | `/api/v1/health` | Liveness check (no auth required) |
| PATCH | `/api/v1/admin/categories/:id` | Rename, re-slug, re-parent, activate/deactivate |
| DELETE | `/api/v1/admin/categories/:id` | Delete an empty leaf category |
| GET | `/api/v1/admin/products/:id` | Full detail: category, options, variants, SKUs |
| DELETE | `/api/v1/admin/products/:id` | Delete a non-active product never sold or carted |
| POST | `/api/v1/admin/products/:id/variants` | Add a valid option combination |
| DELETE | `/api/v1/admin/variants/:id` | Delete a variant with no SKUs |
| GET | `/api/v1/admin/skus/:id` | Read one SKU |
| DELETE | `/api/v1/admin/skus/:id` | Delete a SKU not in any cart or order |

### 4.4 Contract per endpoint

Real request/response examples are in section 6.3 (evidence numbers): category create #3, category tree #2 and #10, product create #4, product update #15, product list #9, variant create #5, SKU create #7, rejection cases #11–#18. The tables below give fields and codes; `PATCH /skus/:id` has its success example inline.

#### `POST /api/v1/admin/categories`

| Field | Type | Rules |
|---|---|---|
| `name` | string | required, 1–120 chars |
| `slug` | string | required, lower-case letters/digits/hyphens, ≤ 140, unique |
| `description` | string \| null | optional, ≤ 2000 |
| `parent_id` | integer \| null | optional; must exist and be active |
| `is_active` | boolean | optional, default `true` |

Responses: **201** `{data: category}` · 401 · 403 · 409 `DUPLICATE_SLUG`, `PARENT_INACTIVE` · 422 `VALIDATION_ERROR`, `PARENT_NOT_FOUND`.

#### `GET /api/v1/admin/categories`

No parameters. **200** `{data: [ {id, parent_id, name, slug, description, is_active, product_count, created_at, updated_at, children: […]} ]}` — nested tree, inactive categories included and flagged. 401 · 403.

#### `PATCH /api/v1/admin/categories/:id`

Any of `name`, `slug`, `description`, `parent_id`, `is_active` (at least one). **200** returns the category plus `deactivated_descendants` (count) · 404 · 409 `DUPLICATE_SLUG`, `PARENT_INACTIVE` · 422 `CATEGORY_CYCLE`, `VALIDATION_ERROR`.

#### `POST /api/v1/admin/products`

| Field | Type | Rules |
|---|---|---|
| `name` | string | required, ≤ 160 |
| `slug` | string | required, unique, slug format, ≤ 180 |
| `description` | string | optional, ≤ 10000 |
| `category_id` | integer | required; must exist and be active |

`status` is not accepted: new products are always `draft`. Responses: **201** `{data: product detail}` · 409 `DUPLICATE_SLUG`, `CATEGORY_INACTIVE` · 422 `VALIDATION_ERROR`, `CATEGORY_NOT_FOUND`.

#### `PATCH /api/v1/admin/products/:id`

Any of `name`, `slug`, `description`, `category_id`, `status` (`draft`|`active`|`archived`). **200** product detail · 404 · 409 `DUPLICATE_SLUG`, `CATEGORY_INACTIVE`, `NO_ACTIVE_SKU` (setting `active` without an active SKU) · 422.

#### `GET /api/v1/admin/products`

Query: `page` (default 1), `page_size` (1–100, default 20), `status`, `category_id`, `q` (name/slug contains). **200** `{data: [ {id, name, slug, status, category_id, category_name, category_slug, variant_count, sku_count, in_stock_sku_count, min_price, max_price, …} ], meta: {page, page_size, total}}` · 422 for bad query values.

#### `POST /api/v1/admin/products/:id/variants`

Body `{ "options": { "Size": "Small", "Pot": "Terracotta" } }` (1–3 options). The **first** variant defines the product's option names; later variants must use exactly the same names. **201** `{data: {id, product_id, label, options, created_at}}` · 404 · 409 `DUPLICATE_VARIANT`, `PRODUCT_HAS_SIMPLE_SKU` · 422 `OPTION_SET_MISMATCH`, `VALIDATION_ERROR`.

#### `POST /api/v1/admin/products/:id/skus`

| Field | Type | Rules |
|---|---|---|
| `code` | string | required, stored upper-case, `A-Z 0-9` and single hyphens, ≤ 64, unique |
| `price` | decimal string \| number | required, > 0, ≤ 2 decimals |
| `stock_quantity` | integer | optional, default 0, 0 – 1,000,000 |
| `is_active` | boolean | optional, default `true` |
| `variant_id` **or** `options` | integer **or** object | required when the product has variants; forbidden otherwise. Never both |

**201** `{data: sku}` with `availability` (`in_stock` \| `out_of_stock` \| `inactive`) · 404 · 409 `DUPLICATE_SKU_CODE` · 422 `VALIDATION_ERROR`, `VARIANT_REQUIRED`, `COMBINATION_NOT_AVAILABLE`, `VARIANT_NOT_FOUND`.

#### `PATCH /api/v1/admin/skus/:id`

`price`, `is_active`, and **either** `stock_quantity` (absolute, ≥ 0) **or** `stock_delta` (signed, non-zero; applied atomically). The `code` is immutable and rejected. **200** `{data: sku}` · 404 · 409 `LAST_ACTIVE_SKU` · 422 `VALIDATION_ERROR`, `NEGATIVE_STOCK`. Example (real output, seeded SKU 1, 25 in stock):
```text
PATCH /api/v1/admin/skus/1  {"price": "19.25", "stock_delta": -5}  ->  200 OK
{"data": {"id": 1, "product_id": 1, "variant_id": 1, "variant_label": "Small / Terracotta", "code": "PALM-SM-TERRA", "price": "19.25", "stock_quantity": 20, "is_active": true, "availability": "in_stock"}}
```
#### Delete routes

`DELETE` of a category / product / variant / SKU → **204**; 404 if missing; **409 `IN_USE`** when other rows still reference it; 409 `PRODUCT_ACTIVE` / `LAST_ACTIVE_SKU` for the state guards in 5.1.

## 5. Data integrity and authorization decisions

### 5.1 Answers to the required business questions

Each answer is backed by an automated test (file in brackets) and, where useful, an example in section 6.

1. **Can a draft product have no SKU? Can a published product have no sellable SKU?**
   A **draft may have no SKU**: seed product *Aroid Potting Mix 5L* is exactly that. A product **cannot become `active` without at least one active SKU** (409 `NO_ACTIVE_SKU`), and an active product cannot lose its last active SKU by deactivation or deletion (409 `LAST_ACTIVE_SKU`); archive it first. An archived product may have none. *(products.test.js "publish rules", skus.test.js "an active product keeps at least one active SKU")*. The publication *workflow* (review, scheduling) is Sprint 3; this is only the data-consistency guard.

2. **One canonical category, many, or both?**
   **One canonical category** (`products.category_id NOT NULL`). Slugs, breadcrumbs and admin lists stay unambiguous, and the seed tree is small. Many-to-many merchandising ("also show under Pet-Friendly") is deferred: it will be an additive `product_categories(product_id, category_id)` join table in Sprint 3 without changing the canonical column.

3. **What happens when a parent category is deactivated?**
   All descendants are **deactivated in the same transaction** (response reports `deactivated_descendants`). Products are **kept**, not deleted or moved, and their detail shows `category.is_active = false`. New products cannot be assigned to an inactive category (409), a child cannot be created under or reactivated beneath an inactive parent (409 `PARENT_INACTIVE`), and reactivating a parent does **not** silently reactivate its children. *(categories.test.js "deactivation")*

4. **How is an out-of-stock SKU represented in a public response?**
   The public catalog is Sprint 3, but the representation is fixed now: a SKU is returned with `availability: "out_of_stock"` (stock 0), `"in_stock"` (stock > 0) or `"inactive"`, computed in `src/services/skus.js`. It is **not hidden and not deleted**, so a storefront can show "Sold out" or "Notify me". Public responses should expose the `availability` label, not the raw `stock_quantity`. Seed SKU `PALM-SM-WHITE` demonstrates it.

5. **Can two SKUs share a price? Can a SKU have a price override?**
   Yes, prices may be equal (no uniqueness). There is **no product-level base price**: every SKU owns its price, so each SKU *is* its own price and no separate "override" field is needed (Sprint 2 has no promotions). A future sale price would be a new column or table, not a change to this one. *(skus.test.js "two SKUs MAY share a price")*

6. **What prevents negative stock and duplicate SKU codes?**
   *Negative stock:* three layers. (a) API validation rejects negative or non-integer `stock_quantity` (422); (b) `stock_delta` is applied under a row lock and refused if the result would be < 0 (422 `NEGATIVE_STOCK`); (c) the database CHECK `skus_stock_nonneg_chk` rejects it regardless of the caller. A test fires 12 simultaneous `-1` adjustments at stock 5 and asserts exactly 5 succeed and stock ends at 0. *Duplicate codes:* UNIQUE `skus_code_key`, plus a CHECK forcing upper-case so `abc-1` and `ABC-1` collide; the API also upper-cases input. Translated to 409 `DUPLICATE_SKU_CODE`. *(models.test.js, skus.test.js)*

7. **What happens to a product referenced by a future cart or order after it is deactivated?**
   Carts and orders reference **SKUs** with `ON DELETE RESTRICT`, so a referenced SKU or its product **cannot be hard-deleted** (409 `IN_USE`); the supported action is to **deactivate/archive**. History is unaffected: order lines keep `sku_code_snapshot`, `product_name_snapshot` and `unit_price`. A cart line pointing at a deactivated SKU stays valid data; Sprint 3 will show it as unavailable at cart read time. *(models.test.js "delete/update policies", products.test.js "never be deleted, only archived")*

### 5.2 Valid combinations only (CAT04)

Nothing is generated from a cartesian product of options. Only combinations the admin explicitly creates exist as `variants` rows, and a SKU can only attach to an existing variant.

* **The missing combination stays missing.** Parlor Palm offers *Small/Terracotta*, *Small/White*, *Medium/White*. *Medium/Terracotta* has **no variant and no SKU row**. Asking for a SKU with those options returns 422 `COMBINATION_NOT_AVAILABLE` and writes nothing.
* **Duplicates impossible:** UNIQUE `(product_id, combination_key)`.
* **Mixed models impossible:** a product with variants cannot have a variant-less "default" SKU (trigger RS002, otherwise it would act as a fake catch-all) and a product with variant-less SKUs cannot gain variants (RS003). Both triggers lock the product row so concurrent requests cannot race past them.
* **Cross-product mixing impossible:** composite foreign keys tie variants, options, option values and SKUs to the same `product_id`.

### 5.3 Authorization

* Every route under `/api/v1/admin` passes two middleware: `authenticate` (valid HS256 token whose user still exists → else **401**) and `requireAdmin` (current database role is `admin` → else **403**).
* The role in the token is **ignored**; the database role is used. A customer holding a forged `admin` claim still gets 403 *(test)*. Tokens with `alg: none`, wrong signature or expired are 401 *(tests)*.
* Login gives the same 401 message for an unknown email and a wrong password and compares against a dummy hash for unknown emails to blunt account enumeration.
* Passwords are bcrypt-hashed (`bcryptjs`), never returned. Secrets come from environment variables; `.env` is git-ignored.
* Queries are parameterized (`pg` placeholders); the product search escapes `%` and `_`.

### 5.4 Where each rule is enforced

| Rule | API validation (zod / services) | Database |
|---|---|---|
| Unique category/product slug | 409 message | UNIQUE + format CHECK |
| Unique SKU code | 409 message, upper-cased | UNIQUE + upper-case CHECK |
| Non-negative stock | 422, atomic delta under row lock | CHECK `stock_quantity >= 0` |
| Positive exact price | decimal-string regex, no floats | `NUMERIC(10,2)` + CHECK `> 0` |
| No category cycles | 422 `CATEGORY_CYCLE` | CHECK + `categories_no_cycle` trigger |
| Valid combinations only | option-set and existence checks | UNIQUE + composite FKs + RS002/RS003 |
| Referential integrity | 422/409 messages | FKs with explicit delete policies |
| Product status values | enum | CHECK |

## 6. Seed data and demonstration

### 6.1 Reproducing the demonstration on a clean database

```bash
cd backend && cp .env.example .env   # set DATABASE_URL, JWT_SECRET, SEED_ADMIN_PASSWORD
npm install && npm run db:fresh        # drop schema -> migrate -> seed
npm start                              # terminal 1
npm run demo                           # terminal 2, prints the evidence below
```

The seed is deterministic: it empties the tables with `RESTART IDENTITY`, so ids are identical on every run *(seed.test.js "is reproducible")*. It goes through the same services as the admin API, so seed data obeys the same business rules. It refuses to run when `NODE_ENV=production`.

### 6.2 What the seed contains

| Requirement | Seed content |
|---|---|
| ≥ 2 category levels, ≥ 2 categories | 6 categories: `Plants` → `Low-Light Plants`, `Pet-Friendly Plants`; `Planters` → `Drainage Planters`; `Soil & Substrates` |
| ≥ 3 products | 4: Parlor Palm, Cast Iron Plant, Ceramic Drainage Planter, Aroid Potting Mix 5L (draft) |
| Product with multiple variants | Parlor Palm: 3 variants (Size × Pot); Ceramic Drainage Planter: 2 (Diameter) |
| ≥ 4 valid SKUs | 6 SKUs |
| Intentionally unavailable combination | Parlor Palm **Medium / Terracotta**: no variant, no SKU |
| Unavailable (out-of-stock) SKU | `PALM-SM-WHITE`, stock 0, `availability: out_of_stock` |
| Variant-less product | Cast Iron Plant (one default SKU `CAST-IRON-STD`) |
| Draft without SKU | Aroid Potting Mix 5L |

| SKU code | Product | Variant | Price | Stock |
|---|---|---|---|---|
| `PALM-SM-TERRA` | Parlor Palm | Small / Terracotta | 18.50 | 25 |
| `PALM-SM-WHITE` | Parlor Palm | Small / White | 19.00 | **0** |
| `PALM-MD-WHITE` | Parlor Palm | Medium / White | 27.50 | 12 |
| *(none)* | Parlor Palm | ~~Medium / Terracotta~~ | not offered | n/a |
| `CAST-IRON-STD` | Cast Iron Plant | none | 22.00 | 18 |
| `PLANTER-CER-14` | Ceramic Drainage Planter | 14 cm | 16.00 | 40 |
| `PLANTER-CER-18` | Ceramic Drainage Planter | 18 cm | 21.00 | 30 |

Seeded accounts: `admin@rootandsprout.test` (password from `SEED_ADMIN_PASSWORD`); optionally `customer@rootandsprout.test` (`SEED_CUSTOMER_PASSWORD`).

### 6.3 Demonstration: administrator creates and retrieves records

Captured by `npm run demo` on a freshly seeded database (`npm run db:fresh`). Every call except #1 and #11 sends `Authorization: Bearer <redacted>`; the login password is masked and no private URLs appear. Ids depend on the seed (categories 1–6, products 1–4). `created_at`/`updated_at` fields are omitted for brevity, and responses #2 and #10 are trimmed to id/slug/is_active/product_count/children. Run the demo yourself for the full untrimmed JSON.

**Part A — required demonstration (steps 1–10).** **Part B — rejection paths (steps 11–18).**

```text
#1 Administrator logs in
POST /api/v1/auth/login  ->  200 OK
  request : {"email": "admin@rootandsprout.test", "password": "<redacted>"}
  response: {"token": "<redacted>", "token_type": "Bearer", "user": {"id": 1, "full_name": "Nursery Admin", "email": "admin@rootandsprout.test", "role": "admin"}}

#2 Find the parent category
GET /api/v1/admin/categories  ->  200 OK
  response: {"data": [{"id": 4, "slug": "planters", "is_active": true, "product_count": 0, "children": [{"id": 5, "slug": "drainage-planters", "is_active": true, "product_count": 1, "children": []}]}, {"id": 1, "slug": "plants", "is_active": true, "product_count": 0, "children": [{"id": 2, "slug": "low-light-plants", "is_active": true, "product_count": 1, "children": []}, {"id": 3, "slug": "pet-friendly-plants", "is_active": true, "product_count": 1, "children": []}]}, {"id": 6, "slug": "soil-substrates", "is_active": true, "product_count": 1, "children": []}]}

#3 Create a category (child of "Plants")
POST /api/v1/admin/categories  ->  201 Created (Location: /api/v1/admin/categories/7)
  request : {"name": "Succulents", "slug": "succulents", "description": "Water-wise plants for bright windowsills", "parent_id": 1}
  response: {"data": {"id": 7, "parent_id": 1, "name": "Succulents", "slug": "succulents", "description": "Water-wise plants for bright windowsills", "is_active": true}}

#4 Create a draft product in that category
POST /api/v1/admin/products  ->  201 Created (Location: /api/v1/admin/products/5)
  request : {"name": "Jade Plant", "slug": "jade-plant", "category_id": 7, "description": "Easy-care succulent with thick glossy leaves."}
  response: {"data": {"id": 5, "category_id": 7, "name": "Jade Plant", "slug": "jade-plant", "description": "Easy-care succulent with thick glossy leaves.", "status": "draft", "specifications": {}, "category": {"id": 7, "name": "Succulents", "slug": "succulents", "is_active": true}, "options": [], "variants": [], "skus": []}}

#5 Add the first variant (this defines the product's options)
POST /api/v1/admin/products/5/variants  ->  201 Created
  request : {"options": {"Size": "Small", "Pot": "Terracotta"}}
  response: {"data": {"id": 6, "product_id": 5, "label": "Small / Terracotta", "options": {"Size": "Small", "Pot": "Terracotta"}}}

#6 Add a second variant
POST /api/v1/admin/products/5/variants  ->  201 Created
  request : {"options": {"Size": "Medium", "Pot": "Terracotta"}}
  response: {"data": {"id": 7, "product_id": 5, "label": "Medium / Terracotta", "options": {"Size": "Medium", "Pot": "Terracotta"}}}

#7 Add a SKU for the first variant (looked up by option values)
POST /api/v1/admin/products/5/skus  ->  201 Created (Location: /api/v1/admin/skus/7)
  request : {"code": "JADE-SM-TERRA", "price": "14.50", "stock_quantity": 20, "options": {"Size": "Small", "Pot": "Terracotta"}}
  response: {"data": {"id": 7, "product_id": 5, "variant_id": 6, "variant_label": "Small / Terracotta", "code": "JADE-SM-TERRA", "price": "14.50", "stock_quantity": 20, "is_active": true, "availability": "in_stock"}}

#8 Retrieve the product with its variants and SKUs
GET /api/v1/admin/products/5  ->  200 OK
  response: {"data": {"id": 5, "category_id": 7, "name": "Jade Plant", "slug": "jade-plant", "description": "Easy-care succulent with thick glossy leaves.", "status": "draft", "specifications": {}, "category": {"id": 7, "name": "Succulents", "slug": "succulents", "is_active": true}, "options": [{"name": "Size", "values": ["Small", "Medium"]}, {"name": "Pot", "values": ["Terracotta"]}], "variants": [{"id": 6, "label": "Small / Terracotta", "options": {"Size": "Small", "Pot": "Terracotta"}}, {"id": 7, "label": "Medium / Terracotta", "options": {"Size": "Medium", "Pot": "Terracotta"}}], "skus": [{"id": 7, "product_id": 5, "variant_id": 6, "variant_label": "Small / Terracotta", "code": "JADE-SM-TERRA", "price": "14.50", "stock_quantity": 20, "is_active": true, "availability": "in_stock"}]}}

#9 List products in the new category
GET /api/v1/admin/products?category_id=7  ->  200 OK
  response: {"data": [{"id": 5, "name": "Jade Plant", "slug": "jade-plant", "status": "draft", "category_id": 7, "category_name": "Succulents", "category_slug": "succulents", "variant_count": 2, "sku_count": 1, "in_stock_sku_count": 1, "min_price": "14.50", "max_price": "14.50"}], "meta": {"page": 1, "page_size": 20, "total": 1}}

#10 Retrieve the category tree
GET /api/v1/admin/categories  ->  200 OK
  response: {"data": [{"id": 4, "slug": "planters", "is_active": true, "product_count": 0, "children": [{"id": 5, "slug": "drainage-planters", "is_active": true, "product_count": 1, "children": []}]}, {"id": 1, "slug": "plants", "is_active": true, "product_count": 0, "children": [{"id": 2, "slug": "low-light-plants", "is_active": true, "product_count": 1, "children": []}, {"id": 3, "slug": "pet-friendly-plants", "is_active": true, "product_count": 1, "children": []}, {"id": 7, "slug": "succulents", "is_active": true, "product_count": 1, "children": []}]}, {"id": 6, "slug": "soil-substrates", "is_active": true, "product_count": 1, "children": []}]}

#11 No token
GET /api/v1/admin/products  ->  401 Unauthorized
  response: {"error": {"code": "UNAUTHENTICATED", "message": "Missing or malformed Authorization header"}}

#12 Duplicate product slug
POST /api/v1/admin/products  ->  409 Conflict
  request : {"name": "Another Jade", "slug": "jade-plant", "category_id": 7}
  response: {"error": {"code": "DUPLICATE_SLUG", "message": "A product with this slug already exists", "details": [{"field": "slug", "message": "A product with this slug already exists"}]}}

#13 Duplicate SKU code (case-insensitive)
POST /api/v1/admin/products/5/skus  ->  409 Conflict
  request : {"code": "jade-sm-terra", "price": "15.00", "stock_quantity": 1, "options": {"Size": "Medium", "Pot": "Terracotta"}}
  response: {"error": {"code": "DUPLICATE_SKU_CODE", "message": "A SKU with this code already exists", "details": [{"field": "code", "message": "A SKU with this code already exists"}]}}

#14 Combination that is not offered
POST /api/v1/admin/products/5/skus  ->  422 Unprocessable Entity
  request : {"code": "JADE-LG-TERRA", "price": "30.00", "stock_quantity": 0, "options": {"Size": "Large", "Pot": "Terracotta"}}
  response: {"error": {"code": "COMBINATION_NOT_AVAILABLE", "message": "This option combination is not offered for the product; create the variant first", "details": [{"field": "options", "message": "product options: Size, Pot"}]}}

#15 Publish the product (allowed: it has an active SKU)
PATCH /api/v1/admin/products/5  ->  200 OK
  request : {"status": "active"}
  response: {"data": {"id": 5, "slug": "jade-plant", "status": "active", "…": "same fields as #8"}}

#16 Negative stock adjustment
PATCH /api/v1/admin/skus/7  ->  422 Unprocessable Entity
  request : {"stock_delta": -25}
  response: {"error": {"code": "NEGATIVE_STOCK", "message": "Adjustment of -25 would make stock negative (current: 20)", "details": [{"field": "stock_delta", "message": "result would be < 0"}]}}

#17 Category cycle
PATCH /api/v1/admin/categories/1  ->  422 Unprocessable Entity
  request : {"parent_id": 7}
  response: {"error": {"code": "CATEGORY_CYCLE", "message": "A category cannot be its own ancestor", "details": [{"field": "parent_id", "message": "would create a cycle in the category tree"}]}}

#18 Invalid price
POST /api/v1/admin/products/5/skus  ->  422 Unprocessable Entity
  request : {"code": "JADE-BAD", "price": "12.999", "options": {"Size": "Medium", "Pot": "Terracotta"}}
  response: {"error": {"code": "VALIDATION_ERROR", "message": "Request validation failed", "details": [{"field": "price", "message": "must be a decimal with at most 2 decimal places (e.g. \"19.99\")"}]}}
```

### 6.4 Reading the evidence
* #3–#7 are the required demonstration: category → draft product → two variants → SKU (found by option values); #8 shows product, options, variants and SKU as separate records.
* #11–#14 and #16–#18 are rejection paths (#15 is a successful publish): no token 401, duplicate slug 409, duplicate SKU code with different case 409, unoffered combination 422, negative stock 422, category cycle 422, 3-decimal price 422. None returns a stack trace.

## 7. Test strategy, command and result

### 7.1 Strategy

Tests run against a **real PostgreSQL** database (not mocks), because most rules live in the database. Two layers:

| Layer | Files | Purpose |
|---|---|---|
| **Model / constraint tests** talk to PostgreSQL directly, bypassing the API | `models.test.js` | Prove integrity does not depend on API validation (CAT05): unique slugs and codes, CHECKs, FKs, RESTRICT/CASCADE policies, cycle trigger, composite FKs, RS002/RS003 |
| **API tests** call the Express app with supertest | `categories`, `products`, `variants`, `skus`, `authorization`, `seed` | Validation, business rules, status codes, error shape, permissions, reproducible seed |

Every major business rule has at least one **failure-path** test:

| Sprint 2 manual requirement | Tests |
|---|---|
| Product and SKU creation with required fields | `products.test.js` "create"; `skus.test.js` "creation with required fields" |
| Duplicate slug and duplicate SKU rejection | `categories`, `products`, `skus` (incl. case-insensitive), `models` |
| Category hierarchy validation incl. cycle prevention | `categories.test.js` "hierarchy validation"; `models.test.js` (self-parent, A→B→C cycle) |
| Variant/SKU combination and stock rules | `variants.test.js`; `skus.test.js` "variant / combination rules", "stock rules" (incl. 12-way concurrency test) |
| Authorization failure for admin endpoints | `authorization.test.js`: 15 endpoints × {no token → 401, customer → 403, admin → allowed}, plus malformed/forged/expired/`alg:none`/deleted/demoted cases |

Tests run serially (`--test-concurrency=1`) because they share one database; the helper refuses to run unless the database name contains `test`.

### 7.2 Command

```bash
cd backend && npm test   # = node --test --test-reporter=spec --test-concurrency=1 "tests/**/*.test.js"
```

Uses Node's built-in test runner; needs `TEST_DATABASE_URL` in `backend/.env`.

### 7.3 Result

Final run on PostgreSQL 16.15, Node.js v22.22.2 (`npm test`, exit code 0):

| Test file | Tests | Covers |
|---|---:|---|
| `tests/models.test.js` | 25 | Database constraints, FKs, delete policies, triggers (no API involved) |
| `tests/categories.test.js` | 18 | Category CRUD, tree, cycle prevention, deactivation cascade |
| `tests/products.test.js` | 19 | Product CRUD, publish rules, listing/filters, delete rules |
| `tests/variants.test.js` | 8 | Valid combinations, duplicates, option-set rules |
| `tests/skus.test.js` | 22 | SKU creation, codes, price, stock (incl. concurrency), combinations, delete |
| `tests/authorization.test.js` | 55 | 401/403 on all admin endpoints, token attacks, login |
| `tests/seed.test.js` | 7 | Seed minimums, unavailable combination, reproducibility |
| **Total** | **154** | |

```text
ℹ tests 154   ℹ suites 28   ℹ pass 154   ℹ fail 0   ℹ cancelled 0   ℹ skipped 0   ℹ duration_ms 7079
```

## 8. Known limitations and Sprint 3 backlog

### 8.1 Known limitations

* **No customer registration endpoint.** Only login exists; the admin comes from the seed. (Sprint 1 lists registration as MVP; it is not required by the Sprint 2 manual.)
* **No rate limiting or refresh tokens** on login; tokens last 1 hour.
* **Active-product/SKU guard is application-level** (`NO_ACTIVE_SKU`, `LAST_ACTIVE_SKU`, `PRODUCT_ACTIVE`), enforced under a product row lock but not by a database constraint. Direct SQL could bypass it; uniqueness, money, stock, hierarchy and combination rules are all database-enforced.
* **Variants are created, not edited.** To change a combination, delete the variant (when it has no SKUs) and add a new one. Option values are not renamed.
* **One canonical category per product** (see 5.1).
* **`specifications` is read-only through the API**; seeded values are not validated beyond "is an object".
* **No stock history.** `stock_delta` changes are not logged; there is no `INVENTORY_LOGS` table.
* **Categories list is not paginated** (fine for a nursery-sized tree).
* Carts, orders and assets have schema and constraints but **no endpoints and no tests beyond their constraints**.

### 8.2 Sprint 3 hand-off: what can be built safely on top
Sprint 3 should **consume `skus.id`** for carts and orders, never a product id plus a price copied from elsewhere. Stable guarantees provided now:

* `skus` identity, exact decimal `price`, non-negative `stock_quantity`, and `availability` derivation.
* `cart_items.sku_id` and `order_items.sku_id` foreign keys already exist with RESTRICT, so sold or carted SKUs cannot vanish.
* `order_items` snapshot columns for price/code/name.
* Product `status` (`draft`/`active`/`archived`) and category `is_active` as the inputs for public visibility.

### 8.3 Sprint 3 backlog (proposed order)

1. Dynamic specifications: per-category JSON schema validation; admin editing; filtering (light, pet-safe, pot size) via a GIN index on `specifications`.
2. Assets: upload, storage key generation, primary/gallery ordering, alt-text requirement.
3. Public catalog reads: category browse, product detail, search, `availability` labels, only `active` products in active categories.
4. Publication rules: scheduling/review on top of `status`.
5. Catalog-to-cart readiness: cart endpoints on `cart_items.sku_id`, cart-time re-check of active/stock, atomic checkout decrement (`stock_delta` logic reused inside the order transaction).
6. Customer registration, login hardening (rate limit, refresh tokens).
7. Optional many-to-many `product_categories`; `INVENTORY_LOGS` for restock history.
8. Frontend (React) admin screens for the routes in section 4.
