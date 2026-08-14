#!/usr/bin/env bash
#
# Takes a bare RunPod ComfyUI pod to a working LTX 2.5 setup.
#
# Run it in the pod's terminal (Jupyter → Terminal, or SSH):
#   curl -sL <this-url> | bash
# or paste the whole file.
#
# Safe to re-run: every step checks before doing work.
#
# Why each step exists — all three are required, and each fails confusingly
# if skipped:
#   1. ComfyUI < v0.33.1 has no LTX 2.5 text-encoder path. Its LTXV branch only
#      knows Gemma 3, so the Gemma 4 encoder falls through to a SentencePiece
#      tokenizer and dies with "not enough values to unpack (expected 4, got 1)".
#   2. The conv VAE pairs with the convrot transformer. The plain -bf16 file is
#      the DiffVAE and fails with a conv-kernel size mismatch.
#   3. Both LTX AV loaders read their dropdowns from checkpoints/, so the
#      transformer and audio VAE need to be visible there.

set -euo pipefail

COMFY_VERSION="v0.33.1"
REPO="Lightricks/LTX-2.5"

log() { printf '\n\033[1;33m▶ %s\033[0m\n' "$*"; }
ok()  { printf '\033[0;32m  ✓ %s\033[0m\n' "$*"; }

# ── Locate ComfyUI ────────────────────────────────────────────────────────────
COMFY=""
for c in /workspace/runpod-slim/ComfyUI /workspace/ComfyUI /ComfyUI /opt/ComfyUI; do
    [ -f "$c/main.py" ] && COMFY="$c" && break
done
if [ -z "$COMFY" ]; then
    COMFY=$(dirname "$(find / -maxdepth 5 -name main.py -path '*ComfyUI*' 2>/dev/null | head -1)")
fi
[ -n "$COMFY" ] && [ -f "$COMFY/main.py" ] || { echo "ERROR: ComfyUI not found"; exit 1; }
log "ComfyUI at $COMFY"

MODELS="$COMFY/models"

# ── Recover the pod's env ─────────────────────────────────────────────────────
# An SSH session doesn't inherit the container's environment, and RunPod only
# mirrors some of it into /etc/rp_environment — HF_TOKEN is not among them.
# PID 1 always has the full set.
[ -f /etc/rp_environment ] && . /etc/rp_environment 2>/dev/null || true
if [ -z "${HF_TOKEN:-}" ] && [ -r /proc/1/environ ]; then
    HF_TOKEN=$(tr '\0' '\n' < /proc/1/environ | sed -n 's/^HF_TOKEN=//p' | head -1)
    export HF_TOKEN
fi
if [ -z "${HF_TOKEN:-}" ]; then
    echo "ERROR: HF_TOKEN not found. The LTX 2.5 repo is gated — set it and re-run:"
    echo "  export HF_TOKEN=hf_...  &&  bash \$0"
    exit 1
fi
ok "HF token found"

# ── 1. Upgrade ComfyUI ────────────────────────────────────────────────────────
cd "$COMFY"
CURRENT=$(python3 -c "import comfyui_version; print(comfyui_version.__version__)" 2>/dev/null || echo "unknown")
if [ "$CURRENT" = "${COMFY_VERSION#v}" ]; then
    ok "ComfyUI already $COMFY_VERSION"
else
    log "Upgrading ComfyUI $CURRENT → $COMFY_VERSION (needed for LTX 2.5)"
    git fetch --depth 1 origin tag "$COMFY_VERSION" 2>&1 | tail -2
    git checkout "$COMFY_VERSION" 2>&1 | tail -2
    pip install -q -r requirements.txt 2>&1 | tail -3
    ok "Upgraded"
fi

# ── 2. Download models ────────────────────────────────────────────────────────
command -v hf >/dev/null 2>&1 || pip install -q -U "huggingface_hub[cli]"

fetch() {   # fetch <repo-path> <dest-dir>
    local src="$1" dest="$2" name
    name=$(basename "$src")
    if [ -s "$dest/$name" ]; then
        ok "$name already present"
        return
    fi
    mkdir -p "$dest"
    log "Downloading $name"
    hf download "$REPO" "$src" --local-dir /tmp/hfdl >/dev/null
    mv "/tmp/hfdl/$src" "$dest/$name"
    ok "$name"
}

fetch diffusion_models/ltx-2.5-22b-distilled-transformer-comfy-int8-convrot.safetensors "$MODELS/diffusion_models"
fetch text_encoders/gemma4-12b-with-proj-ltx-2.5-comfy-int8-convrot.safetensors        "$MODELS/text_encoders"
fetch vae/ltx-2.5-video-vae-conv-bf16.safetensors                                       "$MODELS/vae"
fetch vae/ltx-2.5-audio-vae-bf16.safetensors                                            "$MODELS/vae"
rm -rf /tmp/hfdl

# ── 3. Expose the AV loaders' inputs in checkpoints/ ──────────────────────────
log "Linking into checkpoints/"
mkdir -p "$MODELS/checkpoints"
ln -sfn ../diffusion_models/ltx-2.5-22b-distilled-transformer-comfy-int8-convrot.safetensors \
        "$MODELS/checkpoints/ltx-2.5-22b-distilled-transformer-comfy-int8-convrot.safetensors"
ln -sfn ../vae/ltx-2.5-audio-vae-bf16.safetensors \
        "$MODELS/checkpoints/ltx-2.5-audio-vae-bf16.safetensors"
for f in "$MODELS"/checkpoints/*.safetensors; do
    [ -e "$f" ] || { echo "ERROR: broken symlink $f"; exit 1; }
done
ok "checkpoints/ linked"

# ── 4. Restart ComfyUI ────────────────────────────────────────────────────────
log "Restarting ComfyUI"
pkill -f "main.py.*--port 8188" 2>/dev/null || true
sleep 5
cd "$COMFY"
setsid nohup python3 main.py --listen 0.0.0.0 --port 8188 --enable-cors-header \
    > /workspace/comfyui.log 2>&1 < /dev/null &

for _ in $(seq 1 60); do
    sleep 5
    if curl -sf --max-time 5 http://127.0.0.1:8188/system_stats >/dev/null 2>&1; then
        VER=$(curl -s --max-time 5 http://127.0.0.1:8188/system_stats \
              | python3 -c "import json,sys; print(json.load(sys.stdin)['system']['comfyui_version'])" 2>/dev/null)
        printf '\n\033[0;32m════════════════════════════════════════\033[0m\n'
        ok "ComfyUI $VER is up — LTX 2.5 ready"
        printf '\033[0;32m════════════════════════════════════════\033[0m\n\n'
        df -h "$MODELS" | tail -1
        exit 0
    fi
done

echo "ComfyUI did not come up in time. Check /workspace/comfyui.log"
tail -20 /workspace/comfyui.log
exit 1
