FROM node:22-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
COPY tsconfig.base.json ./
COPY packages/game-engine/package.json packages/game-engine/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY apps/server/package.json apps/server/package.json
COPY apps/signaling/package.json apps/signaling/package.json
COPY apps/client/package.json apps/client/package.json

RUN npm ci

COPY packages/shared ./packages/shared
COPY packages/game-engine ./packages/game-engine
COPY apps/signaling ./apps/signaling

RUN find packages apps -name '*.tsbuildinfo' -delete \
 && npm run build -w @minesweeper-flags/game-engine \
 && npm run build -w @minesweeper-flags/shared \
 && npm run build -w @minesweeper-flags/signaling

FROM node:22-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
COPY packages/game-engine/package.json packages/game-engine/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY apps/server/package.json apps/server/package.json
COPY apps/signaling/package.json apps/signaling/package.json
COPY apps/client/package.json apps/client/package.json

RUN npm ci --omit=dev

COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/packages/game-engine/dist ./packages/game-engine/dist
COPY --from=builder /app/apps/signaling/dist ./apps/signaling/dist

EXPOSE 3002
USER node

CMD ["node", "apps/signaling/dist/index.js"]
