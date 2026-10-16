# ---- Stage 1: build frontend + backend ----
FROM node:22-alpine AS build
WORKDIR /app
RUN apk add --no-cache python3 make g++

# install workspaces
COPY package.json package-lock.json* ./
COPY server/package.json server/package.json
COPY web/package.json web/package.json
RUN npm install --no-audit --no-fund

# build web
COPY web/ web/
RUN npm run build -w web

# build server
COPY server/ server/
RUN npm run build -w server

# ---- Stage 2: runtime ----
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    DATA_DIR=/data \
    PORT=8080 \
    WEB_DIST=/app/web-dist

# production deps only for the server
COPY server/package.json ./server/package.json
RUN cd server && npm install --omit=dev --no-audit --no-fund

# artifacts
COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/web/dist ./web-dist

# doctl for CLI fallback (optional; safe if unavailable at runtime)
ARG DOCTL_VERSION=1.116.0
RUN apk add --no-cache curl ca-certificates \
 && (curl -sSL "https://github.com/digitalocean/doctl/releases/download/v${DOCTL_VERSION}/doctl-${DOCTL_VERSION}-linux-amd64.tar.gz" -o /tmp/doctl.tgz \
     && tar -xzf /tmp/doctl.tgz -C /usr/local/bin \
     && chmod +x /usr/local/bin/doctl \
     && rm /tmp/doctl.tgz) || echo "doctl install skipped"

RUN mkdir -p /data
VOLUME /data
EXPOSE 8080
CMD ["node", "server/dist/index.js"]
