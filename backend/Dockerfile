# syntax=docker/dockerfile:1

# ── Stage 1: cài toàn bộ deps (kể cả dev) để build + chạy migration ──────
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ── Stage 2: biên dịch TypeScript → dist ────────────────────────────────
FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

# ── Stage 3: runner migration (có node-pg-migrate + migrations) ─────────
# Dùng cho bước deploy: docker run --rm ... npm run migrate:up
FROM node:22-alpine AS migrate
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY migrations ./migrations
# node-pg-migrate đọc .env qua --envPath; production truyền DATABASE_URL qua env
# nên override script để không phụ thuộc file .env.
ENTRYPOINT ["npx", "node-pg-migrate", "-m", "migrations", "-j", "sql"]
CMD ["up"]

# ── Stage 4: runtime tối giản — chỉ prod deps + dist ────────────────────
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

# Cài lại chỉ dependencies production (bỏ tsx, vitest, eslint, node-pg-migrate...).
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist

# Chạy bằng user không phải root (node image có sẵn user 'node').
USER node

EXPOSE 4100
# Healthcheck dùng chính endpoint liveness của app.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://localhost:'+(process.env.PORT||4100)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/server.js"]
