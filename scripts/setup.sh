#!/usr/bin/env bash

set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
KONG_ADMIN_URL="${KONG_ADMIN_URL:-http://localhost:8001}"
CONNECT_URL="${CONNECT_URL:-http://localhost:${CONNECT_PORT:-8083}}"
SETUP_WAIT_SECONDS="${SETUP_WAIT_SECONDS:-180}"

cd "$ROOT_DIR"

fail() {
  echo "Setup failed: $*" >&2
  exit 1
}

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    fail "'$1' is required but was not found in PATH."
  fi
}

wait_for_url() {
  local name="$1"
  local url="$2"
  local deadline=$((SECONDS + SETUP_WAIT_SECONDS))

  echo "Waiting for $name at $url ..."
  until curl --fail --silent "$url" >/dev/null 2>&1; do
    if ((SECONDS >= deadline)); then
      fail "$name did not become ready within ${SETUP_WAIT_SECONDS} seconds. Check: docker compose ps"
    fi
    sleep 2
  done
  echo "$name is ready."
}

if ! [[ "$SETUP_WAIT_SECONDS" =~ ^[1-9][0-9]*$ ]]; then
  fail "SETUP_WAIT_SECONDS must be a positive integer."
fi

echo "=================================================="
echo "Social Chat project setup"
echo "=================================================="

require_command bash
require_command curl
require_command docker
require_command node
require_command yarn

if ! docker compose version >/dev/null 2>&1; then
  fail "Docker Compose v2 is required (the 'docker compose' command)."
fi

if ! docker info >/dev/null 2>&1; then
  fail "Docker is not running or is not accessible."
fi

echo "[1/5] Preparing local configuration..."
if [ ! -f "$ROOT_DIR/config/.env.common" ]; then
  cp "$ROOT_DIR/config/.env.example" "$ROOT_DIR/config/.env.common"
  echo "Created config/.env.common from config/.env.example."
  echo "Review its placeholder values before using external integrations."
else
  echo "config/.env.common already exists; keeping it unchanged."
fi

# Docker Compose interpolates Kafka Connect/Aiven settings from the shell.
set -a
# shellcheck disable=SC1091
source "$ROOT_DIR/config/.env.common"
set +a

: "${KAFKA_BROKERS:?KAFKA_BROKERS not set in config/.env.common}"
: "${KAFKA_SASL_USERNAME:?KAFKA_SASL_USERNAME not set in config/.env.common}"
: "${KAFKA_SASL_PASSWORD:?KAFKA_SASL_PASSWORD not set in config/.env.common}"

echo "[2/5] Installing workspace dependencies..."
yarn install --frozen-lockfile

echo "[3/5] Starting local infrastructure..."
docker compose up --detach --build

echo "[4/5] Waiting for configurable infrastructure..."
wait_for_url "Kong Admin API" "$KONG_ADMIN_URL/status"
wait_for_url "Kafka Connect" "${CONNECT_URL%/}/connectors"

echo "[5/5] Applying infrastructure configuration..."
bash "$ROOT_DIR/scripts/kong-setup.sh" "$KONG_ADMIN_URL"
bash "$ROOT_DIR/scripts/debezium-postgres-connector.sh" "$CONNECT_URL"

echo "=================================================="
echo "Project setup complete."
echo "Run 'docker compose ps' to inspect infrastructure."
echo "=================================================="
