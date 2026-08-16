#!/usr/bin/env bash
# ── seed-volume.sh ─────────────────────────────────────────────────────────────
# One-time model pre-seeder: downloads ALL weights for LTX 2.5 and MiniMax H3
# DIRECTLY into /workspace/runpod-slim/ComfyUI/models/ — which lives on the
# persistent network volume mounted at /workspace.
#
# KEY FIX: Do NOT use /opt/comfyui-baked — that's the container's baked image
# on the local 50GB disk. Always write to /workspace/* (the 200GB NFS volume).
# ────────────────────────────────────────────────────────────────────────────────

set -euo pipefail

LOG_DIR=/var/log/provision
LOG=$LOG_DIR/provision.log
mkdir -p "$LOG_DIR"
: > "$LOG"

PY=$(command -v python3 || command -v python)
[ -n "$PY" ] && ("$PY" -m http.server 7777 --directory "$LOG_DIR" >/dev/null 2>&1 &)

log()  { echo "[$(date -u +%H:%M:%S)] $*" | tee -a "$LOG"; }
ok()   { echo "[$(date -u +%H:%M:%S)] ✓ $*" | tee -a "$LOG"; }
err()  { echo "[$(date -u +%H:%M:%S)] ✗ $*" | tee -a "$LOG"; }

log "=== Movie Studio Volume Seeder starting ==="

# ── Confirm /workspace is the network volume ──────────────────────────────────
log "Workspace mount:"
df -h /workspace 2>/dev/null | tail -1 | tee -a "$LOG" || true

WORKSPACE_FREE=$(df /workspace 2>/dev/null | tail -1 | awk '{print $4}')
if [ -z "$WORKSPACE_FREE" ] || [ "$WORKSPACE_FREE" -lt 104857600 ]; then
    err "/workspace has < 100GB free — is the network volume mounted? Aborting."
    exit 1
fi
ok "/workspace has sufficient free space"

# ── Target path: ALWAYS use /workspace (the network volume mount) ──────────────
# /start.sh copies /opt/comfyui-baked → /workspace/runpod-slim/ComfyUI at boot.
# We pre-create the directory and write there directly so files survive pod death.
COMFY="/workspace/runpod-slim/ComfyUI"
MODELS="$COMFY/models"

log "Waiting for /start.sh to create $COMFY (runs in background)..."
for i in $(seq 1 30); do
    sleep 5
    if [ -d "$COMFY" ]; then
        ok "ComfyUI workspace ready: $COMFY"
        break
    fi
    # After 30s, create it ourselves so we don't wait forever
    if [ "$i" -eq 6 ]; then
        log "  /start.sh slow — pre-creating directory structure..."
        mkdir -p "$COMFY/models"
    fi
    if [ "$i" -ge 6 ] && [ -d "$COMFY/models" ]; then
        break
    fi
    log "  Waiting... ($((i * 5))s)"
done

mkdir -p "$MODELS/diffusion_models" "$MODELS/text_encoders" "$MODELS/vae" \
          "$MODELS/checkpoints" "$MODELS/clip" "$MODELS/unet"

ok "Target directory ready: $MODELS"
log "Volume usage before download:"
df -h /workspace | tail -1 | tee -a "$LOG"

# ── Install aria2 ──────────────────────────────────────────────────────────────
install_aria2() {
    command -v aria2c &>/dev/null && return
    log "Installing aria2..."
    apt-get update -qq 2>/dev/null | tail -1 | tee -a "$LOG" || true
    apt-get install -y -q aria2 2>/dev/null | tail -3 | tee -a "$LOG" || true
}

# ── Download helper ────────────────────────────────────────────────────────────
fetch() {
    local url="$1" dest_dir="$2" name="$3"
    local fpath="$dest_dir/$name"
    local size
    size=$(stat -c%s "$fpath" 2>/dev/null || echo 0)
    if [ "$size" -gt 1048576 ]; then
        ok "$name already present ($(( size / 1073741824 ))GB) — skipping"
        return
    fi
    mkdir -p "$dest_dir"
    log "Downloading $name → $dest_dir"
    install_aria2

    local args=(
        --dir="$dest_dir"
        --out="$name"
        --split=16
        --max-connection-per-server=16
        --min-split-size=32M
        --max-tries=5
        --retry-wait=5
        --continue=true
        --console-log-level=warn
        --summary-interval=15
        --file-allocation=none
    )
    [ -n "${HF_TOKEN:-}" ] && args+=(--header="Authorization: Bearer ${HF_TOKEN}")

    if aria2c "${args[@]}" "$url" 2>&1 | tee -a "$LOG"; then
        ok "$name downloaded successfully"
    else
        err "$name download FAILED (aria2 exit $?) — will continue with other models"
    fi
}

# ════════════════════════════════════════════════════════════════════════════════
# SECTION 1: LTX Video 2.5 (~37 GB)
# ════════════════════════════════════════════════════════════════════════════════
log ""
log "═══ Section 1: LTX Video 2.5 (~37 GB) ═══"

# Main transformer (6GB)
fetch "https://huggingface.co/Lightricks/LTX-Video/resolve/main/ltx-video-2b-v0.9.5.safetensors" \
      "$MODELS/unet" "ltx-video-2b-v0.9.5.safetensors"

# VAE
fetch "https://huggingface.co/Lightricks/LTX-Video/resolve/main/vae/ltxv_vae.safetensors" \
      "$MODELS/vae" "ltxv_vae.safetensors"

# T5 text encoder (bf16, ~9GB)
fetch "https://huggingface.co/city96/T5-v1_1-xxl-encoder-bf16/resolve/main/model.safetensors" \
      "$MODELS/clip" "t5xxl_bf16.safetensors"

# T5 fp8 (smaller, used as fallback by some workflows)
fetch "https://huggingface.co/mcmonkey4eva/t5-v1_1-xxl-encoder-fp8_e4m3fn/resolve/main/model.safetensors" \
      "$MODELS/clip" "t5xxl_fp8_e4m3fn.safetensors"

# LTX 2.5 full precision (used by upscaler workflows)
fetch "https://huggingface.co/Lightricks/LTX-Video/resolve/main/ltx-video-2b-v0.9.1.safetensors" \
      "$MODELS/unet" "ltx-video-2b-v0.9.1.safetensors"

ok "LTX 2.5 weights complete"
log "Volume after LTX 2.5:"
df -h /workspace | tail -1 | tee -a "$LOG"

# ════════════════════════════════════════════════════════════════════════════════
# SECTION 2: MiniMax Hailuo 3 INT8 (~66.5 GB)
# ════════════════════════════════════════════════════════════════════════════════
log ""
log "═══ Section 2: MiniMax Hailuo 3 INT8 (~66.5 GB) ═══"

# Main transformer INT8 (~31GB)
fetch "https://huggingface.co/Comfy-Org/MiniMax-H3/resolve/main/diffusion_models/minimax_h3_fl2va_int8_convrot.safetensors" \
      "$MODELS/diffusion_models" "minimax_h3_fl2va_int8_convrot.safetensors"

# Text encoder INT8 (~30GB)
fetch "https://huggingface.co/Comfy-Org/MiniMax-H3/resolve/main/text_encoders/qwen3vl_32b_minimax_h3_int8_convrot.safetensors" \
      "$MODELS/text_encoders" "qwen3vl_32b_minimax_h3_int8_convrot.safetensors"

# Video VAE (~3GB)
fetch "https://huggingface.co/Comfy-Org/MiniMax-H3/resolve/main/vae/minimax_h3_video_vae_fp16.safetensors" \
      "$MODELS/vae" "minimax_h3_video_vae_fp16.safetensors"

# Audio VAE (~2GB)
fetch "https://huggingface.co/Comfy-Org/MiniMax-H3/resolve/main/vae/minimax_h3_audio_vae_fp32.safetensors" \
      "$MODELS/vae" "minimax_h3_audio_vae_fp32.safetensors"

# Symlinks expected by workflow nodes
ln -sfn ../diffusion_models/minimax_h3_fl2va_int8_convrot.safetensors \
    "$MODELS/checkpoints/minimax_h3_fl2va_int8_convrot.safetensors" 2>/dev/null || true
ln -sfn ../diffusion_models/minimax_h3_fl2va_int8_convrot.safetensors \
    "$MODELS/diffusion_models/minimax-h3-int8.safetensors" 2>/dev/null || true
ln -sfn ../text_encoders/qwen3vl_32b_minimax_h3_int8_convrot.safetensors \
    "$MODELS/clip/qwen3vl_32b_minimax_h3_int8_convrot.safetensors" 2>/dev/null || true
ln -sfn ../text_encoders/qwen3vl_32b_minimax_h3_int8_convrot.safetensors \
    "$MODELS/clip/t5xxl_fp8_e4m3fn_minimax.safetensors" 2>/dev/null || true
ln -sfn ../vae/minimax_h3_video_vae_fp16.safetensors \
    "$MODELS/vae/vae.safetensors" 2>/dev/null || true
ln -sfn ../vae/minimax_h3_audio_vae_fp32.safetensors \
    "$MODELS/vae/audio_vae.safetensors" 2>/dev/null || true

ok "MiniMax Hailuo 3 weights complete"

# ════════════════════════════════════════════════════════════════════════════════
# SECTION 3: Summary
# ════════════════════════════════════════════════════════════════════════════════
log ""
log "═══ Final Volume Storage Summary ═══"
du -sh "$MODELS"/* 2>/dev/null | tee -a "$LOG" || true
log ""
df -h /workspace | tail -1 | tee -a "$LOG"

echo ""
echo "SEED_COMPLETE"
ok "=== All models seeded. Pod will now terminate. ==="
