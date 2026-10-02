#!/usr/bin/env bash

set -euo pipefail
readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
readonly REPO_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd -P)"
readonly DIST_DIR="$REPO_ROOT/backend-rust/dist"

"$SCRIPT_DIR/test-rust.sh"

(
    cd -- "$REPO_ROOT/backend-rust"
    cargo build --locked --release --bin smart-inventory-server --target-dir "$REPO_ROOT/backend-rust/target"
)

if [[ -L "$DIST_DIR" ]]; then
    printf 'Refusing to package into a symlink: %s\n' "$DIST_DIR" >&2
    exit 1
fi
for output_file in smart-inventory-server run.sh; do
    if [[ -L "$DIST_DIR/$output_file" ]]; then
        printf 'Refusing to overwrite a symlink: %s\n' "$DIST_DIR/$output_file" >&2
        exit 1
    fi
done

mkdir -p -- "$DIST_DIR"
cp -- "$REPO_ROOT/backend-rust/target/release/smart-inventory-server" "$DIST_DIR/smart-inventory-server"
# Only generated assets are replaced. A previous package's runtime-data is kept.
rm -rf -- "$DIST_DIR/public"
cp -R -- "$REPO_ROOT/frontend/dist" "$DIST_DIR/public"
cat > "$DIST_DIR/run.sh" <<'LAUNCHER'
#!/usr/bin/env bash
set -euo pipefail
readonly PACKAGE_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
export SMART_INVENTORY_STATIC_DIR="${SMART_INVENTORY_STATIC_DIR:-$PACKAGE_DIR/public}"
export SMART_INVENTORY_DATA_DIR="${SMART_INVENTORY_DATA_DIR:-$PACKAGE_DIR/runtime-data}"
exec "$PACKAGE_DIR/smart-inventory-server" "$@"
LAUNCHER
chmod +x "$DIST_DIR/run.sh" "$DIST_DIR/smart-inventory-server"
test -f "$DIST_DIR/public/index.html"

printf '\nRust demo package built successfully for this operating system and CPU.\n'
printf 'Package: %s\n' "$DIST_DIR"
printf 'Run: "%s/run.sh"\n' "$DIST_DIR"
printf 'Open http://localhost:8080/products\n'
