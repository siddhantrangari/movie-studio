#!/usr/bin/env bash
set -euo pipefail

# ─────────────────────────────────────────────────────────────────────────────
# Movie Studio Cinema Engine — PostgreSQL Container Setup & Migration Script
# ─────────────────────────────────────────────────────────────────────────────

CONTAINER_NAME="movie-studio-db"
DB_PORT="5435"
DB_NAME="movie_studio"
DB_USER="studio_admin"
DB_PASS="StudioSecurePass2026!"
VOLUME_NAME="movie_studio_pgdata"

echo "🐘 Checking PostgreSQL container ($CONTAINER_NAME)..."

if [ "$(docker ps -q -f name=^/${CONTAINER_NAME}$)" ]; then
    echo "✓ PostgreSQL container $CONTAINER_NAME is already running on port $DB_PORT."
elif [ "$(docker ps -aq -f name=^/${CONTAINER_NAME}$)" ]; then
    echo "▶ Starting existing container $CONTAINER_NAME..."
    docker start "$CONTAINER_NAME"
else
    echo "🚀 Creating and launching new PostgreSQL container $CONTAINER_NAME..."
    docker run -d \
        --name "$CONTAINER_NAME" \
        --restart unless-stopped \
        -e POSTGRES_DB="$DB_NAME" \
        -e POSTGRES_USER="$DB_USER" \
        -e POSTGRES_PASSWORD="$DB_PASS" \
        -p 127.0.0.1:"$DB_PORT":5432 \
        -v "$VOLUME_NAME":/var/lib/postgresql/data \
        postgres:16-alpine
fi

echo "⏳ Waiting for PostgreSQL to be ready on port $DB_PORT..."
for i in {1..30}; do
    if docker exec "$CONTAINER_NAME" pg_isready -U "$DB_USER" -d "$DB_NAME" >/dev/null 2>&1; then
        echo "✅ PostgreSQL is ready and accepting connections!"
        break
    fi
    sleep 1
done

echo "📦 Running automatic schema initialization and data migration..."
DATABASE_URL="postgresql://${DB_USER}:${DB_PASS}@127.0.0.1:${DB_PORT}/${DB_NAME}" \
npx tsx scripts/migrate-json-to-pg.ts

echo "🎉 Database setup and migration complete!"
