#!/usr/bin/env bash
#
# Takes a bare RunPod ComfyUI pod to a working MiniMax Hailuo 3 (H3/HL3) setup.
#
# Normally invoked at container boot by the Docker entrypoint override in
# lib/podops.ts, in two phases:
#
#   PROVISION_PHASE=code    — before /start.sh. Prepares ComfyUI & custom nodes
#   PROVISION_PHASE=models  — alongside /start.sh. Downloads MiniMax H3 weights into workspace
#
# MiniMax Hailuo 3 requirements:
#   1. Requires 48GB+ VRAM (NVIDIA RTX A6000, A40, L40S, or A100 80GB)
#   2. Models placed in models/diffusion_models and linked to models/checkpoints
#
# Safe to re-run: every step checks before doing work.

set -euo pipefail

COMFY_VERSION="v0.33.1"
REPO="Comfy-Org/MiniMax-H3"
BAKED="/opt/comfyui-baked"
PHASE="${PROVISION_PHASE:-all}"

log() { printf '\n\033[1;33m▶ %s\033[0m\n' "$*"; }
ok()  { printf '\033[0;32m  ✓ %s\033[0m\n' "$*"; }

# ── Recover the pod's env ─────────────────────────────────────────────────────
[ -f /etc/rp_environment ] && . /etc/rp_environment 2>/dev/null || true
if [ -z "${HF_TOKEN:-}" ] && [ -r /proc/1/environ ]; then
    HF_TOKEN=$(tr '\0' '\n' < /proc/1/environ | sed -n 's/^HF_TOKEN=//p' | head -1)
    export HF_TOKEN
fi

# ── Locate ComfyUI ────────────────────────────────────────────────────────────
find_comfy() {
    local c
    for c in /workspace/runpod-slim/ComfyUI /workspace/ComfyUI /ComfyUI /opt/ComfyUI; do
        [ -f "$c/main.py" ] && { echo "$c"; return; }
    done
    c=$(dirname "$(find / -maxdepth 5 -name main.py -path '*ComfyUI*' 2>/dev/null | head -1)")
    [ -f "$c/main.py" ] && echo "$c"
}

wait_for_comfy() {
    local i comfy
    for i in $(seq 1 120); do
        if curl -sf --max-time 3 http://127.0.0.1:8188/system_stats >/dev/null 2>&1; then
            comfy=$(find_comfy)
            [ -n "$comfy" ] && { echo "$comfy"; return; }
        fi
        sleep 5
    done
    find_comfy
}

# ── GPU health & VRAM check ───────────────────────────────────────────────────
check_gpu() {
    log "Checking GPU capability for MiniMax Hailuo 3 (requires 48GB+ VRAM)"
    if ! python3 -c 'import torch,sys; sys.exit(0 if torch.cuda.is_available() else 1)' 2>/dev/null; then
        nvidia-smi --query-gpu=name --format=csv,noheader 2>&1 | head -2 || true
        echo "GPU_BROKEN: torch cannot initialise CUDA on this host"
        return 1
    fi
    local vram
    vram=$(nvidia-smi --query-gpu=memory.total --format=csv,noheader,nounits 2>/dev/null | head -1 || echo 0)
    if [ "$vram" -lt 40000 ]; then
        echo "GPU_LOW_VRAM: Host has ${vram}MB VRAM. MiniMax Hailuo 3 requires 48GB+ (A6000, A40, L40S, A100)."
    fi
    ok "GPU is usable ($vram MB VRAM detected)"
    return 0
}

# ── Bandwidth probe ───────────────────────────────────────────────────────────
probe_speed() {
    local url bytes mbps i
    [ "${PROBE_SPEED:-0}" = "1" ] || return 0
    url="https://huggingface.co/${REPO}/resolve/main/vae/minimax_h3_video_vae_fp16.safetensors"
    log "Measuring this host's download speed"
    rm -f /tmp/probe.* 2>/dev/null || true
    for i in $(seq 0 7); do
        curl -s --max-time 6 -r "$((i*20000000))-$((i*20000000+19999999))" \
            ${HF_TOKEN:+-H "Authorization: Bearer ${HF_TOKEN}"} "$url" -o "/tmp/probe.$i" &
    done
    wait
    bytes=$(du -cb /tmp/probe.* 2>/dev/null | tail -1 | cut -f1 || echo 0)
    rm -f /tmp/probe.* 2>/dev/null || true
    mbps=$(( bytes / 6 / 1048576 ))
    local floor="${SPEED_FLOOR_MBPS:-30}"
    if [ "$mbps" -lt "$floor" ]; then
        echo "HOST_SLOW: ${mbps} MB/s is below the ${floor} MB/s floor"
        return 1
    fi
    ok "Download speed ~${mbps} MB/s — fast enough"
    return 0
}

# ── Phase: code ───────────────────────────────────────────────────────────────
do_code() {
    cd "$COMFY"
    local current
    current=$(sed -n 's/^__version__ = "\(.*\)"/\1/p' comfyui_version.py 2>/dev/null || echo unknown)
    log "Preparing ComfyUI $current for MiniMax Hailuo 3"
    git fetch --depth 1 origin tag "$COMFY_VERSION" 2>&1 | tail -2 || true
    git checkout "$COMFY_VERSION" 2>&1 | tail -2 || true

    log "Installing requirements"
    python3 -m pip install -q -r requirements.txt 2>&1 | tail -3 || true
    python3 -m pip install -q diffusers accelerate safetensors sentencepiece 2>&1 | tail -3 || true
    ok "Code phase ready"
}

# ── Phase: models ─────────────────────────────────────────────────────────────
CHUNKS=8

fetch() {   # fetch <url> <dest-dir> <name>
    local url="$1" dest="$2" name="$3" total i start end pids=() failed=0
    local cur pct last=0 rate
    if [ -s "$dest/$name" ]; then
        ok "$name already present"
        return
    fi
    mkdir -p "$dest"

    total=$(curl -sIL ${HF_TOKEN:+-H "Authorization: Bearer ${HF_TOKEN}"} "$url" \
            | tr -d '\r' | awk 'tolower($1)=="content-length:"{v=$2} END{print v+0}')

    if [ "$total" -gt 0 ] 2>/dev/null; then
        log "Downloading $name ($((total/1048576)) MB, ${CHUNKS} parallel streams)"
        local size=$(( (total + CHUNKS - 1) / CHUNKS ))
        for i in $(seq 0 $((CHUNKS - 1))); do
            start=$(( i * size ))
            end=$(( start + size - 1 ))
            [ "$end" -ge "$total" ] && end=$(( total - 1 ))
            curl -sL --fail --retry 5 --retry-delay 3 -r "${start}-${end}" \
                ${HF_TOKEN:+-H "Authorization: Bearer ${HF_TOKEN}"} "$url" \
                -o "$dest/$name.part$i" &
            pids+=($!)
        done
    else
        log "Downloading $name (single stream)"
        curl -C - -sL --fail --retry 5 --retry-delay 3 \
            ${HF_TOKEN:+-H "Authorization: Bearer ${HF_TOKEN}"} "$url" -o "$dest/$name.part0" &
        pids+=($!)
    fi

    local alive
    while :; do
        alive=0
        for i in "${pids[@]}"; do kill -0 "$i" 2>/dev/null && alive=1; done
        [ "$alive" -eq 1 ] || break
        sleep 10
        cur=$(du -cb "$dest/$name".part* 2>/dev/null | tail -1 | cut -f1 || echo 0)
        rate=$(( (cur - last) / 10485760 ))
        last=$cur
        if [ "$total" -gt 0 ] 2>/dev/null; then
            pct=$(( cur * 100 / total ))
            printf '    %s  %s / %s MB (%s%%) at ~%s MB/s\n' \
                "$name" "$((cur/1048576))" "$((total/1048576))" "$pct" "$rate"
        else
            printf '    %s  %s MB\n' "$name" "$((cur/1048576))"
        fi
    done

    for i in "${pids[@]}"; do wait "$i" || failed=1; done
    [ "$failed" -eq 0 ] || { echo "ERROR: download failed for $name"; exit 1; }

    cat "$dest/$name".part* > "$dest/$name"
    rm -f "$dest/$name".part*
    ok "$name downloaded"
}

do_models() {
    local models="$COMFY/models"
    mkdir -p "$models/diffusion_models" "$models/text_encoders" "$models/vae" "$models/checkpoints" "$models/clip"

    log "Checking MiniMax Hailuo 3 weights"
    # MiniMax Hailuo 3 INT8 transformer & components
    fetch "https://huggingface.co/Comfy-Org/MiniMax-H3/resolve/main/diffusion_models/minimax_h3_fl2va_int8_convrot.safetensors" \
          "$models/diffusion_models" "minimax_h3_fl2va_int8_convrot.safetensors"

    fetch "https://huggingface.co/Comfy-Org/MiniMax-H3/resolve/main/text_encoders/qwen3vl_32b_minimax_h3_int8_convrot.safetensors" \
          "$models/text_encoders" "qwen3vl_32b_minimax_h3_int8_convrot.safetensors"

    fetch "https://huggingface.co/Comfy-Org/MiniMax-H3/resolve/main/vae/minimax_h3_video_vae_fp16.safetensors" \
          "$models/vae" "minimax_h3_video_vae_fp16.safetensors"

    ln -sfn ../diffusion_models/minimax_h3_fl2va_int8_convrot.safetensors "$models/checkpoints/minimax_h3_fl2va_int8_convrot.safetensors"
    ln -sfn ../diffusion_models/minimax_h3_fl2va_int8_convrot.safetensors "$models/diffusion_models/minimax-h3-int8.safetensors"
    ln -sfn ../text_encoders/qwen3vl_32b_minimax_h3_int8_convrot.safetensors "$models/clip/qwen3vl_32b_minimax_h3_int8_convrot.safetensors"
    ln -sfn ../text_encoders/qwen3vl_32b_minimax_h3_int8_convrot.safetensors "$models/clip/t5xxl_fp8_e4m3fn.safetensors"
    ln -sfn ../vae/minimax_h3_video_vae_fp16.safetensors "$models/vae/vae.safetensors"
    ok "MiniMax Hailuo 3 models in place"
}

# ── Dispatch ──────────────────────────────────────────────────────────────────
case "$PHASE" in
  code)
    check_gpu || exit 2
    probe_speed || exit 3
    COMFY="$BAKED"
    [ -f "$COMFY/main.py" ] || COMFY=$(find_comfy)
    [ -n "$COMFY" ] || { echo "ERROR: ComfyUI not found"; exit 1; }
    do_code
    ;;
  models)
    log "Waiting for ComfyUI in workspace…"
    COMFY=$(wait_for_comfy)
    [ -n "$COMFY" ] || { echo "ERROR: ComfyUI never appeared in workspace"; exit 1; }
    do_models
    ;;
  all)
    COMFY=$(find_comfy)
    [ -n "$COMFY" ] || { echo "ERROR: ComfyUI not found"; exit 1; }
    do_code
    do_models
    ;;
  *)
    echo "ERROR: unknown PROVISION_PHASE '$PHASE'"
    exit 1
    ;;
esac

printf '\n\033[0;32m  ✓ MiniMax Hailuo 3 Phase %s complete\033[0m\n\n' "$PHASE"
