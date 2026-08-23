#!/usr/bin/env bash

set -euo pipefail

readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
readonly REPO_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd -P)"
readonly JAR_PATH="$REPO_ROOT/backend/target/smart-inventory-demo.jar"

cd -- "$REPO_ROOT"

npm --prefix frontend ci
npm --prefix frontend run lint
npm --prefix frontend run test -- --run
npm --prefix frontend run build

(
    cd backend
    ./mvnw clean package
)

if [[ ! -f "$JAR_PATH" ]]; then
    printf 'Build finished without the expected JAR: %s\n' "$JAR_PATH" >&2
    exit 1
fi

jar_listing="$(mktemp "${TMPDIR:-/tmp}/smart-inventory-jar.XXXXXX")"
trap 'rm -f -- "$jar_listing"' EXIT
jar tf "$JAR_PATH" > "$jar_listing"
if ! grep -Fxq 'BOOT-INF/classes/static/index.html' "$jar_listing"; then
    printf 'The JAR does not contain the React entry point.\n' >&2
    exit 1
fi

printf '\nSingle-JAR demo built successfully.\n'
printf 'JAR: %s\n' "$JAR_PATH"
printf 'Run: cd "%s" && java -jar "backend/target/smart-inventory-demo.jar"\n' "$REPO_ROOT"
