# syntax=docker/dockerfile:1

# ── Stage 1: build SPA tĩnh ─────────────────────────────────────────────
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# Gọi API cùng origin qua nginx proxy (/api) — không hardcode host backend.
ENV VITE_API_BASE_URL=/api
RUN npm run build

# ── Stage 2: phục vụ bằng nginx ─────────────────────────────────────────
FROM nginx:1.27-alpine AS runtime
# nginx alpine chạy được với user không phải root ở cổng >1024 (8080).
COPY nginx.conf /etc/nginx/conf.d/default.conf
RUN rm -f /etc/nginx/conf.d/default.conf.default 2>/dev/null || true
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 8080
# Dùng 127.0.0.1 (không phải 'localhost') vì busybox wget có thể thử ::1 trước,
# còn nginx chỉ bind IPv4 0.0.0.0 → 'localhost' sẽ connection refused.
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/ || exit 1
