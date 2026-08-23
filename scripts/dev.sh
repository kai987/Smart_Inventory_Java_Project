#!/usr/bin/env bash

set -euo pipefail
# Give each background server its own process group so cleanup also reaches
# Maven/npm child processes. This is supported by the Bash versions shipped on
# both macOS and Linux.
set -m

readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
readonly REPO_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd -P)"

BACKEND_PID=""
FRONTEND_PID=""

terminate_process() {
    local pid="$1"
    local process_group=""

    if kill -0 "$pid" 2>/dev/null; then
        process_group="$(ps -o pgid= -p "$pid" 2>/dev/null | tr -d '[:space:]' || true)"
        if [[ "$process_group" == "$pid" ]]; then
            kill -TERM -- "-$pid" 2>/dev/null || true
        else
            kill -TERM "$pid" 2>/dev/null || true
        fi
    fi
}

cleanup() {
    local exit_status=$?
    trap - EXIT INT TERM

    if [[ -n "$FRONTEND_PID" ]]; then
        terminate_process "$FRONTEND_PID"
    fi
    if [[ -n "$BACKEND_PID" ]]; then
        terminate_process "$BACKEND_PID"
    fi

    if [[ -n "$FRONTEND_PID" ]]; then
        wait "$FRONTEND_PID" 2>/dev/null || true
    fi
    if [[ -n "$BACKEND_PID" ]]; then
        wait "$BACKEND_PID" 2>/dev/null || true
    fi

    exit "$exit_status"
}

handle_interrupt() {
    exit 130
}

trap cleanup EXIT
trap handle_interrupt INT TERM

for directory in backend frontend; do
    if [[ ! -d "$REPO_ROOT/$directory" ]]; then
        printf 'Required directory is missing: %s\n' "$REPO_ROOT/$directory" >&2
        exit 1
    fi
done

if [[ ! -x "$REPO_ROOT/backend/mvnw" ]]; then
    printf 'Maven Wrapper is not executable: %s\n' "$REPO_ROOT/backend/mvnw" >&2
    printf 'Run: chmod +x "%s"\n' "$REPO_ROOT/backend/mvnw" >&2
    exit 1
fi

printf 'Starting Spring Boot at http://localhost:8080 ...\n'
(
    cd -- "$REPO_ROOT/backend"
    export SMART_INVENTORY_DATA_DIR="${SMART_INVENTORY_DATA_DIR:-$REPO_ROOT/runtime-data}"
    exec ./mvnw spring-boot:run
) &
BACKEND_PID=$!

printf 'Starting Vite at http://localhost:5173 ...\n'
(
    cd -- "$REPO_ROOT/frontend"
    exec npm run dev
) &
FRONTEND_PID=$!

printf 'Press Ctrl+C to stop both processes.\n'

# Bash 3.2, still shipped by default on macOS, has no `wait -n`. Polling keeps
# this script portable while still stopping the peer process as soon as either
# development server exits.
exit_status=0
while true; do
    if ! kill -0 "$BACKEND_PID" 2>/dev/null; then
        wait "$BACKEND_PID" || exit_status=$?
        break
    fi
    if ! kill -0 "$FRONTEND_PID" 2>/dev/null; then
        wait "$FRONTEND_PID" || exit_status=$?
        break
    fi
    sleep 1
done

exit "$exit_status"
