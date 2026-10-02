#!/usr/bin/env bash

set -euo pipefail
readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
readonly REPO_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd -P)"

cd -- "$REPO_ROOT"

(
    cd backend-rust
    cargo fmt --all -- --check
    cargo clippy --locked --all-targets -- -D warnings
    cargo test --locked
)

npm --prefix frontend ci
npm --prefix frontend run lint
npm --prefix frontend run test -- --run
npm --prefix frontend run build
node scripts/check-shared-ui-parity.mjs
node scripts/check-untranslated-ui.mjs

printf '\nRust and frontend checks passed. Run the browser suite separately with:\n'
printf 'SMART_INVENTORY_BACKEND=rust npm --prefix frontend run test:e2e\n'
