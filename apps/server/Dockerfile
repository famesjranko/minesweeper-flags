FROM node:22-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
COPY tsconfig.base.json ./
COPY packages/game-engine/package.json packages/game-engine/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY apps/server/package.json apps/server/package.json
COPY apps/client/package.json apps/client/package.json

RUN npm ci

COPY packages ./packages
COPY apps/server ./apps/server

RUN find packages apps -name '*.tsbuildinfo' -delete \
 && npx tsc -b packages/game-engine packages/shared apps/server --force

FROM node:22-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
COPY packages/game-engine/package.json packages/game-engine/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY apps/server/package.json apps/server/package.json
COPY apps/client/package.json apps/client/package.json

RUN npm ci --omit=dev

COPY --from=builder /app/packages/game-engine/dist ./packages/game-engine/dist
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/apps/server/dist ./apps/server/dist

EXPOSE 3001

CMD ["node", "apps/server/dist/index.js"]
