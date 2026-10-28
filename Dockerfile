# syntax=docker/dockerfile:1

ARG NODE_VERSION=24

# ---- build the web UI ------------------------------------------------------
FROM node:${NODE_VERSION}-bookworm-slim AS web
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci --no-audit --no-fund
COPY web web
RUN npm run build --workspace web

# ---- server deps (production only) -----------------------------------------
FROM node:${NODE_VERSION}-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci --no-audit --no-fund --omit=dev --workspace server

# ---- runtime ---------------------------------------------------------------
FROM node:${NODE_VERSION}-bookworm-slim
ARG VERSION=dev
LABEL org.opencontainers.image.title="Pangolin Traffic Viewer" \
      org.opencontainers.image.description="Globe visualization, search and alerting for Pangolin traffic logs" \
      org.opencontainers.image.source="https://github.com/vitafortis/Pangolin-traffic-viewer" \
      org.opencontainers.image.version="${VERSION}"

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8787 \
    DATA_DIR=/data

WORKDIR /app
COPY --from=deps /app/node_modules node_modules
COPY package.json ./
COPY server server
COPY --from=web /app/web/dist web/dist

RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"

WORKDIR /app/server
CMD ["node", "--import", "tsx", "src/index.ts"]
