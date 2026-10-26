# syntax=docker/dockerfile:1
FROM node:26-slim AS web
WORKDIR /web
COPY web/package*.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

FROM node:26-slim AS server
WORKDIR /srv
COPY server/package*.json ./
RUN npm ci
COPY server/ ./
RUN npm run build && npm prune --omit=dev

FROM node:26-slim
ENV NODE_ENV=production PORT=8080 DATA_DIR=/data MEDIA_DIR=/media WEB_DIR=/app/web
# node:sqlite is still flagged experimental on Node 22; silence only that, so deprecations and other warnings stay visible
ENV NODE_OPTIONS=--disable-warning=ExperimentalWarning
# ffmpeg lets Homeroom trim, fade and normalise long goal horns on demand (without it horns are cut on an MP3 frame boundary, no fade)
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=server /srv/node_modules node_modules
COPY --from=server /srv/dist dist
COPY --from=server /srv/package.json ./
COPY --from=web /web/dist web
RUN mkdir -p /data /media && chown node:node /data /media
# Compose sets `user: "0:0"` so the entrypoint can take ownership of bind-mounted volumes created by Docker
# (root:0) and then drop to this user; started unprivileged it just execs the command (docs/DEPLOYMENT.md).
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod 755 /usr/local/bin/docker-entrypoint.sh
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "dist/index.js"]
