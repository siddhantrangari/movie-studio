#!/usr/bin/env bash
# ── seed-volume.sh ─────────────────────────────────────────────────────────────
# One-time model pre-seeder: downloads ALL weights for LTX 2.5 and MiniMax H3
# into /workspace so they are present for every future pod regardless of GPU tier.
#
# Runs at boot inside a pod that has the network volume mounted at /workspace.
# No GPU is required — this is a pure CPU + network download job.
# ────────────────────────────────────────────────────────────────────────────────

set -euo pipefail

LOG_DIR=/var/log/provision
LOG=$LOG_DIR/provision.log
mkdir -p "$LOG_DIR"
: > "$LOG"

# Serve the log so the app can tail it
PY=$(command -v python3 || command -v python)
[ -n "$PY" ] && ("$PY" -m http.server 7777 --directory "$LOG_DIR" >/dev/null 2>&1 &)

log()  { echo "[$(date -u +%H:%M:%S)] $*" | tee -a "$LOG"; }
ok()   { echo "[$(date -u +%H:%M:%S)] ✓ $*" | tee -a "$LOG"; }
err()  { echo "[$(date -u +%H:%M:%S)] ✗ $*" | tee -a "$LOG"; }

log "=== Movie Studio Volume Seeder starting ==="
log "Workspace: /workspace"
df -h /workspace 2>/dev/null | tail -1 | tee -a "$LOG" || true

# ── Install aria2 ──────────────────────────────────────────────────────────────
install_aria2() {
    command -v aria2c &>/dev/null && return
    log "Installing aria2..."
    apt-get update -qq 2>/dev/null | tail -1 | tee -a "$LOG" || true
    apt-get install -y -q aria2 2>/dev/null | tail -1 | tee -a "$LOG" || true
}

# ── Download helper (skips if file already exists and > 1MB) ──────────────────
fetch() {
    local url="$1" dest_dir="$2" name="$3"
    if [ -s "$dest_dir/$name" ] && [ "$(stat -c%s "$dest_dir/$name" 2>/dev/null || echo 0)" -gt 1048576 ]; then
        ok "$name already present — skipping"
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
        --max-tries=10
        --retry-wait=5
        --continue=true
        --console-log-level=warn
        --summary-interval=30
        --file-allocation=none
    )
    [ -n "${HF_TOKEN:-}" ] && args+=(--header="Authorization: Bearer ${HF_TOKEN}")
    aria2c "${args[@]}" "$url" 2>&1 | tee -a "$LOG"
    ok "$name done"
}

# ── ComfyUI path (baked image or workspace copy) ──────────────────────────────
COMFY="/opt/comfyui-baked"
[ -d "$COMFY/models" ] || COMFY="/workspace/runpod-slim/ComfyUI"

# If neither exists, wait up to 3 minutes for /start.sh to run
if [ ! -d "$COMFY/models" ]; then
    log "Waiting for ComfyUI to appear in /workspace..."
    for i in $(seq 1 18); do
        sleep 10
        COMFY=$(find /workspace -name 'main.py' -path '*/ComfyUI/*' 2>/dev/null | head -1 | sed 's|/main.py||')
        [ -n "$COMFY" ] && break
        log "  Still waiting... ($((i * 10))s)"
    done
fi

[ -d "$COMFY/models" ] || { err "ComfyUI never appeared — check /start.sh"; exit 1; }
ok "ComfyUI found at $COMFY"

MODELS="$COMFY/models"
mkdir -p "$MODELS/diffusion_models" "$MODELS/text_encoders" "$MODELS/vae" \
          "$MODELS/checkpoints" "$MODELS/clip" "$MODELS/unet"

# ════════════════════════════════════════════════════════════════════════════════
# SECTION 1: LTX 2.5 models (~37 GB total)
# ════════════════════════════════════════════════════════════════════════════════
log ""
log "═══ Section 1: LTX Video 2.5 (~37 GB) ═══"

fetch "https://huggingface.co/Lightricks/LTX-Video/resolve/main/ltx-video-2b-v0.9.5.safetensors" \
      "$MODELS/unet" "ltx-video-2b-v0.9.5.safetensors"

fetch "https://huggingface.co/Lightricks/LTX-Video/resolve/main/ltx-video-2b-v0.9.5_fp8_e4m3fn.safetensors" \
      "$MODELS/unet" "ltx-video-2b-v0.9.5_fp8_e4m3fn.safetensors"

fetch "https://huggingface.co/city96/T5-v1_1-xxl-encoder-bf16/resolve/main/model.safetensors" \
      "$MODELS/clip" "t5xxl_bf16.safetensors"

fetch "https://huggingface.co/Lightricks/LTX-Video/resolve/main/vae/ltxv_vae.safetensors" \
      "$MODELS/vae" "ltxv_vae.safetensors"

ok "LTX 2.5 weights complete"

# ════════════════════════════════════════════════════════════════════════════════
# SECTION 2: MiniMax Hailuo 3 INT8 models (~66.5 GB total)
# ════════════════════════════════════════════════════════════════════════════════
log ""
log "═══ Section 2: MiniMax Hailuo 3 INT8 (~66.5 GB) ═══"

fetch "https://huggingface.co/Comfy-Org/MiniMax-H3/resolve/main/diffusion_models/minimax_h3_fl2va_int8_convrot.safetensors" \
      "$MODELS/diffusion_models" "minimax_h3_fl2va_int8_convrot.safetensors"

fetch "https://huggingface.co/Comfy-Org/MiniMax-H3/resolve/main/text_encoders/qwen3vl_32b_minimax_h3_int8_convrot.safetensors" \
      "$MODELS/text_encoders" "qwen3vl_32b_minimax_h3_int8_convrot.safetensors"

fetch "https://huggingface.co/Comfy-Org/MiniMax-H3/resolve/main/vae/minimax_h3_video_vae_fp16.safetensors" \
      "$MODELS/vae" "minimax_h3_video_vae_fp16.safetensors"

fetch "https://huggingface.co/Comfy-Org/MiniMax-H3/resolve/main/vae/minimax_h3_audio_vae_fp32.safetensors" \
      "$MODELS/vae" "minimax_h3_audio_vae_fp32.safetensors"

# Create symlinks expected by workflow nodes
ln -sfn ../diffusion_models/minimax_h3_fl2va_int8_convrot.safetensors "$MODELS/checkpoints/minimax_h3_fl2va_int8_convrot.safetensors" 2>/dev/null || true
ln -sfn ../diffusion_models/minimax_h3_fl2va_int8_convrot.safetensors "$MODELS/diffusion_models/minimax-h3-int8.safetensors" 2>/dev/null || true
ln -sfn ../text_encoders/qwen3vl_32b_minimax_h3_int8_convrot.safetensors "$MODELS/clip/qwen3vl_32b_minimax_h3_int8_convrot.safetensors" 2>/dev/null || true
ln -sfn ../text_encoders/qwen3vl_32b_minimax_h3_int8_convrot.safetensors "$MODELS/clip/t5xxl_fp8_e4m3fn.safetensors" 2>/dev/null || true
ln -sfn ../vae/minimax_h3_video_vae_fp16.safetensors "$MODELS/vae/vae.safetensors" 2>/dev/null || true
ln -sfn ../vae/minimax_h3_audio_vae_fp32.safetensors "$MODELS/vae/audio_vae.safetensors" 2>/dev/null || true

ok "MiniMax Hailuo 3 weights complete"

# ════════════════════════════════════════════════════════════════════════════════
# SECTION 3: Summary
# ════════════════════════════════════════════════════════════════════════════════
log ""
log "═══ Volume Storage Summary ═══"
du -sh "$MODELS/diffusion_models" "$MODELS/text_encoders" "$MODELS/vae" "$MODELS/unet" "$MODELS/clip" 2>/dev/null | tee -a "$LOG" || true
df -h /workspace | tail -1 | tee -a "$LOG"

echo ""
echo "SEED_COMPLETE"
ok "=== All models seeded to persistent volume. Pod can now be stopped. ==="
