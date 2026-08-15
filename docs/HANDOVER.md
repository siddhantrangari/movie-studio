# Movie Studio — Handover

AI video generation studio: RunPod GPU management, LTX 2.5 clip generation,
character consistency, storyboarding, and film assembly with captions.

**Live:** `siddhantrangari.com` → deployed separately at `/var/www/movie-studio`
on the VPS, PM2 process `movie-studio`, port 3000.

Provisioning works end to end and is proven on real pods: **4:34** from nothing
to ready on a cold volume, **1:02** on a warm one. Read
[Network volume: required reading](#network-volume-required-reading) before
changing anything about pod creation — the volume forces Secure Cloud, and that
constraint is not obvious from the API errors. Storage rules for the shared VPS
are in [docs/storage.md](storage.md).

---

## What's proven working

- **LTX 2.5 generates real video with audio.** Confirmed end-to-end multiple
  times: prompt → clip with native audio, ~55s for a 5s clip on an RTX 3090.
- **Character consistency** via `LTXVImgToVideo` — a reference portrait seeds
  the first frame. Verified the generated first frame matches the reference.
- **Assembly** — crossfades scenes, mixes audio (native / ElevenLabs
  narration / both), burns in styled captions via libass. Runs server-side,
  saves to `data/films/`, survives pod termination.
- **The movie builder UI** (`/admin/videogen/movie`) — write a shot, pick an
  optional look/grade preset, generate, arrange on a timeline, assemble.
  Mobile responsive, verified at 375px.
- **GPU lifecycle UI** — a badge in the header shows GPU status and RunPod
  account balance; click it for a live-streaming provisioning log, cost
  breakdown, and shut-down button. The run is detached from the HTTP request
  (survives tab close/reload) — this part is proven.
- **The three LTX 2.5 setup requirements**, when provisioning actually runs:
  1. ComfyUI must be **≥ v0.33.1** — v0.30.0's LTXV path only knows Gemma 3;
     LTX 2.5 uses Gemma 4 and fails with `not enough values to unpack
     (expected 4, got 1)`.
  2. Use the **conv VAE** (`ltx-2.5-video-vae-conv-bf16`), not the plain
     `-bf16` one — that's the DiffVAE and throws a conv-kernel size mismatch.
  3. The transformer and audio VAE must be **symlinked into `checkpoints/`**
     — both LTX AV loaders read their dropdowns from that folder.

## Provisioning: solved

**The dockerStartCmd blocker is fixed and proven on real pods.** Provisioning
runs at container boot and streams its log into the app UI.

### What actually fixed it

`dockerEntrypoint`. The previous session correctly proved `dockerStartCmd`
could not work — `runpod/comfyui:cuda12.8` pins `ENTRYPOINT ["/start.sh"]`, and
Docker only ever replaces CMD. What it missed is that RunPod's REST API also
accepts **`dockerEntrypoint`**, which replaces the entrypoint itself:

```json
"dockerEntrypoint": ["/bin/bash", "-c"],
"dockerStartCmd": ["<boot script>"]
```

Confirmed on pod `kjiafppb7kdbtg`: our script's first log line appeared 25s
after boot. This was a few lines of change, not the Jupyter WebSocket client
the previous handover recommended.

### Provisioning runs in two phases, and the order is forced

`/workspace/runpod-slim/ComfyUI` **does not exist** until `/start.sh` copies it
there from `/opt/comfyui-baked`. The first attempt at this failed with
`ERROR: ComfyUI not found` for exactly that reason.

- **`PROVISION_PHASE=code`** — before `/start.sh`, against `/opt/comfyui-baked`.
  Git upgrade to v0.33.1 measured at **2.3 seconds** (91MB repo, shallow fetch).
  `/start.sh` then copies the already-upgraded tree, so ComfyUI launches on the
  right version and **never needs restarting** — which sidesteps the "CUDA
  unknown error on restart" trap entirely.
- **`PROVISION_PHASE=models`** — alongside `/start.sh`, in the background.
  Waits for ComfyUI to answer on `127.0.0.1:8188` (proof the `cp -r` finished,
  not just that `main.py` appeared) then downloads into the workspace copy.

Do **not** collapse these back into one pass in either direction.

### The log channel

A `python3 -m http.server` on port **7777** (declared in `ports` at creation)
serves `/var/log/provision/provision.log`. The app polls it over the RunPod
HTTPS proxy — no SSH, no WebSocket, no Docker internals. Output is `tee`'d so
it appears in **RunPod's own Container log tab as well**; an earlier version
redirected only to the file and left that tab blank.

### Useful: Jupyter is wide open

`https://<podId>-8888.proxy.runpod.net` needs **no token** — `/api/status`
answers 200. `POST /api/terminals` plus a WebSocket to
`/terminals/websocket/<name>` gives a **full root shell** on any pod, including
hosts with no SSH port. This is how the image internals above were discovered
without spending anything extra. Keep it in mind for debugging; it also remains
the fallback provisioning channel if the entrypoint override ever regresses.

## Proven end-to-end (RTX 4090, Secure Cloud, EU-RO-1)

| Stage | Cold (empty volume) | Warm (models on volume) |
|---|---|---|
| GPU health check + ComfyUI → v0.33.1 | 0:25 | 0:25 |
| ComfyUI serving | 2:29 | ~0:50 |
| Models present, checkpoints linked, ready | **4:34** | **1:02** |

Downloads sustained **~870 MB/s** across 8 parallel range requests. ComfyUI
reports `0.33.1` and `object_info/CheckpointLoaderSimple` lists both LTX
checkpoints, so all three setup requirements above are satisfied.

## Network volume: required reading

`ltx25-models` (`fjorcr8og1`, 60GB, **EU-RO-1**) holds the ~37GB of weights so
they are downloaded once rather than every session. It bills ~$0.006/hr
(~$4.38/mo) whether or not a pod is running — `currentSpendPerHr` is therefore
never exactly zero, and that is expected, not a stranded pod.

**A network volume forces Secure Cloud.** Asking for `cloudType: 'COMMUNITY'`
with a volume attached returns "no instances available" for *every* GPU — this
is not a stock problem and no amount of retrying helps. `lib/podops.ts` picks
`SECURE` automatically whenever a volume is found.

Consequences worth knowing before changing any of this:

- The pod is pinned to **EU-RO-1**, which is where the volume lives.
- Secure Cloud costs more: the **RTX 4090 at $0.74/hr** here, against $0.22/hr
  for a Community RTX 3090. In exchange the hosts are not broken — see below.
- `/workspace` is the volume mount, so ComfyUI *and* the models persist. That
  is why the warm start skips both the `cp -r` and the downloads.

## Community host quality — why we left

Both Community hosts drawn during testing were unusable, which is what
motivated the volume and Secure Cloud:

- **A dead GPU.** `nvidia-smi` saw the RTX 3090, `/dev/nvidia-uvm` existed, and
  torch was the correct `2.10.0+cu128` and unmodified — yet
  `torch.cuda.is_available()` returned `False` and ComfyUI crashed with
  `RuntimeError: CUDA unknown error`. Host-level fault.
- **0.43 MB/s.** One connection moved 25MB in 58s; 8 parallel managed ~1.8
  MB/s. The 20.5GB transformer alone would have taken hours. Compare 870 MB/s
  on Secure Cloud.

Earlier sessions very likely misdiagnosed the first of these as "restarting
ComfyUI from SSH breaks the CUDA context" — the same error appears on a bad
host with no restart involved.

`check_gpu()` still runs before any download and prints `GPU_BROKEN`;
`lib/podops.ts` then terminates that pod and retries a different host up to 3
times. It stays useful if the volume is ever removed.

### What to do next

1. **Generate a clip end to end.** Provisioning is proven; the LTX 2.5 pipeline
   behind it was proven in earlier sessions but has not been re-run since these
   changes. That is the one remaining gap.
2. **Watch volume headroom.** 60GB total, ~37GB models, and ComfyUI writes its
   outputs to `/workspace` too — roughly 20GB of slack. Generated clips live
   only on the pod until assembled.
3. **Consolidate the two pod-creation paths.** `lib/podops.ts` and
   `app/api/admin/videogen/route.ts` both create pods. The latter imports
   `bootCommand()`/`PORTS` now but still duplicates the GPU list and retry
   logic — and does **not** yet attach the volume or select Secure Cloud.

---

## Architecture

```
Browser → Next.js (this app) → RunPod pod → ComfyUI → LTX 2.5
                  ↓                          ElevenLabs API
             data/ (server-local)
```

### Key files

| Path | Purpose |
|---|---|
| `lib/podops.ts` | Pod lifecycle: create, boot-wait, provision, teardown. Streaming log generator. |
| `lib/comfyui.ts` | LTX 2.5 workflow builder, submit/poll, image upload, video fetch |
| `lib/runpod.ts` | Pod listing/lookup — used by the *older* `/api/admin/videogen` deploy path |
| `lib/studio.ts` | Characters + storyboards, JSON-file backed in `data/` |
| `lib/assemble.ts` | ffmpeg film assembly, ASS caption generation |
| `lib/elevenlabs.ts` | Voice list and TTS |
| `lib/presets.ts` | Look/grade preset phrasing for the movie builder |
| `scripts/provision-ltx25.sh` | Idempotent setup script — upgrades ComfyUI, fetches models, links checkpoints |
| `scripts/pod.sh` | CLI equivalent of the UI's pod lifecycle (`up`/`down`/`status`/`volume`) |
| `app/admin/videogen/movie/MovieClient.tsx` | The current primary UI — Higgsfield-style movie builder |
| `app/admin/videogen/movie/PodPanel.tsx` | Header GPU badge + streaming log popover |
| `app/admin/videogen/VideoGenClient.tsx` | Older UI — single-clip generation, still live but superseded by the movie builder |
| `app/admin/videogen/canvas/CanvasClient.tsx` | Node-graph UI — **explicitly rejected by the user**, kept only because it's still linked; not the intended workflow |
| `app/api/admin/videogen/pod/route.ts` | Streams `lib/podops.ts` lifecycle as NDJSON to the movie builder |
| `app/api/admin/videogen/route.ts` | Older deploy/status route for `VideoGenClient.tsx` — has its own separate (also unverified) dockerStartCmd logic |

**Two parallel pod-creation code paths exist** (`lib/podops.ts` and
`app/api/admin/videogen/route.ts`). They evolved separately and both now
attempt dockerStartCmd. Worth consolidating once one is proven working —
don't fix only one and assume the other matches.

### Data & storage

Generated clips live **only on the pod** — `data/` on the VPS holds character
images, storyboards, and *assembled* films, but not raw scene clips.
Terminating a pod loses any unassembled scenes. `data/` is gitignored
(includes the server's own SSH keypair for the old SSH-based provisioning
path — `data/ssh/pod_key`, unused now but left in place).

### Cost model

- GPU billing starts the instant a pod is created — **image pull time is
  charged**, typically <2 min on a warm host, up to ~20 min cold.
- `costPerHr` from RunPod's API is GPU-only; the console additionally shows
  storage (~$0.10/GB/month → ~$0.02/hr for a 150GB pod). The UI computes and
  displays the true total.
- **Always terminate, never stop.** A stopped pod keeps billing its
  container disk AND pins data to one physical machine — if that machine's
  GPU gets reallocated, resume fails permanently and the data is
  unreachable. This happened once today. `pod.sh down` / the UI's "Shut down
  GPU" both terminate.
- Balance is shown live in the UI (header badge + panel), pulled from
  RunPod's GraphQL `clientBalance` each poll.

---

## Deploy

```bash
git push origin main
ssh vps "cd /var/www/movie-studio && git pull origin main && npm run build && pm2 restart movie-studio --update-env"
```

Health check: `curl -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/admin/videogen/movie`
(307 = healthy, redirecting to login).

### Environment

`.env.production` on the VPS (gitignored):
```
RUNPOD_API_KEY=...
HF_TOKEN=...          # required — LTX 2.5 repo is gated
ELEVENLABS_API_KEY=...
ADMIN_PASSWORD_HASH=...
JWT_SECRET=...
PORT=3000
```

---

## Testing notes for whoever picks this up

- Log in at `/admin/login`, password is the one behind `ADMIN_PASSWORD_HASH`.
- **Before starting a pod**, check `curl -s -X POST https://api.runpod.io/graphql -H "Authorization: Bearer $RUNPOD_API_KEY" -H "Content-Type: application/json" -d '{"query":"query { myself { clientBalance pods { id } } }"}'`
  to confirm no pod is already running from a previous session — several
  today were left running by interrupted test runs.
- `npm run pod up` / `down` / `status` drives the exact `lib/podops.ts` code
  path the UI uses, straight from the terminal with streaming logs. Use it to
  test provisioning without clicking through the app — and **always** follow up
  with `npm run pod down`.
- To get a root shell on any running pod without SSH, see
  [Jupyter is wide open](#useful-jupyter-is-wide-open). Invaluable for
  inspecting a pod mid-provision.
- The LTX 2.5 pipeline behind provisioning is solid — it doesn't need
  re-proving, only re-reaching.
