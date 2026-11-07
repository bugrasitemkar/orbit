#!/usr/bin/env bash
# Build Orbit.app and package it as a DMG.
#   ./scripts/build-dmg.sh            # host arch
#   ARCH=x64 ./scripts/build-dmg.sh   # Intel build (cross-compiled)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

VERSION="$(node -p "require('./package.json').version")"
ARCH="${ARCH:-$( [ "$(uname -m)" = arm64 ] && echo arm64 || echo x64 )}"
OUT="$ROOT/release"
APP="$OUT/Orbit.app"
DMG="$OUT/Orbit-$VERSION-$ARCH.dmg"
# pnpm skips bun's postinstall, so fall back to the platform package's binary.
BUN="$(command -v bun || true)"
if [ -z "$BUN" ] || ! "$BUN" --version >/dev/null 2>&1; then
  BUN="$(find "$ROOT/node_modules/.pnpm" -path '*@oven/bun-darwin-*/bin/bun' -type f | grep -v baseline | head -1)"
fi
[ -x "$BUN" ] || { echo "bun binary not found; run pnpm install" >&2; exit 1; }

echo "◤ Building web app"
pnpm --filter @orbit/web build

echo "◤ Compiling server (bun-darwin-$ARCH)"
rm -rf "$APP" "$DMG"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
"$BUN" build apps/server/src/index.ts --compile --minify \
  --target="bun-darwin-$ARCH" \
  --outfile "$APP/Contents/Resources/orbit-server"
cp -R apps/web/dist "$APP/Contents/Resources/web"

cat > "$APP/Contents/MacOS/Orbit" <<'LAUNCHER'
#!/bin/bash
RES="$(cd "$(dirname "$0")/../Resources" && pwd)"
PORT="${PORT:-4810}"
URL="http://localhost:$PORT"
SUPPORT="$HOME/Library/Application Support/Orbit"
LOG="$HOME/Library/Logs/Orbit.log"
mkdir -p "$SUPPORT" "$(dirname "$LOG")"

# Already running? Just open the UI.
if curl -fs -o /dev/null "$URL/api/projects" 2>/dev/null; then
  open "$URL"; exit 0
fi

export PORT ORBIT_DATA_DIR="$SUPPORT" ORBIT_WEB_DIST="$RES/web"
"$RES/orbit-server" >>"$LOG" 2>&1 &
SERVER=$!
trap 'kill $SERVER 2>/dev/null' EXIT TERM INT

# Wait for the first index pass, then open the browser.
for _ in $(seq 1 240); do
  if curl -fs -o /dev/null "$URL" 2>/dev/null; then open "$URL"; break; fi
  kill -0 $SERVER 2>/dev/null || exit 1
  sleep 0.5
done
wait $SERVER
LAUNCHER
chmod +x "$APP/Contents/MacOS/Orbit"

cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>Orbit</string>
  <key>CFBundleDisplayName</key><string>Orbit</string>
  <key>CFBundleIdentifier</key><string>dev.orbit.viewer</string>
  <key>CFBundleVersion</key><string>$VERSION</string>
  <key>CFBundleShortVersionString</key><string>$VERSION</string>
  <key>CFBundleExecutable</key><string>Orbit</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>LSMinimumSystemVersion</key><string>11.0</string>
  <key>NSHighResolutionCapable</key><true/>
</dict>
</plist>
PLIST

echo "◤ Ad-hoc signing"
# bun --compile leaves an invalid signature behind (macOS SIGKILLs it), so strip and re-sign.
codesign --remove-signature "$APP/Contents/Resources/orbit-server"
codesign --force --sign - "$APP/Contents/Resources/orbit-server"
codesign --force --sign - "$APP"
codesign --verify --deep --strict "$APP"

echo "◤ Creating DMG"
STAGE="$(mktemp -d)"
cp -R "$APP" "$STAGE/"
ln -s /Applications "$STAGE/Applications"
hdiutil create -volname "Orbit" -srcfolder "$STAGE" -ov -format UDZO "$DMG" >/dev/null
rm -rf "$STAGE"

echo "◤ Done → $DMG"
