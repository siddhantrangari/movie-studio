#!/usr/bin/env bash
#
# Pod lifecycle for the LTX 2.5 GPU box.
#
#   ./pod.sh up        deploy a pod and provision it
#   ./pod.sh down      terminate the pod (nothing keeps billing)
#   ./pod.sh status    what's running and what it costs
#   ./pod.sh volume    create the network volume (one time, optional)
#
# Why terminate rather than stop:
#   A stopped pod still bills for its container disk (~$0.01/hr, ~$7/month) AND
#   pins your data to one physical machine. When that machine's GPU gets taken,
#   resume fails with "not enough free GPUs on the host machine" and the data is
#   unreachable — this is what cost us an afternoon. Terminating costs nothing.
#
#   With a network volume the models survive termination and mount to any pod in
#   the same datacenter, so `up` takes ~2 min instead of ~6. Without one, `up`
#   re-downloads 38GB, which is free but slower. The volume runs about
#   $0.07/GB/month — cheaper than leaving a pod stopped, and far more reliable.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(dirname "$SCRIPT_DIR")"
POD_NAME="ltx25-videogen"
VOLUME_NAME="ltx25-models"
VOLUME_GB=60
TEMPLATE_ID="cw3nka7d08"          # RunPod official ComfyUI, CUDA 12.8
STATE_FILE="$SCRIPT_DIR/.pod-state"

# Cheapest first. LTX 2.5 int8 fits in 24GB.
GPUS=(
    "NVIDIA GeForce RTX 3090"
    "NVIDIA GeForce RTX 4090"
    "NVIDIA RTX A6000"
    "NVIDIA A40"
    "NVIDIA L40S"
)

REST="https://rest.runpod.io/v1"
GQL="https://api.runpod.io/graphql"

for f in "$ROOT/.env.local" "$ROOT/.env.production" "$SCRIPT_DIR/.env"; do
    [ -f "$f" ] && set -a && . "$f" && set +a && break
done
: "${RUNPOD_API_KEY:?RUNPOD_API_KEY not set — put it in .env.local}"

AUTH="Authorization: Bearer ${RUNPOD_API_KEY}"
JSON="Content-Type: application/json"

log()  { printf '\n\033[1;33m▶ %s\033[0m\n' "$*"; }
ok()   { printf '\033[0;32m  ✓ %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m  ! %s\033[0m\n' "$*"; }

api()  { curl -s --max-time 60 -H "$AUTH" -H "$JSON" "$@"; }
gql()  { curl -s --max-time 40 -X POST "$GQL" -H "$AUTH" -H "$JSON" -d "{\"query\":$(printf '%s' "$1" | python3 -c 'import json,sys;print(json.dumps(sys.stdin.read()))')}"; }

jqp() { python3 -c "import json,sys
try: d=json.load(sys.stdin)
except Exception: sys.exit(0)
$1" 2>/dev/null; }

find_pod() {
    api "$REST/pods" | jqp "
for p in (d if isinstance(d,list) else []):
    if p.get('name')=='$POD_NAME': print(p['id']); break"
}

find_volume() {
    gql '{ myself { networkVolumes { id name } } }' | jqp "
for v in ((d.get('data') or {}).get('myself') or {}).get('networkVolumes') or []:
    if v.get('name')=='$VOLUME_NAME': print(v['id']); break"
}

cmd_status() {
    log "Account"
    gql '{ myself { clientBalance currentSpendPerHr } }' | jqp "
m=(d.get('data') or {}).get('myself') or {}
print(f\"  balance \${m.get('clientBalance',0):.2f}   spend \${m.get('currentSpendPerHr',0)}/hr\")"

    log "Pods"
    api "$REST/pods" | jqp "
ps=d if isinstance(d,list) else []
if not ps: print('  none — nothing billing')
for p in ps:
    print(f\"  {p['name']}  {p['id']}  {p.get('desiredStatus')}  \${p.get('costPerHr')}/hr\")
    if p.get('desiredStatus')=='RUNNING':
        print(f\"     ComfyUI  https://{p['id']}-8188.proxy.runpod.net\")
        print(f\"     Jupyter  https://{p['id']}-8888.proxy.runpod.net\")"

    log "Network volumes"
    gql '{ myself { networkVolumes { id name size dataCenterId } } }' | jqp "
vs=((d.get('data') or {}).get('myself') or {}).get('networkVolumes') or []
if not vs: print('  none — models re-download on every up (~4 min)')
for v in vs:
    print(f\"  {v['name']}  {v['id']}  {v['size']}GB  {v.get('dataCenterId')}  ~\${v['size']*0.07:.2f}/mo\")"
    echo
}

cmd_volume() {
    local existing
    existing=$(find_volume || true)
    if [ -n "$existing" ]; then
        ok "Volume already exists: $existing"
        return
    fi

    log "Creating ${VOLUME_GB}GB network volume '$VOLUME_NAME'"
    echo "  Costs about \$$(python3 -c "print(f'{$VOLUME_GB*0.07:.2f}')")/month and persists across pods."
    echo "  Cheaper than leaving a pod stopped, and it can't get stranded on a dead host."
    echo
    read -rp "  Create it? [y/N] " reply
    [ "$reply" = "y" ] || { echo "  Skipped."; return; }

    # Datacenter has to match where the GPUs are; EU-RO-1 carries the cheap ones.
    local dc="${RUNPOD_DATACENTER:-EU-RO-1}"
    local resp
    resp=$(api -X POST "$REST/networkvolumes" \
        -d "{\"name\":\"$VOLUME_NAME\",\"size\":$VOLUME_GB,\"dataCenterId\":\"$dc\"}")
    local vid
    vid=$(printf '%s' "$resp" | jqp "print(d.get('id',''))")
    if [ -n "$vid" ]; then
        ok "Created $vid in $dc"
    else
        warn "Could not create: $resp"
        echo "  Try another datacenter: RUNPOD_DATACENTER=US-KS-2 ./pod.sh volume"
    fi
}

is_comfy_ready() {
    local status
    status=$(curl -s -L -o /dev/null -w "%{http_code}" \
        -H "User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36" \
        --max-time 8 \
        "https://${1}-8188.proxy.runpod.net/system_stats" 2>/dev/null || echo "000")
    [ "$status" = "200" ]
}

cmd_up() {
    local existing
    existing=$(find_pod || true)
    if [ -n "$existing" ]; then
        ok "Pod already up: $existing"
        echo "  ComfyUI  https://${existing}-8188.proxy.runpod.net"
        return
    fi

    local vol
    vol=$(find_volume || true)
    if [ -n "$vol" ]; then
        ok "Using network volume $vol — models should already be there"
    else
        warn "No network volume — models will download (~4 min). './pod.sh volume' avoids this."
    fi

    local pod_id=""
    for gpu in "${GPUS[@]}"; do
        log "Trying $gpu"
        local payload
        payload=$(python3 -c '
import json, os
hf_token = os.environ.get("HF_TOKEN", "")
script_path = os.path.join("'"$SCRIPT_DIR"'", "provision-ltx25.sh")
with open(script_path, "r") as f:
    script = f.read()

payload = {
    "name": "'"$POD_NAME"'",
    "templateId": "'"$TEMPLATE_ID"'",
    "gpuTypeIds": ["'"$gpu"'"],
    "gpuCount": 1,
    "containerDiskInGb": 100,
    "cloudType": "COMMUNITY",
    "env": {
        "HF_TOKEN": hf_token,
        "PROVISION_SCRIPT": script
    },
    "dockerStartCmd": [
        "bash",
        "-c",
        "printenv PROVISION_SCRIPT > /tmp/provision.sh && (BOOT_PROVISION=1 bash /tmp/provision.sh || echo \"Provisioning failed\") && exec /start.sh"
    ]
}
vol = "'"$vol"'"
if vol:
    payload["networkVolumeId"] = vol

print(json.dumps(payload))
')
        local resp
        resp=$(api -X POST "$REST/pods" -d "$payload")
        pod_id=$(printf '%s' "$resp" | jqp "print(d.get('id',''))")
        if [ -n "$pod_id" ]; then
            ok "Got $gpu — $pod_id"
            break
        fi
        printf '  unavailable: %s\n' "$(printf '%s' "$resp" | jqp "print(d.get('error','?')[:90])")"
    done

    [ -n "$pod_id" ] || { warn "No GPUs available anywhere. Try again shortly."; exit 1; }
    echo "$pod_id" > "$STATE_FILE"

    log "Waiting for pod to boot and run provisioning script"
    echo "  (Image pull + model download takes ~3–5 min on warm host, up to 20 min on cold host)"
    local provisioned=0
    for i in $(seq 1 180); do
        sleep 10
        local status_resp
        status_resp=$(api "$REST/pods/$pod_id")
        local desired_status
        desired_status=$(printf '%s' "$status_resp" | jqp "print(d.get('desiredStatus',''))")

        if [ -n "$desired_status" ] && [ "$desired_status" != "RUNNING" ] && [ "$desired_status" != "PENDING" ]; then
            warn "Pod entered state: $desired_status — stopping."
            exit 1
        fi

        if is_comfy_ready "$pod_id"; then
            provisioned=1
            break
        fi

        local mins=$(( i * 10 / 60 ))
        if [ $(( i % 6 )) -eq 0 ]; then
            if [ "$desired_status" = "RUNNING" ]; then
                echo "  Container active. Provisioning models & starting ComfyUI… ${mins}m elapsed."
            else
                echo "  Creating container… ${mins}m elapsed."
            fi
        fi
    done

    if [ "$provisioned" -eq 1 ]; then
        ok "ComfyUI is live! Provisioning complete."
    else
        warn "Timed out waiting for ComfyUI. Check the RunPod console logs to see if downloads are still in progress."
    fi

    printf '\n\033[0;32m════════════════════════════════════════\033[0m\n'
    echo "  ComfyUI  https://${pod_id}-8188.proxy.runpod.net"
    echo "  Jupyter  https://${pod_id}-8888.proxy.runpod.net"
    echo
    echo "  Run './pod.sh down' when you're finished — that stops all billing."
    printf '\033[0;32m════════════════════════════════════════\033[0m\n\n'
}

cmd_down() {
    local pod_id
    pod_id=$(find_pod || true)
    if [ -z "$pod_id" ]; then
        ok "No pod running — nothing billing."
        return
    fi

    if [ -n "$(find_volume || true)" ]; then
        echo "  Terminating $pod_id. The network volume keeps your models."
    else
        warn "No network volume — terminating loses the 38GB and 'up' re-downloads."
    fi

    api -X DELETE "$REST/pods/$pod_id" >/dev/null
    rm -f "$STATE_FILE"
    ok "Terminated. Billing stopped."

    sleep 5
    gql '{ myself { clientBalance currentSpendPerHr } }' | jqp "
m=(d.get('data') or {}).get('myself') or {}
print(f\"  balance \${m.get('clientBalance',0):.2f}   spend \${m.get('currentSpendPerHr',0)}/hr\")"
}

case "${1:-status}" in
    up)      cmd_up ;;
    down)    cmd_down ;;
    status)  cmd_status ;;
    volume)  cmd_volume ;;
    *)       sed -n '3,10p' "$0" | sed 's/^# \{0,1\}//' ;;
esac
