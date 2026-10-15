#!/usr/bin/env bash
# Fetch the free voice assets into $MODELS (default /tmp/alo-voice-models). Nothing here is committed: the weights are 325 MB.
# Sources are npm and PyPI only, because Hugging Face and GitHub release downloads are blocked in the build sandbox.
#   Kokoro-82M v1.0 fp32 ONNX (Apache-2.0): npm kokoro-fp32{a,b,c}-shards 1.0.0, 19 shards joined in order.
#   Kokoro voices (Apache-2.0): npm kokoro-js 1.2.1, voices/*.bin.
#   Phoneme vocabulary: config.json from the kokoro-onnx 0.6.1 wheel (MIT). Lexicons: misaki 0.7.4 wheel (Apache-2.0).
set -euo pipefail
MODELS="${MODELS:-/tmp/alo-voice-models}"
WORK="$(mktemp -d)"
mkdir -p "$MODELS"
cd "$WORK"
for p in kokoro-fp32a-shards@1.0.0 kokoro-fp32b-shards@1.0.0 kokoro-fp32c-shards@1.0.0 kokoro-js@1.2.1; do
  npm pack "$p" --silent >/dev/null
done
for f in *.tgz; do d="${f%.tgz}"; mkdir -p "$d"; tar xzf "$f" -C "$d"; done
: > "$MODELS/kokoro-v1.0-fp32.onnx"
for i in $(seq 0 18); do cat kokoro-fp32*-shards-1.0.0/package/kokoro-fp32.part$i.bin >> "$MODELS/kokoro-v1.0-fp32.onnx"; done
echo "8fbea51ea711f2af382e88c833d9e288c6dc82ce5e98421ea61c058ce21a34cb  $MODELS/kokoro-v1.0-fp32.onnx" | sha256sum -c -
rm -rf "$MODELS/voices"; cp -r kokoro-js-1.2.1/package/voices "$MODELS/voices"
python3 -m pip download -q --no-deps kokoro-onnx==0.6.1 misaki==0.7.4 -d wheels
python3 - "$MODELS" <<'PY'
import sys, zipfile, glob
out = sys.argv[1]
for whl, members in [(glob.glob('wheels/kokoro_onnx-*.whl')[0], {'kokoro_onnx/config.json': 'config.json'}),
                     (glob.glob('wheels/misaki-*.whl')[0], {'misaki/data/us_gold.json': 'us_gold.json', 'misaki/data/us_silver.json': 'us_silver.json'})]:
    with zipfile.ZipFile(whl) as z:
        for src, dst in members.items():
            open(f'{out}/{dst}', 'wb').write(z.read(src))
PY
rm -rf "$WORK"
echo "models in $MODELS"
