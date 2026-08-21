#!/bin/sh
# Writes the runtime config the page reads, from this container's environment.
# nginx runs everything in /docker-entrypoint.d before starting.
set -e

target=/usr/share/nginx/html/config.js

if [ -n "$PARTY_SERVER_URL" ]; then
	printf 'window.SKETCHBOOK_CONFIG = { partyServer: "%s" };\n' "$PARTY_SERVER_URL" > "$target"
	echo "party-config: default relay is $PARTY_SERVER_URL"
else
	printf 'window.SKETCHBOOK_CONFIG = { partyServer: null };\n' > "$target"
	echo "party-config: PARTY_SERVER_URL unset, clients will guess from the page URL"
fi
