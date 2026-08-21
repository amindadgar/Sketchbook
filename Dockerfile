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
RUN pnpm build


# The game itself is static: a bundle, a page and 30MB of models and audio.
FROM nginx:alpine AS game

COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY index.html favicon.ico /usr/share/nginx/html/
COPY build/assets /usr/share/nginx/html/build/assets
COPY --from=build /app/build/sketchbook.min.js /usr/share/nginx/html/build/sketchbook.min.js

EXPOSE 80


# The party relay. Only needed for multiplayer; the game runs fine without it.
FROM node:20-alpine AS relay
WORKDIR /app

# Only ws, at the version package.json asks for. Installing every production
# dependency would drag three.js and jQuery into a WebSocket server, and npm
# installs everything in a package.json it can see, so the manifest is read
# from outside the workdir rather than placed in it.
COPY package.json /tmp/package.json
RUN npm install --no-package-lock --no-audit --no-fund \
    "ws@$(node -p "require('/tmp/package.json').dependencies.ws")" \
    && rm /tmp/package.json

COPY server ./server

# Nothing here needs root
USER node
ENV PORT=9000
EXPOSE 9000

CMD ["node", "server/index.js"]
