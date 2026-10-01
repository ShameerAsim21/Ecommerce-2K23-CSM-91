# Root & Sprout - Curated Botanical Nursery & Care Hub
## Course: E-Commerce
## Tech Stack: React + Node.js/Express + PostgreSQL.


| Sprint | Document |
|---|---|
| 1 - Architecture & scope | [docs/SPRINT_1.md](docs/SPRINT_1.md) |
| 2 - Catalog data foundation | [docs/SPRINT_2.md](docs/SPRINT_2.md) |

## Sprint 2: local setup (backend)

**Requirements:** Node.js 22+, PostgreSQL 14+ (or Docker).

```bash
# 1. Database (skip if you already run PostgreSQL). Edit the password in docker-compose.yml first.
docker compose up -d

# 2. Configure the backend
cd backend
cp .env.example .env          # then edit: passwords, JWT_SECRET, SEED_ADMIN_PASSWORD
npm install

# 3. Create tables, load demo data, start the API
npm run db:fresh              # = db:reset + migrate + seed (drops and rebuilds the dev database)
npm start                     # http://localhost:3000  (npm run dev to auto-restart)

# 4. Verify
npm test                      # 154 automated tests, uses TEST_DATABASE_URL
npm run demo                  # (server running, freshly seeded DB) prints request/response evidence
```

### Environment variables (`backend/.env`)

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | yes | Development PostgreSQL connection string |
| `TEST_DATABASE_URL` | for tests | Test database; its name must contain `test` (the suite drops the schema) |
| `JWT_SECRET` | yes | HS256 signing key, 32+ random characters |
| `JWT_EXPIRES_IN` | no | Token lifetime, default `1h` |
| `BCRYPT_ROUNDS` | no | Password hashing cost, default `12` |
| `PORT` | no | HTTP port, default `3000` |
| `SEED_ADMIN_PASSWORD` | for seed | Password of `admin@rootandsprout.test` |
| `SEED_CUSTOMER_PASSWORD` | no | Also seeds `customer@rootandsprout.test` |

`.env` is git-ignored. Only `.env.example` (placeholders) is committed. Never commit real secrets.

### npm scripts (in `backend/`)

| Script | What it does |
|---|---|
| `npm run migrate` | Apply pending SQL migrations from `db/migrations/` |
| `npm run db:reset` | Drop and recreate the schema (refuses in production) |
| `npm run seed` | Load reproducible demo data (refuses in production) |
| `npm run db:fresh` | reset + migrate + seed |
| `npm start` / `npm run dev` | Run the API |
| `npm test` | Run all tests serially |
| `npm run demo` | Print Markdown request/response evidence against a running server |

### Layout

```
backend/
  db/migrations/   001_users, 002_catalog, 003_commerce_links (SQL)
  db/seeds/        seed.js (reproducible demo data)
  src/             app, routes/, services/, middleware/, schemas.js, errors.js
  tests/           model, validation, authorization and API tests
  scripts/demo.js  evidence generator
docs/              SPRINT_1.md, SPRINT_2.md
```
