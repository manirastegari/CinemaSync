FROM node:20-alpine
RUN apk add --no-cache python3 make g++ ffmpeg

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "server.js"]
