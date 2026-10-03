# Smart Inventory Rust backend

This optional backend reimplements the local Spring Boot API in Rust while retaining the existing React frontend, `/api` routes, JSON field names, role rules, error codes, and CSV formats. The Java backend and `legacy-console/` coursework remain available and unchanged. The hosted `site/` application is a separate TypeScript/Vinext + D1 deployment; this backend does not migrate or redeploy it.

## Prerequisites

- Rust 1.93 or newer, Cargo, rustfmt, and Clippy
- Node.js 24 and npm for frontend development/builds
- Bash on macOS or Linux
- Playwright Chromium for browser tests

Java is not required to build or run this backend. Native packages must be built for the target operating system and CPU; a macOS binary is not a Linux binary.

## Development

Run from the repository root:

```bash
npm --prefix frontend ci
./scripts/dev-rust.sh
```

Open [http://localhost:5173/products](http://localhost:5173/products). Vite proxies `/api` to Rust on port 8080. `Ctrl+C` stops both server process groups. The shared development helper defaults to Java; `dev-rust.sh` explicitly selects Rust. The first Cargo build may take several minutes.

To run only the API:

```bash
cd backend-rust
cargo run --locked --bin smart-inventory-server
```

For a frontend served directly by Rust, build it first with `npm --prefix frontend run build` from the repository root, then visit [http://localhost:8080/products](http://localhost:8080/products). Unknown `/api` URLs return JSON errors, not the SPA entry point.

The default accounts are `admin` / `admin123` and `customer` / `user123`. They are public demo accounts, not production credentials. Passwords are stored as bcrypt hashes. Rust uses an `HttpOnly`, `SameSite=Lax` cookie named `RUSTSESSIONID`; switching from Java requires a fresh login. Sessions expire after 30 idle minutes by default and are lost on restart. State-changing requests, including login and registration, require the CSRF token returned by `/api/auth/csrf`.

Passwords must also fit bcrypt's **72 UTF-8 byte maximum**. The shared frontend and Java, Rust, and Site APIs validate this byte limit in addition to the 4–100-character rule. Non-ASCII characters often require several bytes each. Overlong passwords are rejected instead of silently truncated.

## Configuration

| Environment variable | Default | Purpose |
| --- | --- | --- |
| `SMART_INVENTORY_DATA_DIR` | Repository `runtime-data-rust/` | CSV storage directory |
| `SMART_INVENTORY_STATIC_DIR` | Repository `frontend/dist/` | Built React files |
| `SMART_INVENTORY_HOST` | `127.0.0.1` | Listen address |
| `SMART_INVENTORY_PORT` | `8080` | Listen port; `PORT` is a fallback |
| `SMART_INVENTORY_ALLOWED_ORIGINS` | `http://localhost:5173` | Comma-separated explicit CORS origins; no wildcard |
| `SMART_INVENTORY_SECURE_COOKIE` | `false` | Use `true` behind HTTPS |
| `SMART_INVENTORY_SESSION_TIMEOUT_SECONDS` | `1800` | Idle session lifetime |
| `SMART_INVENTORY_LOW_STOCK_THRESHOLD` | `5` | Dashboard low-stock threshold |
| `SMART_INVENTORY_PASSWORD_WORK_LIMIT` | `4` | Maximum concurrent BCrypt login/registration tasks; valid range 1–64 |

The development Vite proxy expects backend port 8080. A direct Rust or packaged application can use a different port. Use an explicit data directory for an executable copied outside its source checkout. The generated package launcher sets data and static paths relative to the package, so it can be launched from any working directory.

Login and registration perform BCrypt work outside the inventory lock. They share a bounded CPU-work limit; excess requests fail promptly with HTTP 429 (`RATE_LIMITED`) and `Retry-After: 1` rather than accumulating an unbounded queue. A cancelled request keeps its permit until the blocking password task actually finishes. This is a CPU concurrency guard, not a per-user or per-IP login-attempt rate limiter.

## Retry-safe order submission

`POST /api/orders` accepts an optional `Idempotency-Key` containing 16–128 ASCII letters, digits, `_`, or `-`. It is scoped to the authenticated customer and stored through a deterministic order ID in the existing CSV format. Repeating the same normalized product quantities returns the saved order without another stock deduction, including after restarting the server or deleting a product. Reusing the key with different quantities returns HTTP 409 (`IDEMPOTENCY_CONFLICT`); an unsuccessful transaction does not reserve the key. Without the header, each accepted request creates a new order as before.

The shared cart retains its key across an unchanged retry and page reload, freezes checkout controls while pending, and removes only the successfully submitted quantities. Java and the D1-backed Site implement the same key and response semantics.

## Tests

```bash
# Rust formatting, Clippy, unit/API tests, and frontend checks/build
./scripts/test-rust.sh

# Same browser journeys as the Java backend, with separate test data
(cd frontend && npm exec -- playwright install chromium)
SMART_INVENTORY_BACKEND=rust npm --prefix frontend run test:e2e
```

The browser configuration starts both servers and resets only its isolated `frontend/.playwright-data-rust/` directory. Ports 8080 and 5173 must be free. It rejects arbitrary data paths and symlinked test-data directories before reset. Java E2E remains the default when `SMART_INVENTORY_BACKEND` is absent. CI checks both the original Java application and Rust; the Rust job also runs the shared browser suite.

For backend-only checks:

```bash
cd backend-rust
cargo fmt --all -- --check
cargo clippy --locked --all-targets -- -D warnings
cargo test --locked
```

## Native demo package

```bash
./scripts/build-rust-demo.sh
./backend-rust/dist/run.sh
```

Open [http://localhost:8080/products](http://localhost:8080/products). The build runs Rust and frontend checks, builds optimized native code, and creates:

```text
backend-rust/dist/
├── smart-inventory-server
├── public/                    Built frontend and local assets
└── run.sh                     Portable path-aware launcher
```

Distribute the complete directory to a compatible machine. No Java, Node.js, or Cargo is needed at runtime. The initial CSV data is embedded in the executable. The launcher creates `runtime-data/` inside the package unless `SMART_INVENTORY_DATA_DIR` is set; keep that directory writable and back it up. Rebuilding replaces the executable, launcher, and generated `public/` assets, but preserves that runtime-data directory. The build does not run browser tests automatically.

## CSV compatibility and safe migration

Default data is deliberately separate: Java uses repository `runtime-data/`, Rust uses `runtime-data-rust/`, and Sites uses D1. No existing Java data is moved or overwritten just by starting Rust.

To evaluate an existing Java dataset:

1. Stop Java, Rust, and any other process that writes those files.
2. Make a complete backup of the original data directory.
3. Copy `users.csv`, `products.csv`, and `orders.csv` together into a new, separate evaluation directory.
4. Start Rust with `SMART_INVENTORY_DATA_DIR=/absolute/path/to/evaluation-data`.
5. Check login, products, historical orders, and order creation before choosing the backend that will own that dataset.

Existing `{bcrypt}` hashes are supported. Compatible legacy plaintext passwords are upgraded during validated loading. Product prices are whole yen, including legacy integer-valued decimal CSV prices. Both legacy order references and snapshot-based order rows are accepted; new writes preserve snapshots so deleting a product does not destroy order history. Yen API values remain decimal strings to avoid JavaScript precision loss.

Legacy reference-only orders are converted to snapshot rows during the validated startup transaction, before later product deletion can make those references unreadable. Rust also supports an empty product or order collection as a valid CSV state. The current Java loader rejects zero-byte CSV files, so this edge case is not automatically compatible when switching back; verify the copied dataset first rather than inserting artificial records.

If a legacy plaintext password exceeds 72 UTF-8 bytes, migration stops without overwriting the original CSVs. Back up the data and explicitly choose a replacement password for that account before retrying; never truncate an existing password automatically. Unsupported encoded-password algorithms likewise require an explicit account/password migration rather than being treated as plaintext.

All files must validate before the loaded state is accepted. Stock validation and order creation run under one write lock. Staged saves and backup restoration protect ordinary write-failure handling, and the in-memory state is only accepted after a successful save. This remains single-instance CSV storage rather than a transactional production database; keep backups and use only one writer.

A local `.smart-inventory-transaction.json` journal records an in-progress save. On startup, a prepared transaction is rolled back; a committed transaction is checked before the journal is removed. Recovery refuses unrecognized external edits and preserves the journal for inspection. If a prior run crashed, recover with Rust before exporting its CSVs to Java. Do not delete a remaining journal or copy only part of its data as a recovery shortcut; preserve the whole directory for repair.

Rust holds an exclusive advisory lock for its data directory. **That lock is only enforced by Rust. The existing Java application and external editors do not honor it. Never run Java and Rust against the same data directory simultaneously.** For switching back, stop Rust first and use a backed-up copy to verify Java compatibility before making it the active dataset.

## Scope and limitations

- This is a compatibility-oriented alternative backend, not an automatic performance improvement. No Java-versus-Rust benchmark is claimed.
- CSV records and sessions are held in memory. Storage is single-instance, and sessions do not persist across restarts.
- Demo accounts, password reset, account lockout, rate limiting, pagination, and other production-hardening needs have the same limits described in the root README.
- Existing Java coursework remains the appropriate source when a course submission specifically requires `.java` files.
- Building locally does not commit code, update GitHub, or publish a hosted Site.
