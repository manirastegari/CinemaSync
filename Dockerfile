# ── Build stage ──────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder
RUN apk add --no-cache python3 make g++
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# ── Production stage ─────────────────────────────────────────────────────────
FROM node:20-alpine
RUN apk add --no-cache ffmpeg ca-certificates
WORKDIR /app
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/public ./public
COPY --from=builder /app/package.json ./
COPY --from=builder /app/server.js ./
COPY --from=builder /app/lib ./lib
COPY --from=builder /app/next.config.js ./

ENV NODE_ENV=production
# Cloud Run injects PORT automatically; fallback to 3000 locally
ENV PORT=3000
EXPOSE 3000
CMD ["node", "server.js"]
