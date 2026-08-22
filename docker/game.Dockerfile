# syntax=docker/dockerfile:1

# The bundle is rebuilt here rather than copied from the repo, so what ships in
# the image is always built from the source next to it.
FROM node:20-slim AS build
WORKDIR /app

RUN npm install -g pnpm@10.19.0

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY tsconfig.json webpack.common.js webpack.prod.js ./
COPY src ./src
COPY shared ./shared
RUN pnpm build


# The game itself is static: a bundle, a page and 30MB of models and audio.
FROM nginx:alpine

# A template rather than a plain config: the official image runs envsubst over
# /etc/nginx/templates at startup, which is how the port becomes settable.
# Hosts like Railway hand the port to the container and expect it to be used.
COPY docker/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY index.html favicon.ico config.js manifest.webmanifest sw.js /usr/share/nginx/html/
COPY icons /usr/share/nginx/html/icons
# Rewrites config.js from PARTY_SERVER_URL when the container starts
COPY --chmod=0755 docker/party-config.sh /docker-entrypoint.d/40-party-config.sh
COPY build/assets /usr/share/nginx/html/build/assets
COPY --from=build /app/build/sketchbook.min.js /usr/share/nginx/html/build/sketchbook.min.js

ENV PORT=80
EXPOSE 80
