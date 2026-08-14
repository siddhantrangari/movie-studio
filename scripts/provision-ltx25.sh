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

# ── 4. Restart the container ──────────────────────────────────────────────────
# Deliberately NOT `pkill && nohup python3 main.py`. A process started from an
# SSH session doesn't inherit the container's GPU context, and torch then dies
# with "CUDA unknown error" even though nvidia-smi works fine. Resetting the
# container lets the image's own entrypoint start ComfyUI the way it was meant
# to be started. RunPod puts the pod id and a scoped API key in the pod env.
log "Restarting the container so ComfyUI starts with a clean GPU context"

if [ -n "${BOOT_PROVISION:-}" ]; then
    ok "Running at container boot (BOOT_PROVISION set) — skipping reset since we are already booting."
    exit 0
fi

POD_ID="${RUNPOD_POD_ID:-}"
RP_KEY="${RUNPOD_API_KEY:-}"

if [ -z "$POD_ID" ] || [ -z "$RP_KEY" ]; then
    printf '\n\033[1;33m  Could not self-restart (RUNPOD_POD_ID / RUNPOD_API_KEY missing).\033[0m\n'
    echo "  Models are in place. Restart the pod from the RunPod console and"
    echo "  ComfyUI will come up with LTX 2.5 ready."
    exit 0
fi

echo "  Models are in place. Resetting pod $POD_ID —"
echo "  this SSH session will drop, which is expected."
echo "  ComfyUI is back about a minute later at port 8188."

curl -s --max-time 30 -X POST \
    "https://rest.runpod.io/v1/pods/${POD_ID}/reset" \
    -H "Authorization: Bearer ${RP_KEY}" >/dev/null 2>&1 || true

printf '\n\033[0;32m  ✓ Reset requested — provisioning complete\033[0m\n\n'
exit 0
