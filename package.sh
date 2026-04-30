#!/usr/bin/env bash
set -euo pipefail

# Read version from manifest.json
VERSION=$(grep '"version"' manifest.json | head -1 | sed 's/.*"version": *"\([^"]*\)".*/\1/')
OUTPUT="commerce-events-debugger-v${VERSION}.zip"

# Remove previous build
rm -f "$OUTPUT"

zip "$OUTPUT" \
  manifest.json \
  devtools.html devtools.js \
  panel.html panel.js \
  popup.html popup.js \
  background.js content.js injected.js shared.js \
  icons/icon16.png icons/icon48.png icons/icon128.png

echo "Packaged: $OUTPUT"
echo ""
echo "To install:"
echo "  1. Unzip $OUTPUT"
echo "  2. chrome://extensions → Developer mode ON → Load unpacked → select the folder"
