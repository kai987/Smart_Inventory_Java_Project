#!/usr/bin/env bash

set -euo pipefail
readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"

export SMART_INVENTORY_BACKEND=rust
exec "$SCRIPT_DIR/dev.sh"
