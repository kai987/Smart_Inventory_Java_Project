# Smart Inventory Sites Deployment

This directory is the Cloudflare Worker-compatible deployment surface for Smart Inventory. It reuses the responsive React product, cart, order, and administrator screens while implementing the existing `/api` contract with Vinext route handlers and D1 persistence.

The hosted database is intentionally separate from the Spring Boot application's CSV files. D1 migrations under `drizzle/` own the schema and are packaged with each saved Sites version. The first request seeds demo products, users, and historical orders only when the migrated database is completely empty. Existing records and intentionally deleted products are not reset or recreated on later cold starts.

The storefront adds 20 demo products (P005–P024) for a 24-product catalog across six categories. This is a versioned, insert-only data expansion outside schema migrations: an atomic D1 batch checks and records its completion marker, skips colliding product IDs, and never overwrites existing inventory or orders. Later cold starts do not restore products deleted after expansion. Shared category metadata and local product photographs power category filtering, price sorting, and responsive product cards without changing the Java/Rust API contract or their local CSV data.

Shared catalog metadata localizes the 24 standard product names in English, Japanese, and Simplified Chinese. Administrators can also store a required English/default name and optional Japanese/Chinese names for custom products, both on creation and through Edit names. Saved translations take precedence over built-in names; missing custom translations use the default name. Search matches all saved names without replacing raw API/cache values. New orders snapshot all saved language names, independently of later product renames or deletion; existing historical records are not backfilled or rewritten.

## Online demo

- GitHub Pages entry: [https://kai987.github.io/Smart_Inventory_Java_Project/](https://kai987.github.io/Smart_Inventory_Java_Project/)
- Direct Site URL: [https://smart-inventory-demo.huamengdiqidiguo.chatgpt.site/products](https://smart-inventory-demo.huamengdiqidiguo.chatgpt.site/products)

This online deployment uses the shared React interface, a TypeScript/Vinext API, and D1. The repository's Rust backend remains a separate local option and is not running on this Site. The root `pages/` directory contains the redirect-only GitHub Pages entry, not the application backend.

Public demo credentials allow order placement and administrator product/stock changes, so visitors share mutable demo data. This is not a payment service: no real payments are processed. Do not submit real personal information, real customer data, or passwords used elsewhere. Demo credentials are listed in Local verification below.

## Local verification

Use Node.js 24 and npm 11 from this directory:

```bash
npx --yes npm@11.6.2 ci
npm run test
npm run lint
npx tsc --noEmit --incremental false
npm run build
npm run dev
```

Open `http://localhost:3000/products`. The demo credentials remain `admin / admin123` and `customer / user123`.

## Security and persistence

- Session cookies are `HttpOnly`, `SameSite=Lax`, and `Secure` on HTTPS.
- CSRF tokens are required for login, registration, logout, and every write endpoint.
- Passwords are verified with bcrypt; new registrations are stored as bcrypt hashes.
- Registration validates the BCrypt limit of 72 UTF-8 bytes and creates an account without automatically signing in, matching the local backends.
- Roles are enforced by every protected API handler.
- Product, order, user, and session records use D1 rather than browser storage.
- Order item snapshots preserve historical names, prices, weights, and quantities.
- A guarded D1 batch makes stock deduction and order persistence all-or-nothing.
- Optional customer-scoped `Idempotency-Key` values make order retries durable through the existing order primary key. An unchanged replay returns the saved order; changed quantities with the same key return HTTP 409 without another stock deduction.
- Shared private query caches are account-scoped and cleared on authentication transitions. Checkout consumes only its submitted quantities and retains its key for an unchanged retry after a lost response.
