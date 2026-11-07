#!/usr/bin/env sh
# Instala la Watchlist en macOS / Linux.  Uso: ./instalar.sh
# Hazlo una vez en cada PC. Después la app se actualiza sola desde GitHub al abrirse.
set -e
cd "$(dirname "$0")"
command -v node >/dev/null 2>&1 || { echo "Falta Node.js: instala la versión LTS desde https://nodejs.org"; exit 1; }
node apps/desktop/launch/install.mjs
