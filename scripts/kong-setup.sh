#!/bin/bash

# =============================================================================
# Kong Gateway Configuration Script
# =============================================================================
# This script configures Kong Gateway with services, routes, and plugins
# for the Social Chat microservices architecture.
#
# Services:
#   - auth-service: Authentication service (port 3001)
#   - user-service: User management service (port 3002)
#   - asset-service: Asset management service (port 3003)
#   - feed-service: Feed service (port 3004)
#   - messaging-service: Messaging service (port 3005)
#   - realtime-gateway: WebSocket gateway (port 3006)
#   - ai-service: AI service (port 3008)
#
# Note: JWT validation is handled by downstream services, not Kong.
# Kong provides routing, CORS, rate limiting, and logging.
#
# Usage:
#   ./scripts/kong-setup.sh [KONG_ADMIN_URL]
#
# Default KONG_ADMIN_URL: http://localhost:8001
# =============================================================================

set -e

KONG_ADMIN_URL="${1:-http://localhost:8001}"
AUTH_SERVICE_URL="${AUTH_SERVICE_URL:-http://host.docker.internal:3001}"
USER_SERVICE_URL="${USER_SERVICE_URL:-http://host.docker.internal:3002}"
ASSET_SERVICE_URL="${ASSET_SERVICE_URL:-http://host.docker.internal:3003}"
FEED_SERVICE_URL="${FEED_SERVICE_URL:-http://host.docker.internal:3004}"
MESSAGING_SERVICE_URL="${MESSAGING_SERVICE_URL:-http://host.docker.internal:3005}"
REALTIME_GATEWAY_URL="${REALTIME_GATEWAY_URL:-http://host.docker.internal:3006}"
AI_SERVICE_URL="${AI_SERVICE_URL:-http://host.docker.internal:3008}"

echo "=================================================="
echo "Kong Gateway Configuration"
echo "=================================================="
echo "Kong Admin URL: $KONG_ADMIN_URL"
echo "Auth Service URL: $AUTH_SERVICE_URL"
echo "User Service URL: $USER_SERVICE_URL"
echo "Asset Service URL: $ASSET_SERVICE_URL"
echo "Feed Service URL: $FEED_SERVICE_URL"
echo "Messaging Service URL: $MESSAGING_SERVICE_URL"
echo "Realtime Gateway URL: $REALTIME_GATEWAY_URL"
echo "AI Service URL: $AI_SERVICE_URL"
echo "=================================================="

# Wait for Kong to be ready
echo "Waiting for Kong to be ready..."
until curl -s "$KONG_ADMIN_URL/status" > /dev/null 2>&1; do
    echo "Kong is not ready yet. Retrying in 2 seconds..."
    sleep 2
done
echo "Kong is ready!"

# =============================================================================
# Helper Functions
# =============================================================================

create_service() {
    local name=$1
    local url=$2

    echo "Creating service: $name -> $url"

    # Check if service exists
    if curl -s "$KONG_ADMIN_URL/services/$name" | grep -q '"id"'; then
        echo "Service '$name' already exists. Updating..."
        curl -sS --fail-with-body -X PATCH "$KONG_ADMIN_URL/services/$name" \
            -H "Content-Type: application/json" \
            -d "{\"url\": \"$url\"}" > /dev/null
    else
        curl -sS --fail-with-body -X POST "$KONG_ADMIN_URL/services" \
            -H "Content-Type: application/json" \
            -d "{\"name\": \"$name\", \"url\": \"$url\"}" > /dev/null
    fi
    echo "Service '$name' configured."
}

create_route() {
    local service=$1
    local name=$2
    local paths=$3
    local strip_path=${4:-true}

    echo "Creating route: $name for service $service"

    # Check if route exists
    if curl -s "$KONG_ADMIN_URL/routes/$name" | grep -q '"id"'; then
        echo "Route '$name' already exists. Updating..."
        curl -sS --fail-with-body -X PATCH "$KONG_ADMIN_URL/routes/$name" \
            -H "Content-Type: application/json" \
            -d "{\"paths\": $paths, \"strip_path\": $strip_path}" > /dev/null
    else
        curl -sS --fail-with-body -X POST "$KONG_ADMIN_URL/services/$service/routes" \
            -H "Content-Type: application/json" \
            -d "{\"name\": \"$name\", \"paths\": $paths, \"strip_path\": $strip_path}" > /dev/null
    fi
    echo "Route '$name' configured."
}

enable_global_plugin() {
    local plugin=$1
    local config=$2

    echo "Enabling global plugin: $plugin"

    # Check if plugin exists
    local existing=$(curl -s "$KONG_ADMIN_URL/plugins" | grep -o "\"name\":\"$plugin\"" || true)

    if [ -n "$existing" ]; then
        echo "Global plugin '$plugin' already enabled. Skipping..."
    else
        curl -sS --fail-with-body -X POST "$KONG_ADMIN_URL/plugins" \
            -H "Content-Type: application/json" \
            -d "{\"name\": \"$plugin\"${config:+, \"config\": $config}}" > /dev/null
        echo "Global plugin '$plugin' enabled."
    fi
}

# =============================================================================
# Configure Services
# =============================================================================

echo ""
echo "Configuring Services..."
echo "-------------------------------------------"

# Auth Service
create_service "auth-service" "$AUTH_SERVICE_URL"

# User Service
create_service "user-service" "$USER_SERVICE_URL"

# Asset Service
create_service "asset-service" "$ASSET_SERVICE_URL"

# Feed Service
create_service "feed-service" "$FEED_SERVICE_URL"

# Messaging Service
create_service "messaging-service" "$MESSAGING_SERVICE_URL"

# Realtime Gateway
create_service "realtime-gateway" "$REALTIME_GATEWAY_URL"

# AI Service
create_service "ai-service" "$AI_SERVICE_URL"

# =============================================================================
# Configure Routes
# =============================================================================

echo ""
echo "Configuring Routes..."
echo "-------------------------------------------"

# Auth routes - /auth/* -> auth-service
# strip_path=true removes the /auth gateway prefix; frontend calls /auth/<api-path>
# (e.g. /auth/auth/login) and the service receives <api-path> (e.g. /auth/login)
create_route "auth-service" "auth-routes" '["/auth"]' true

# User routes - /users/* -> user-service
# strip_path=true removes the /users gateway prefix; frontend calls /users/<api-path>
# (e.g. /users/users for list, /users/profile for profile) and the service receives <api-path>
create_route "user-service" "user-routes" '["/users"]' true

# Asset routes - /assets/* -> asset-service
# The gateway prefix groups both /assets and /webhook endpoints under the service.
create_route "asset-service" "asset-routes" '["/assets"]' true

# Feed routes - /feeds/* -> feed-service
create_route "feed-service" "feed-routes" '["/feeds"]' true

# Messaging routes - /messaging/* -> messaging-service
# strip_path=true removes the /messaging gateway prefix; frontend calls
# /messaging/<api-path> (e.g. /messaging/messaging/conversations) and the service receives <api-path>
create_route "messaging-service" "messaging-routes" '["/messaging"]' true

# Realtime routes - /realtime/* -> realtime-gateway
# Kong preserves the WebSocket upgrade while stripping /realtime, so the
# Socket.IO handshake at /realtime/socket.io reaches the gateway at /socket.io.
create_route "realtime-gateway" "realtime-routes" '["/realtime"]' true

# AI routes - /ai/* -> ai-service
create_route "ai-service" "ai-routes" '["/ai"]' true

# =============================================================================
# Configure Global Plugins
# =============================================================================

echo ""
echo "Configuring Global Plugins..."
echo "-------------------------------------------"

# CORS Plugin
enable_global_plugin "cors" '{
    "origins": ["*"],
    "methods": ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    "headers": ["Accept", "Authorization", "Content-Type", "X-Request-ID", "X-Client-ID"],
    "exposed_headers": ["X-Request-ID"],
    "credentials": true,
    "max_age": 3600
}'

# Rate Limiting Plugin
enable_global_plugin "rate-limiting" '{
    "minute": 100,
    "hour": 1000,
    "policy": "local"
}'

# Request Transformer Plugin (add gateway header)
enable_global_plugin "request-transformer" '{
    "add": {
        "headers": ["X-Gateway-Request:true"]
    }
}'

# Response Transformer Plugin (add gateway headers to response)
enable_global_plugin "response-transformer" '{
    "add": {
        "headers": ["X-Kong-Proxy:true"]
    }
}'

# =============================================================================
# Summary
# =============================================================================

echo ""
echo "=================================================="
echo "Kong Gateway Configuration Complete!"
echo "=================================================="
echo ""
echo "Services configured:"
echo "  - auth-service      -> $AUTH_SERVICE_URL"
echo "  - user-service      -> $USER_SERVICE_URL"
echo "  - asset-service     -> $ASSET_SERVICE_URL"
echo "  - feed-service      -> $FEED_SERVICE_URL"
echo "  - messaging-service -> $MESSAGING_SERVICE_URL"
echo "  - realtime-gateway  -> $REALTIME_GATEWAY_URL"
echo "  - ai-service        -> $AI_SERVICE_URL"
echo ""
echo "Routes configured:"
echo "  - /auth/*      -> auth-service"
echo "  - /users/*     -> user-service"
echo "  - /assets/*    -> asset-service"
echo "  - /feeds/*     -> feed-service"
echo "  - /messaging/* -> messaging-service"
echo "  - /realtime/*  -> realtime-gateway"
echo "  - /ai/*        -> ai-service"
echo ""
echo "Global Plugins enabled:"
echo "  - CORS"
echo "  - Rate Limiting (100/min, 1000/hour)"
echo "  - Request Transformer"
echo "  - Response Transformer"
echo ""
echo "Gateway URLs:"
echo "  - Proxy:     http://localhost:3000"
echo "  - Admin API: http://localhost:8001"
echo "  - Manager:   http://localhost:8002"
echo ""
echo "Test commands:"
echo "  # Test auth service:"
echo "  curl 'http://localhost:3000/auth/auth/login?client_id=<client-id>&redirect_uri=http://localhost:4000'"
echo ""
echo "  # Test user service:"
echo "  curl -H \"Authorization: Bearer <token>\" http://localhost:3000/users/profile"
echo ""
echo "Note: JWT validation is handled by downstream services."
echo "Kong provides routing, CORS, rate limiting, and logging."
echo "=================================================="
