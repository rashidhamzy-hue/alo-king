#!/usr/bin/env bash
# Rebuilds src/design/fonts/plex-arabic-{400,700}.woff2: IBM Plex Sans Arabic cut to the Arabic block the site uses (19 KB each
# instead of 43 KB), keeping every layout feature so shaping is unchanged. Needs fonttools and brotli:
#   python3 -m venv /tmp/v && /tmp/v/bin/pip install fonttools brotli && PYFTSUBSET=/tmp/v/bin/pyftsubset scripts/web/subset-fonts.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
for w in 400 700; do
  "${PYFTSUBSET:-pyftsubset}" "node_modules/@fontsource/ibm-plex-sans-arabic/files/ibm-plex-sans-arabic-arabic-$w-normal.woff2" \
    --unicodes="U+0600-066D,U+0670,U+067E,U+0686,U+06A4,U+06AF,U+06CC,U+06D5,U+200C-200F,U+2010-2011,U+25CC" \
    --layout-features='*' --flavor=woff2 --output-file="src/design/fonts/plex-arabic-$w.woff2"
done
