#!/bin/bash
# NurzWorks HQ launcher - double-click this file on your Mac.
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo ""
  echo "  Node.js is not installed."
  echo "  Download the LTS version from https://nodejs.org, install it, then double-click start.command again."
  echo ""
  open "https://nodejs.org/en/download" 2>/dev/null
  read -n 1 -s -r -p "  Press any key to close."
  exit 1
fi

MAJOR=$(node -p "process.versions.node.split('.')[0]")
MINOR=$(node -p "process.versions.node.split('.')[1]")
if [ "$MAJOR" -lt 22 ] || { [ "$MAJOR" -eq 22 ] && [ "$MINOR" -lt 13 ]; }; then
  echo ""
  echo "  NurzWorks HQ needs Node.js 22.13 or newer (you have $(node -v))."
  echo "  Install the current LTS from https://nodejs.org and try again."
  echo ""
  open "https://nodejs.org/en/download" 2>/dev/null
  read -n 1 -s -r -p "  Press any key to close."
  exit 1
fi

PORT="${PORT:-4200}"
( sleep 1.5; open "http://localhost:$PORT" ) &
PORT=$PORT node server.js
