# syntax=docker/dockerfile:1

# The party relay. Only needed for multiplayer; the game runs fine without it.
FROM node:20-alpine
WORKDIR /app

# Only ws, at the version package.json asks for. Installing every production
# dependency would drag three.js and jQuery into a WebSocket server, and npm
# installs everything in a package.json it can see, so the manifest is read
# from outside the workdir rather than placed in it.
COPY package.json /tmp/package.json
RUN npm install --no-package-lock --no-audit --no-fund \
    "ws@$(node -p "require('/tmp/package.json').dependencies.ws")" \
    "pg@$(node -p "require('/tmp/package.json').dependencies.pg")" \
    && rm /tmp/package.json

COPY server ./server

# Nothing here needs root
USER node
ENV PORT=9000
EXPOSE 9000

CMD ["node", "server/index.js"]
