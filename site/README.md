# Smart Inventory Sites Deployment

This directory is the Cloudflare Worker-compatible deployment surface for Smart Inventory. It reuses the responsive React product, cart, order, and administrator screens while implementing the existing `/api` contract with Vinext route handlers and D1 persistence.

The hosted database is intentionally separate from the Spring Boot application's CSV files. D1 migrations under `drizzle/` own the schema and are packaged with each saved Sites version. The first request seeds demo products, users, and historical orders only when the migrated database is completely empty. Existing records and intentionally deleted products are not reset or recreated on later cold starts.

The storefront adds 20 demo products (P005–P024) for a 24-product catalog across six categories. This is a versioned, insert-only data expansion outside schema migrations: an atomic D1 batch checks and records its completion marker, skips colliding product IDs, and never overwrites existing inventory or orders. Later cold starts do not restore products deleted after expansion. Shared category metadata and local product photographs power category filtering, price sorting, and responsive product cards without changing the Java/Rust API contract or their local CSV data.

Shared catalog metadata localizes the 24 standard product names in English, Japanese, and Simplified Chinese. Administrators can also store a required English/default name and optional Japanese/Chinese names for custom products, both on creation and through Edit details. Saved translations take precedence over built-in names; missing custom translations use the default name. Search matches all saved names without replacing raw API/cache values. New orders snapshot all saved language names, independently of later product renames or deletion; existing historical records are not backfilled or rewritten.

The Site product-search API and administrator customer filter use parameter-bound literal substring matching instead of SQL `LIKE`. Complete long/multibyte keywords are preserved, and `%`, `_`, and backslashes remain literal characters rather than wildcards. This avoids D1's 50-byte `LIKE`-pattern limit while retaining the existing ASCII case-insensitive behavior. The public catalog continues to filter its fetched product list in the browser.

Order-list APIs share optional paging with Java/Rust: `page` is 1–1,000,000 (default 1), `size` is 1–100 (default 20), and `sort` is exactly `asc` or `desc` (default `asc`). Any supplied paging parameter enables a page; omitting all three retains the complete ascending legacy response. `{ items, total }` is unchanged, with the overall filtered total and an empty page beyond the end. Empty/duplicate/invalid/out-of-range paging values return HTTP 400 (`VALIDATION_ERROR`); ASCII digits may have leading zeros, while unknown parameter names remain ignored. Authorization and existing customer-filter semantics are preserved. Customer/admin order screens use ascending pages of 20; the dashboard requests five descending entries. Site ordering remains `created_at, order_id`, reversed together for descending order.

Order details are fetched once for the selected order IDs through one JSON-bound query, not once per order. This preserves historical item snapshots and their `item_order` while avoiding N+1 reads and D1's 100-parameter limit, including the backward-compatible full-history path. Paged requests also count the overall filtered history; no schema or stored order data is changed.

Administrators can assign one of the seven catalog categories and upload a product image (PNG/JPEG/WebP, at most 2 MiB). Product metadata is stored in D1, and immutable uploaded files use the `BUCKET` R2 binding. Uploads require the administrator session and CSRF token; file size, media type, signatures, and generated image paths are checked server-side. Images are publicly readable with a fixed raster content type and `nosniff`. Selection previews are browser-local until saving. Orders snapshot the uploaded image reference; replacing/removing a product image does not delete files used by historical orders. Unreferenced uploads are not automatically deleted, including interrupted uploads that completed storage before a later product-save failure.

## Online demo

- GitHub Pages entry: [https://kai987.github.io/Smart_Inventory_Java_Project/](https://kai987.github.io/Smart_Inventory_Java_Project/)
- Direct Site URL: [https://smart-inventory-demo.huamengdiqidiguo.chatgpt.site/products](https://smart-inventory-demo.huamengdiqidiguo.chatgpt.site/products)

This online deployment uses the shared React interface, a TypeScript/Vinext API, and D1. The repository's Rust backend remains a separate local option and is not running on this Site. The root `pages/` directory contains the redirect-only GitHub Pages entry, not the application backend.

Public demo credentials allow order placement and administrator product/stock changes, so visitors share mutable demo data. This is not a payment service: no real payments are processed. Do not submit real personal information, real customer data, or passwords used elsewhere. Demo credentials are listed in Local verification below.

## Local verification

Dependency overrides are scoped. Patched Minimatch 11 replaces only vulnerable 7–11.0.0 resolutions, retaining legacy Minimatch 3. Drizzle Kit is pinned to `0.31.11`; only its unused legacy `@esbuild-kit/esm-loader` declaration is resolved through an npm alias to the official successor, `tsx@4.23.15`. This does not make `tsx` an implementation of the old loader API and must not be generalized to other Drizzle versions. `test:tooling` fails if a published Drizzle runtime module references that legacy dependency and checks JS/TS/MJS config generation in isolated copies without changing schema or migration/journal hashes. Preserve existing migration history; do not regenerate it to make an upgrade pass.

ESLint 10 uses an explicit configuration of supported plugins, without forcing unsupported peer ranges. The [rule mapping](tooling/eslint-rule-map.json) and regression fixtures track the previous React/Next.js/Hooks/TypeScript/accessibility/import checks, including conservative restrictions on class components and JSX outside TSX. `npm run lint` also runs TypeScript and fails on warnings. `npm run test:tooling` is the focused maintenance-regression command and is also included in `npm run test`.

The existing [framework source-map adapter](tooling/framework-source-maps.mjs) remains unchanged: truthful MagicString maps cover three pinned hooks without changing executable output bytes, filtering warnings, or rewriting import graphs. Version/source-hash changes still stop at this guard until revalidated.

The separate [snapshot-audited import adapter](tooling/framework-imports.mjs) normalizes only the root-layout and `default-global-error` duplicate edges, retaining the compiler's existing Promise/getter shapes. Revalidated after the paginated-orders/session-maintenance changes: paired builds of the same 112-input application snapshot matched all 91 JS/CSS bodies (59 byte-identical), normalizing only recorded generated IDs and emitted filenames. This comparison isolates the adapter, not application changes versus the previous release. The audited build removes two of three notices; this is not a download or performance optimization. Unknown source/config/dependency/environment inputs and watch builds retain the original imports and visible warnings rather than failing in this adapter. Slot is deliberately excluded: its candidate retained 17 exports instead of 4 and added about 1.8 KB of SSR JavaScript, so that `INEFFECTIVE_DYNAMIC_IMPORT` notice remains.

Recheck audit, tooling, lint, types, tests, and builds when dependencies change. Zero audit findings do not mean zero maintenance warnings or establish overall security. Do not force a framework/linter downgrade just to satisfy audit output.

Use Node.js 24 and npm 11 from this directory. If npm 12 reports blocked native dependency installation scripts, review approvals individually; these instructions do not authorize blanket script approval or a machine-wide policy change.

```bash
npx --yes npm@11.6.2 ci
npm audit
npm run test:tooling
npm run test
npm run lint
npx tsc --noEmit --incremental false
npm run build
npm run dev
```

Open `http://localhost:3000/products`. The demo credentials remain `admin / admin123` and `customer / user123`.

### Built Worker integration and browser tests

After the Site build above, run:

```bash
npm run test:integration
cd ../frontend
npm exec -- playwright install chromium
npm exec -- playwright test --config playwright.site.config.ts
```

Install the frontend dependencies first if needed. The API integration command runs the built Worker under real Wrangler/workerd against a new temporary local D1/R2 fixture, applying the committed migration history and normal expanded-catalog bootstrap. The shared Chromium suite starts a separate fresh runtime on loopback port 4175 and uses a four-product fixture matching Java/Rust browser tests. Neither command uses Cloudflare account credentials, deployed data, developer CSV files, or existing local persistence. Tests cover HTTP authentication/CSRF/roles, R2 bytes, order snapshots, rollback/replay, long searches, paging, and session maintenance. The dedicated Site CI job runs both commands; local-runtime validation is distinct from deployment and live-site acceptance.

## Security and persistence

- Session cookies are `HttpOnly`, `SameSite=Lax`, and `Secure` on HTTPS.
- Ordinary API access (not public image reads) runs bounded expired-session maintenance: at most 100 oldest expired rows, no more than once per five minutes per isolate/database binding, with concurrent accesses sharing one sweep. No traffic means no idle cron. Failures leave the API available and allow a subsequent access to retry after 60 seconds; the warning excludes session IDs, tokens, bindings, and driver details. The DELETE rechecks expiry, preserves valid/refreshed sessions, and never deletes users, products, orders, or R2 files.
- CSRF tokens are required for login, registration, logout, and every write endpoint.
- Passwords are verified with bcrypt; new registrations are stored as bcrypt hashes.
- Registration validates the BCrypt limit of 72 UTF-8 bytes and creates an account without automatically signing in, matching the local backends.
- Roles are enforced by every protected API handler.
- Product, order, user, and session records use D1 rather than browser storage.
- Order item snapshots preserve historical names, prices, weights, and quantities.
- A guarded D1 batch makes stock deduction and order persistence all-or-nothing.
- Product lookup and stock updates use JSON-bound item sets, keeping each statement below D1's 100-parameter limit even for large carts. Boundary, rollback, and replay tests include 20, 21, 24, and 1,000 distinct products.
- Authentication error codes match the shared Java/Rust/frontend contract; expired protected requests return `UNAUTHENTICATED` so the UI clears private caches and returns to login without clearing the cart.
- Optional customer-scoped `Idempotency-Key` values make order retries durable through the existing order primary key. An unchanged replay returns the saved order; changed quantities with the same key return HTTP 409 without another stock deduction.
- Shared private query caches are account-scoped and cleared on authentication transitions. Checkout consumes only its submitted quantities and retains its key for an unchanged retry after a lost response.
- Browser storage access, reads, writes, and malformed-cart cleanup are best-effort. The UI remains usable in memory if access is denied or quota is exhausted. Checkout keeps page-local customer/cart-scoped keys and completion tombstones so failed persistence cannot change retry identity or resurrect a completed order. Reload recovery requires working browser storage; if an earlier result is uncertain after a reload, inspect order history before placing another order.
- Same-origin updated tabs synchronize the v2 cart through storage-change invalidations. An exclusive Web Lock serializes reading the latest snapshot, reducing an action, and saving; shared order-consumption markers prevent the same confirmed order from subtracting twice. Unresolved checkout quantities/keys remain frozen while other tabs change the shared cart; explicit local edits disable automatic snapshot restoration without discarding the unknown-result key. Valid v1 contents migrate on the first mutation without dual-writing the old key; reload older open tabs after deployment. Missing/rejected Web Locks retain best-effort persistence, not a guarantee against truly simultaneous writes. Storage failures retain page-local operation without overwriting unreadable/newer formats.
- API and CSRF requests time out after 15 seconds each; timeout, cancellation, and network failures have distinct localized messages. A timeout does not prove the server rolled back. Writes are not automatically retried on timeout; checkout preserves its cart/key for manual replay. Existing explicit CSRF-rejection and read-query retry policies are unchanged.
