#!/usr/bin/env bash

set -euo pipefail

readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
readonly REPO_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd -P)"

cd -- "$REPO_ROOT"

(
    cd backend
    ./mvnw test
)

npm --prefix frontend ci
npm --prefix frontend run lint
npm --prefix frontend run test -- --run
npm --prefix frontend run build
node scripts/check-shared-ui-parity.mjs
node scripts/check-untranslated-ui.mjs
