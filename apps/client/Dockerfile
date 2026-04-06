FROM node:22-alpine AS builder

WORKDIR /app

ARG VITE_SOCKET_URL
ARG VITE_SOCKET_PATH=/ws
ARG VITE_DEPLOYMENT_MODE=server
ARG VITE_P2P_STUN_URLS
ARG VITE_P2P_SIGNALING_URL
ENV VITE_SOCKET_URL=${VITE_SOCKET_URL}
ENV VITE_SOCKET_PATH=${VITE_SOCKET_PATH}
ENV VITE_DEPLOYMENT_MODE=${VITE_DEPLOYMENT_MODE}
ENV VITE_P2P_STUN_URLS=${VITE_P2P_STUN_URLS}
ENV VITE_P2P_SIGNALING_URL=${VITE_P2P_SIGNALING_URL}

COPY package.json package-lock.json ./
COPY tsconfig.base.json ./
COPY packages/game-engine/package.json packages/game-engine/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY apps/client/package.json apps/client/package.json
COPY apps/server/package.json apps/server/package.json
COPY apps/signaling/package.json apps/signaling/package.json

RUN npm ci

COPY packages/shared ./packages/shared
COPY packages/game-engine ./packages/game-engine
COPY apps/client ./apps/client

RUN find packages apps -name '*.tsbuildinfo' -delete \
 && npm run build -w @minesweeper-flags/game-engine \
 && npm run build -w @minesweeper-flags/shared \
 && npm run build -w @minesweeper-flags/client

FROM nginx:1.27-alpine

COPY apps/client/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/apps/client/dist /usr/share/nginx/html

EXPOSE 8080
