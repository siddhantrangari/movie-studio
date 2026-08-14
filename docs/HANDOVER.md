# Movie Studio — Handover

AI video generation studio: RunPod GPU management, LTX 2.5 clip generation,
character consistency, storyboarding, and film assembly with captions.

**Live:** `siddhantrangari.com` → deployed separately at `/var/www/movie-studio`
on the VPS, PM2 process `movie-studio`, port 3000.

This doc exists because two agent sessions worked on this today and a third
is picking it up. Read this before touching pod provisioning — the most
recent change (dockerStartCmd) is **unverified and currently appears broken**.
Don't repeat the experiment that already cost money twice without reading
[Current blocker](#current-blocker-unverified) first.

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

## Current blocker (unverified)

**Provisioning a fresh pod has never successfully completed today, across
~6 attempts by two different agent sessions.** Three different causes were
found and fixed in sequence; the current one is unconfirmed and may not work.

### Attempt 1–3 (this session): SSH-based provisioning

`lib/podops.ts` used to SSH into the pod after boot and pipe
`scripts/provision-ltx25.sh` in over stdin. This failed three times for two
different reasons:

- **Some RunPod hosts never assign a public IP or TCP port at all** — only
  the HTTP proxy (`*.proxy.runpod.net`) works. Confirmed directly: a pod
  showed `portMappings: null` and `publicIp: ""` for 8+ minutes while ComfyUI
  answered fine over the HTTP proxy. No amount of waiting fixes this — SSH is
  structurally impossible on that class of host.
- **A boot-timeout bug** (now fixed) killed a pod that was still pulling its
  5GB container image, mistaking normal cold-start time for failure.

### Attempt 4+ (other agent session, commits `dca2fbc`, `9317f48`):
switched to `dockerStartCmd`

The idea: pass the provisioning script as the pod's Docker start command at
creation time, so it runs at container boot with no SSH needed at all. Sound
idea, `dockerStartCmd` is a real, documented RunPod API field. But:

**I tested it and it did not work**, then confirmed why for certain —
without spending anything, by reading the image manifest directly from
Docker Hub's registry API (no pod, no pull, just two `curl`s):

```json
"Entrypoint": ["/start.sh"],
"Cmd": null
```

`runpod/comfyui:cuda12.8` has a **fixed ENTRYPOINT**. Docker always execs
`ENTRYPOINT [CMD...]` — the entrypoint is never replaced, only its
arguments are. RunPod's `dockerStartCmd` overrides Cmd, not Entrypoint. So
what actually ran on the pod was:

```
/start.sh bash -c "printenv PROVISION_SCRIPT > /tmp/provision.sh && ..."
```

— i.e. `/start.sh` invoked with three positional arguments (`$1=bash`,
`$2=-c`, `$3="printenv..."`) that a normal bootstrap script has no reason to
read. It ignored them and ran its own default startup, which is exactly what
was observed: stock ComfyUI 0.30.0, empty `checkpoints/`, no error, no sign
our script ever ran. **This is not a timing issue or bad luck — the approach
cannot work against this image, confirmed.**

The dockerStartCmd code is still live in `lib/podops.ts` (`bringUp()`) and
in `app/api/admin/videogen/route.ts` (the older, separate deploy path used
by `VideoGenClient.tsx`) — **both carry this same broken assumption and
need to be reverted or replaced, not retried.**

### What to do next

**Don't retry dockerStartCmd.** It's not a matter of tuning the command —
the entrypoint structurally prevents it from ever running our script on this
image.

1. **Jupyter-over-HTTPS is the strongest next path.** The HTTP proxy
   (`*-8888.proxy.runpod.net`) is reachable on every host seen today,
   including the ones where SSH was structurally impossible — it doesn't
   route through the container's TCP ports or Docker CMD/ENTRYPOINT at all,
   just the app-level HTTP proxy RunPod already guarantees. Driving
   Jupyter's kernel WebSocket API (`POST /api/kernels`, then
   `/api/kernels/{id}/channels`, sending an `execute_request` and reading
   `stream` messages back) would run the provisioning script and stream its
   output with the same live-log UX, without depending on SSH ports or
   Docker internals at all. More code than what's there now, but it's the
   one channel proven reachable on every host so far.
2. **Alternative: find out if `/start.sh` has its own hook mechanism.**
   Many RunPod templates source a user script from a fixed path or env var
   before launching services (common patterns: `/workspace/*.sh` on boot,
   or an `INIT_SCRIPT` env var). This would need inspecting the image
   filesystem — `docker pull runpod/comfyui:cuda12.8 && docker run
   --entrypoint cat runpod/comfyui:cuda12.8 /start.sh` (needs a GPU-less
   pull, ~5GB, no RunPod spend) — to read `/start.sh` and see if it already
   supports this. If it does, that's less code than the Jupyter route.
3. **Revert to SSH, but only as a fallback with a health check that
   distinguishes "host has no TCP port" from "still booting.**" SSH does
   work on hosts that expose a port (proven multiple times this session
   when a `portMappings.22` value was present) — the earlier failures were
   real, but the fix isn't dockerStartCmd, it's detecting the no-port case
   immediately (as `lib/podops.ts` does now) and retrying on a different
   host rather than switching provisioning strategy entirely.
4. **Network volume**, independent of the above: `findVolumeId()` already
   looks for one named `ltx25-models` but none has been created yet. Once
   provisioning works at all, creating this volume makes subsequent starts
   ~2 min instead of ~5, and survives termination. Not the current blocker.

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
- The movie builder's "Start GPU" button and `scripts/pod.sh up` both hit the
  same broken dockerStartCmd path right now. Fix `lib/podops.ts::bringUp()`
  first; port the fix to `app/api/admin/videogen/route.ts` after.
- Once provisioning is confirmed working, the actual LTX 2.5 pipeline behind
  it is solid — that part doesn't need re-proving, only re-reaching.
