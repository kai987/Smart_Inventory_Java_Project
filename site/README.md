# Smart Inventory Sites Deployment

This directory is the Cloudflare Worker-compatible deployment surface for Smart Inventory. It reuses the responsive React product, cart, order, and administrator screens while implementing the existing `/api` contract with Vinext route handlers and D1 persistence.

The hosted database is intentionally separate from the Spring Boot application's CSV files. On first request it creates the schema and idempotently loads the same demo products, users, and historical orders. D1 migrations under `drizzle/` are packaged with each saved Sites version.

## Local verification

Use Node.js 24 and npm 11 from this directory:

```bash
npx --yes npm@11.6.2 ci
npm run test
npm run lint
npm run build
npm run dev
```

Open `http://localhost:3000/products`. The demo credentials remain `admin / admin123` and `customer / user123`.

## Security and persistence

- Session cookies are `HttpOnly`, `SameSite=Lax`, and `Secure` on HTTPS.
- CSRF tokens are required for login, registration, logout, and every write endpoint.
- Passwords are verified with bcrypt; new registrations are stored as bcrypt hashes.
- Roles are enforced by every protected API handler.
- Product, order, user, and session records use D1 rather than browser storage.
- Order item snapshots preserve historical names, prices, weights, and quantities.
- A guarded D1 batch makes stock deduction and order persistence all-or-nothing.
