#!/usr/bin/env bash
#
# Takes a bare RunPod ComfyUI pod to a working LTX 2.5 setup.
#
# Normally invoked at container boot by the Docker entrypoint override in
# lib/podops.ts, in two phases:
#
#   PROVISION_PHASE=code    — before /start.sh. Upgrades the *baked* ComfyUI at
#                             /opt/comfyui-baked, which /start.sh then copies
#                             into /workspace. Takes ~5s, so ComfyUI comes up on
#                             the right version without ever needing a restart.
#   PROVISION_PHASE=models  — alongside /start.sh. Waits for the workspace copy
#                             to appear, then downloads models into it. ComfyUI
#                             serves throughout and picks the files up as they
#                             land.
#
# The split exists because /workspace/runpod-slim/ComfyUI does not exist until
# /start.sh runs, while /opt/comfyui-baked exists from the moment the image
# boots. Doing everything in one pass before /start.sh fails with "ComfyUI not
# found"; doing it all after means ComfyUI is already running the old code.
#
# Run manually in the pod's terminal (Jupyter → Terminal, or SSH) with no phase
# set to do both against the live workspace copy:
#   curl -sL <this-url> | bash
#
# Safe to re-run: every step checks before doing work.
#
# Why the model choices matter — each fails confusingly if skipped:
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
BAKED="/opt/comfyui-baked"
PHASE="${PROVISION_PHASE:-all}"

log() { printf '\n\033[1;33m▶ %s\033[0m\n' "$*"; }
ok()  { printf '\033[0;32m  ✓ %s\033[0m\n' "$*"; }

# ── Recover the pod's env ─────────────────────────────────────────────────────
# A manually-opened shell doesn't inherit the container's environment, and
# RunPod only mirrors some of it into /etc/rp_environment — HF_TOKEN is not
# among them. PID 1 always has the full set.
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

# /start.sh copies the baked tree into /workspace with `cp -r`, so main.py can
# appear while the copy is still running — writing models into a half-copied
# tree would race it. ComfyUI answering means /start.sh got all the way to
# launching, which is the only signal that the copy is definitely finished.
wait_for_comfy() {
    local i comfy
    for i in $(seq 1 120); do
        if curl -sf --max-time 3 http://127.0.0.1:8188/system_stats >/dev/null 2>&1; then
            comfy=$(find_comfy)
            [ -n "$comfy" ] && { echo "$comfy"; return; }
        fi
        sleep 5
    done
    # ComfyUI never came up. Fall back to the path check so a broken launch
    # doesn't also cost us the downloads.
    find_comfy
}

# ── GPU health ────────────────────────────────────────────────────────────────
# Community hosts are not all healthy. One seen in testing had working
# nvidia-smi, present /dev/nvidia-uvm, and correct torch, yet
# torch.cuda.is_available() was False — ComfyUI crashed with "CUDA unknown
# error" on startup. Checking here costs a second and saves downloading ~35GB
# onto a machine that could never run the model. The marker is matched by
# lib/podops.ts, which scraps the pod and retries on a different host.
check_gpu() {
    log "Checking the GPU actually works"
    if python3 -c 'import torch,sys; sys.exit(0 if torch.cuda.is_available() else 1)' 2>/dev/null; then
        ok "GPU is usable"
        return 0
    fi
    nvidia-smi --query-gpu=name --format=csv,noheader 2>&1 | head -2 || true
    echo "GPU_BROKEN: torch cannot initialise CUDA on this host"
    return 1
}

# ── Bandwidth probe ───────────────────────────────────────────────────────────
# Only worth running when the models still have to be downloaded, i.e. on a
# Community host with no network volume. A host measured at 0.43 MB/s would
# need ~24 hours for the full 37GB; one at 870 MB/s needs a minute. Six seconds
# of sampling tells the two apart before committing to either.
probe_speed() {
    local url bytes mbps i
    [ "${PROBE_SPEED:-0}" = "1" ] || return 0
    url="https://huggingface.co/${REPO}/resolve/main/vae/ltx-2.5-audio-vae-bf16.safetensors"
    log "Measuring this host's download speed"
    rm -f /tmp/probe.* 2>/dev/null || true
    for i in $(seq 0 7); do
        curl -s -L --max-time 6 -r "$((i*20000000))-$((i*20000000+19999999))" \
            -H "Authorization: Bearer ${HF_TOKEN}" "$url" -o "/tmp/probe.$i" &
    done
    wait
    bytes=$(du -cb /tmp/probe.* 2>/dev/null | tail -1 | cut -f1 || echo 0)
    rm -f /tmp/probe.* 2>/dev/null || true
    mbps=$(( bytes / 6 / 1048576 ))
    local floor="${SPEED_FLOOR_MBPS:-30}"
    if [ "$mbps" -lt "$floor" ]; then
        echo "HOST_SLOW: ${mbps} MB/s is below the ${floor} MB/s floor — 37GB would take too long here"
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
    if [ "$current" = "${COMFY_VERSION#v}" ]; then
        ok "ComfyUI already $COMFY_VERSION"
        return
    fi
    log "Upgrading ComfyUI $current → $COMFY_VERSION (needed for LTX 2.5)"
    git fetch --depth 1 origin tag "$COMFY_VERSION" 2>&1 | tail -2
    git checkout "$COMFY_VERSION" 2>&1 | tail -2

    # The venv is created later by /start.sh with --system-site-packages, so
    # installing into system python is what that venv will actually see.
    log "Installing requirements for $COMFY_VERSION"
    python3 -m pip install -q -r requirements.txt 2>&1 | tail -3
    ok "Upgraded to $COMFY_VERSION"
}

# ── Phase: models ─────────────────────────────────────────────────────────────
CHUNKS=8

fetch() {   # fetch <repo-path> <dest-dir>
    local src="$1" dest="$2" name url total i start end pids=() failed=0
    local cur pct last=0 rate
    name=$(basename "$src")
    if [ -s "$dest/$name" ]; then
        ok "$name already present"
        return
    fi
    mkdir -p "$dest"
    url="https://huggingface.co/${REPO}/resolve/main/${src}"

    total=$(curl -sIL -H "Authorization: Bearer ${HF_TOKEN}" "$url" \
            | tr -d '\r' | awk 'tolower($1)=="content-length:"{v=$2} END{print v+0}')

    # A single HTTPS stream to the HF CDN measured ~0.4 MB/s from a community
    # host — hours for a 20GB file. Range requests in parallel multiply that,
    # since the ceiling is per-connection rather than per-host.
    if [ "$total" -gt 0 ] 2>/dev/null; then
        log "Downloading $name ($((total/1048576)) MB, ${CHUNKS} parallel streams)"
        local size=$(( (total + CHUNKS - 1) / CHUNKS ))
        for i in $(seq 0 $((CHUNKS - 1))); do
            start=$(( i * size ))
            end=$(( start + size - 1 ))
            [ "$end" -ge "$total" ] && end=$(( total - 1 ))
            # -C - resumes a chunk that a previous run left part-written.
            curl -sL --fail --retry 5 --retry-delay 3 -r "${start}-${end}" \
                -H "Authorization: Bearer ${HF_TOKEN}" "$url" \
                -o "$dest/$name.part$i" &
            pids+=($!)
        done
    else
        # No content-length (rare) — fall back to one resumable stream.
        log "Downloading $name (size unknown, single stream)"
        curl -C - -sL --fail --retry 5 --retry-delay 3 \
            -H "Authorization: Bearer ${HF_TOKEN}" "$url" -o "$dest/$name.part0" &
        pids+=($!)
    fi

    # Without periodic output a multi-GB download reads as a hung process.
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

    # A truncated join would surface much later as an unreadable safetensors
    # file, so verify the byte count while we still know what to blame.
    if [ "$total" -gt 0 ] 2>/dev/null; then
        local got
        got=$(stat -c%s "$dest/$name")
        [ "$got" -eq "$total" ] || {
            rm -f "$dest/$name"
            echo "ERROR: $name is $got bytes, expected $total"
            exit 1
        }
    fi
    ok "$name downloaded"
}

do_models() {
    local models="$COMFY/models"
    [ -n "${HF_TOKEN:-}" ] || { echo "ERROR: HF_TOKEN not set — the LTX 2.5 repo is gated"; exit 1; }
    ok "HF token found"

    fetch diffusion_models/ltx-2.5-22b-distilled-transformer-comfy-int8-convrot.safetensors "$models/diffusion_models"
    fetch text_encoders/gemma4-12b-with-proj-ltx-2.5-comfy-int8-convrot.safetensors        "$models/text_encoders"
    fetch vae/ltx-2.5-video-vae-conv-bf16.safetensors                                       "$models/vae"
    fetch vae/ltx-2.5-audio-vae-bf16.safetensors                                            "$models/vae"

    log "Linking into checkpoints/"
    mkdir -p "$models/checkpoints"
    ln -sfn ../diffusion_models/ltx-2.5-22b-distilled-transformer-comfy-int8-convrot.safetensors \
            "$models/checkpoints/ltx-2.5-22b-distilled-transformer-comfy-int8-convrot.safetensors"
    ln -sfn ../vae/ltx-2.5-audio-vae-bf16.safetensors \
            "$models/checkpoints/ltx-2.5-audio-vae-bf16.safetensors"
    for f in "$models"/checkpoints/*.safetensors; do
        [ -e "$f" ] || { echo "ERROR: broken symlink $f"; exit 1; }
    done
    ok "checkpoints/ linked"
}

# ── Dispatch ──────────────────────────────────────────────────────────────────
case "$PHASE" in
  code)
    # Both gates run before anything expensive, so a bad host is abandoned in
    # seconds rather than after a 37GB download.
    check_gpu || exit 2
    probe_speed || exit 3
    COMFY="$BAKED"
    [ -f "$COMFY/main.py" ] || COMFY=$(find_comfy)
    [ -n "$COMFY" ] || { echo "ERROR: ComfyUI not found"; exit 1; }
    log "Upgrading ComfyUI at $COMFY"
    do_code
    ;;
  models)
    log "Waiting for ComfyUI to be laid down in the workspace…"
    COMFY=$(wait_for_comfy)
    [ -n "$COMFY" ] || { echo "ERROR: ComfyUI never appeared in the workspace"; exit 1; }
    ok "ComfyUI at $COMFY"
    do_models
    ;;
  all)
    COMFY=$(find_comfy)
    [ -n "$COMFY" ] || { echo "ERROR: ComfyUI not found"; exit 1; }
    log "ComfyUI at $COMFY"
    do_code
    do_models
    printf '\n\033[1;33m  Restart the pod so ComfyUI picks up the upgrade.\033[0m\n'
    ;;
  *)
    echo "ERROR: unknown PROVISION_PHASE '$PHASE' (expected code, models, or all)"
    exit 1
    ;;
esac

printf '\n\033[0;32m  ✓ Phase %s complete\033[0m\n\n' "$PHASE"
