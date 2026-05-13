# Multi-stage build for production
FROM node:22-bullseye-slim AS builder

WORKDIR /app

RUN apt-get update && \
    apt-get install -y --no-install-recommends python3 make g++ openssl ca-certificates && \
    rm -rf /var/lib/apt/lists/*

RUN corepack enable

COPY package.json pnpm-lock.yaml .npmrc ./
COPY nest-cli.json ./
COPY tsconfig*.json ./

COPY libs/ ./libs/

COPY prisma ./prisma

COPY src/ ./src/

RUN pnpm install --frozen-lockfile

RUN pnpm exec prisma generate

RUN pnpm run build

FROM node:22-bullseye-slim AS production

WORKDIR /app

RUN apt-get update && \
    apt-get install -y --no-install-recommends curl openssl ca-certificates python3 make g++ && \
    rm -rf /var/lib/apt/lists/*

RUN corepack enable

COPY package.json pnpm-lock.yaml .npmrc ./

RUN pnpm install --frozen-lockfile --prod

# Copy built application
COPY --from=builder /app/dist ./dist

# Copy Prisma schema from root
COPY prisma ./prisma

RUN pnpm exec prisma generate

# Create non-root user
RUN groupadd --gid 1001 nodejs && \
    useradd --uid 1001 --gid nodejs --create-home --shell /usr/sbin/nologin nestjs

# Create writable directories for file uploads and storage
RUN mkdir -p /app/tmp /app/storage && \
    chown -R nestjs:nodejs /app/dist /app/prisma /app/tmp /app/storage
USER nestjs

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD curl -f http://localhost:3000/health || exit 1

# Correr migraciones pendientes y luego arrancar; exec hace que node sea PID 1
CMD ["sh", "-c", "node_modules/.bin/prisma migrate deploy && exec node dist/src/main.js"]
