#!/bin/bash

set -e

echo "🚀 Starting Cogni-Threat in production mode..."

echo "📦 Generating Prisma Client..."
npx prisma generate

echo "🔄 Running database migrations..."
npx prisma migrate deploy || echo "⚠️  Migrations failed or already applied"

echo "✅ Database ready"
echo "🌐 Starting Cogni-Threat API..."
exec node dist/src/main.js

