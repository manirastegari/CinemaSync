# ── Build stage ───────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder
RUN apk add --no-cache python3 make g++

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# ── Production stage ───────────────────────────────────────────────────────────
FROM node:20-alpine AS runner
RUN apk add --no-cache python3 make g++

WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --omit=dev
RUN npm rebuild better-sqlite3

COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY server.js ./
COPY next.config.js ./
COPY lib ./lib
COPY pages ./pages

EXPOSE 3000
CMD ["node", "server.js"]
