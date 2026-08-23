#!/usr/bin/env bash

set -euo pipefail

readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
readonly REPO_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd -P)"
readonly DATA_DIR="$REPO_ROOT/runtime-data"

if [[ $# -ne 0 ]]; then
    printf 'Usage: %s\n' "$0" >&2
    printf 'This script deliberately does not accept a deletion path.\n' >&2
    exit 64
fi

if [[ "$REPO_ROOT" == "/" || "$DATA_DIR" != "$REPO_ROOT/runtime-data" ]]; then
    printf 'Safety check failed; refusing to remove demo data.\n' >&2
    exit 1
fi

if [[ -L "$DATA_DIR" ]]; then
    printf 'Safety check failed: runtime-data is a symbolic link.\n' >&2
    exit 1
fi

if [[ -e "$DATA_DIR" ]]; then
    rm -rf -- "${DATA_DIR:?}"
    printf 'Removed demo data: %s\n' "$DATA_DIR"
else
    printf 'Demo data is already reset: %s does not exist.\n' "$DATA_DIR"
fi

printf 'Seed data will be copied on the next application start.\n'
