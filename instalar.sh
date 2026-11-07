#!/usr/bin/env sh
# Instala Watchlist en macOS / Linux.  Uso: ./instalar.sh
# No hace falta instalar nada antes: descarga su propio Node.js (portátil) la primera vez.
# Una vez en cada PC. Después la app se actualiza sola desde GitHub al abrirse.
set -e
cd "$(dirname "$0")"

NODE_VERSION=24.16.0
if [ "$(uname)" = "Darwin" ]; then
  HOME_DIR="${WATCHLIST_HOME:-$HOME/Library/Application Support/Watchlist}"; OS=darwin
else
  HOME_DIR="${WATCHLIST_HOME:-$HOME/.local/share/watchlist}"; OS=linux
fi
case "$(uname -m)" in arm64|aarch64) ARCH=arm64 ;; *) ARCH=x64 ;; esac
NODE_DIR="$HOME_DIR/node"

if [ ! -x "$NODE_DIR/bin/node" ]; then
  echo "Descargando Node.js $NODE_VERSION (solo la primera vez)…"
  PKG="node-v$NODE_VERSION-$OS-$ARCH"
  mkdir -p "$HOME_DIR"
  curl -L --fail --progress-bar "https://nodejs.org/dist/v$NODE_VERSION/$PKG.tar.gz" | tar -xz -C "$HOME_DIR"
  rm -rf "$NODE_DIR"
  mv "$HOME_DIR/$PKG" "$NODE_DIR"
fi

export PATH="$NODE_DIR/bin:$PATH"
"$NODE_DIR/bin/node" apps/desktop/launch/install.mjs
