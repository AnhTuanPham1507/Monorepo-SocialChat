#!/bin/bash

set -e

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CLI_CONNECT_INPUT="${1:-}"
CONNECTOR_TEMPLATE_PATH="$ROOT_DIR/scripts/connectors/social-chat-postgres-connector.json"
CONNECTOR_NAME="${CONNECTOR_NAME:-social-chat-postgres-connector}"

if [ -f "$ROOT_DIR/config/.env.common" ]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT_DIR/config/.env.common"
  set +a
else
  echo "config/.env.common not found (expected at $ROOT_DIR/config/.env.common)" >&2
  exit 1
fi

DEFAULT_CONNECT_PORT="${CONNECT_PORT:-8083}"
DEFAULT_CONNECT_URL="${CONNECT_URL:-http://localhost:${DEFAULT_CONNECT_PORT}}"
CONNECT_URL="$DEFAULT_CONNECT_URL"

if [ -n "$CLI_CONNECT_INPUT" ]; then
  if [[ "$CLI_CONNECT_INPUT" =~ ^https?:// ]]; then
    CONNECT_URL="$CLI_CONNECT_INPUT"
  else
    CONNECT_URL="http://localhost:$CLI_CONNECT_INPUT"
  fi
fi

# Strip trailing slash and auto-append :8083 if the URL has no explicit port.
CONNECT_URL="${CONNECT_URL%/}"
if [[ "$CONNECT_URL" =~ ^https?://[^/:]+$ ]]; then
  CONNECT_URL="${CONNECT_URL}:${DEFAULT_CONNECT_PORT}"
fi

# Fail fast if any required DB var is missing; otherwise template substitution
# would produce an invalid connector configuration with a cryptic DB error.
: "${DB_HOST:?DB_HOST not set (check config/.env.common)}"
: "${DB_PORT:?DB_PORT not set (check config/.env.common)}"
: "${DB_USERNAME:?DB_USERNAME not set (check config/.env.common)}"
: "${DB_PASSWORD:?DB_PASSWORD not set (check config/.env.common)}"
: "${DB_DATABASE:?DB_DATABASE not set (check config/.env.common)}"

DEBEZIUM_DB_SSLMODE="${DEBEZIUM_DB_SSLMODE:-verify-full}"
DEBEZIUM_DB_SSL_ROOT_CERT="${DEBEZIUM_DB_SSL_ROOT_CERT:-/etc/kafka-connect/secrets/aiven-ca.pem}"
export DEBEZIUM_DB_SSLMODE DEBEZIUM_DB_SSL_ROOT_CERT

# Git Bash converts Unix-looking environment-variable values when it launches
# native Windows programs such as node.exe. The certificate path belongs to the
# Linux Kafka Connect container, so it must reach Node without MSYS rewriting it
# to a host path such as C:/Program Files/Git/etc/kafka-connect/...
case "${OSTYPE:-}" in
  msys* | cygwin*)
    if [ -n "${MSYS2_ENV_CONV_EXCL:-}" ]; then
      MSYS2_ENV_CONV_EXCL="${MSYS2_ENV_CONV_EXCL};DEBEZIUM_DB_SSL_ROOT_CERT"
    else
      MSYS2_ENV_CONV_EXCL="DEBEZIUM_DB_SSL_ROOT_CERT"
    fi
    export MSYS2_ENV_CONV_EXCL
    ;;
esac

for required_command in node curl; do
  if ! command -v "$required_command" >/dev/null 2>&1; then
    echo "$required_command is required but was not found in PATH." >&2
    exit 1
  fi
done

if [ ! -f "$CONNECTOR_TEMPLATE_PATH" ]; then
  echo "Connector template not found at $CONNECTOR_TEMPLATE_PATH" >&2
  exit 1
fi

echo "=================================================="
echo "Setting up Debezium Postgres CDC"
echo "Kafka Connect URL: $CONNECT_URL"
echo "Connector name: $CONNECTOR_NAME"
echo "Database host: ${DB_HOST:-unset}"
echo "Database name: ${DB_DATABASE:-unset}"
echo "=================================================="

echo "[1/2] Preparing PostgreSQL for Debezium..."
(
  cd "$ROOT_DIR"
  node scripts/setup-debezium-database.js
)

echo "[2/2] Applying connector configuration..."

RENDERED_CONNECTOR_FILE="$(mktemp)"
RENDERED_CONNECTOR_CONFIG_FILE="$(mktemp)"
CONNECT_RESPONSE_FILE="$(mktemp)"
trap 'rm -f "$RENDERED_CONNECTOR_FILE" "$RENDERED_CONNECTOR_CONFIG_FILE" "$CONNECT_RESPONSE_FILE"' EXIT

# Only substitute the DB_* vars. JSON.stringify safely escapes values before
# inserting them into the JSON template and avoids requiring host envsubst.
node -e '
const fs = require("fs");
const [templatePath, outputPath] = process.argv.slice(1);
const keys = [
  "DB_HOST",
  "DB_PORT",
  "DB_USERNAME",
  "DB_PASSWORD",
  "DB_DATABASE",
  "DEBEZIUM_DB_SSLMODE",
  "DEBEZIUM_DB_SSL_ROOT_CERT",
];
let rendered = fs.readFileSync(templatePath, "utf8");

for (const key of keys) {
  const escapedValue = JSON.stringify(process.env[key]).slice(1, -1);
  rendered = rendered.split(`\${${key}}`).join(escapedValue);
}

JSON.parse(rendered);
fs.writeFileSync(outputPath, rendered);
' "$CONNECTOR_TEMPLATE_PATH" "$RENDERED_CONNECTOR_FILE"

# Sanity check: if any ${VAR} placeholder remains, fail loudly instead of
# sending a half-rendered template to Kafka Connect.
if grep -q '\${[A-Za-z_][A-Za-z0-9_]*}' "$RENDERED_CONNECTOR_FILE"; then
  echo "Unresolved placeholders in rendered connector template:" >&2
  grep -o '\${[A-Za-z_][A-Za-z0-9_]*}' "$RENDERED_CONNECTOR_FILE" | sort -u >&2
  exit 1
fi
node -e "const fs=require('fs'); const data=JSON.parse(fs.readFileSync(process.argv[1], 'utf8')); process.stdout.write(JSON.stringify(data.config));" \
  "$RENDERED_CONNECTOR_FILE" > "$RENDERED_CONNECTOR_CONFIG_FILE"

if curl -sf "$CONNECT_URL/connectors/$CONNECTOR_NAME" >/dev/null; then
  echo "Connector exists. Updating config..."
  if ! curl --fail-with-body -sS -o "$CONNECT_RESPONSE_FILE" \
    -X PUT "$CONNECT_URL/connectors/$CONNECTOR_NAME/config" \
    -H "Content-Type: application/json" \
    -d @"$RENDERED_CONNECTOR_CONFIG_FILE"; then
    cat "$CONNECT_RESPONSE_FILE" >&2
    exit 1
  fi
  echo "Connector updated successfully."
else
  echo "Connector not found. Creating..."
  if ! curl --fail-with-body -sS -o "$CONNECT_RESPONSE_FILE" \
    -X POST "$CONNECT_URL/connectors" \
    -H "Content-Type: application/json" \
    -d @"$RENDERED_CONNECTOR_FILE"; then
    cat "$CONNECT_RESPONSE_FILE" >&2
    exit 1
  fi
  echo "Connector created successfully."
fi
