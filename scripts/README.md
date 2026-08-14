# GPU pod scripts

Everything for the LTX 2.5 box the studio generates on.

```bash
./scripts/pod.sh status     # what's running, what it costs
./scripts/pod.sh up         # deploy + provision
./scripts/pod.sh down       # terminate, stop all billing
./scripts/pod.sh volume     # one-time: create a network volume
```

Reads `RUNPOD_API_KEY` and `HF_TOKEN` from `.env.local`.

## Terminate, don't stop

A **stopped** pod still bills for its container disk — about **$0.01/hr, ~$7/month** —
and it pins your data to one physical machine. When that machine's GPU gets taken by
someone else, resume fails with *"not enough free GPUs on the host machine"* and the
data is unreachable. That happened to us and cost an afternoon.

`./pod.sh down` **terminates**, which bills nothing at all.

## The re-download question

Terminating drops the 38GB of model weights with the pod, so the next `up` downloads
them again (~4 min). Two ways to avoid that:

| | Standing cost | `up` takes | Can get stranded |
|---|---|---|---|
| Stopped pod | ~$7/mo | ~1 min | **Yes** — this is what broke |
| Network volume | ~$4.20/mo (60GB) | ~2 min | No |
| Terminate, re-download | **$0** | ~6 min | No |

A network volume is both cheaper and more reliable than leaving a pod stopped, and it
mounts to any pod in the same datacenter. Run `./pod.sh volume` once to set it up.

If you only generate occasionally, plain terminate-and-redownload costs nothing and
the extra four minutes is the whole penalty. That's the default.

## provision-ltx25.sh

Takes a bare RunPod ComfyUI pod to working LTX 2.5. Idempotent — it checks before every
step, so re-running on a warm volume does almost nothing. `pod.sh up` calls it for you.

Three things it fixes, each of which fails confusingly on its own:

1. **ComfyUI must be ≥ v0.33.1.** The official template ships v0.30.0, whose LTXV
   text-encoder path only knows Gemma 3. LTX 2.5 uses Gemma 4, so it falls through to a
   SentencePiece tokenizer and dies with `not enough values to unpack (expected 4, got 1)`.
2. **The conv VAE, not the plain one.** `ltx-2.5-video-vae-conv-bf16` pairs with the
   convrot transformer; the plain `-bf16` file is the DiffVAE and throws a conv-kernel
   size mismatch.
3. **`checkpoints/` must contain the transformer and audio VAE.** Both LTX AV loaders
   build their dropdowns from that folder — empty dropdowns mean an empty folder, not a
   missing model. Symlinks are fine.

It also recovers `HF_TOKEN` from `/proc/1/environ`, because an SSH session doesn't
inherit the container environment and RunPod's `/etc/rp_environment` omits it.

### Why it resets the container instead of restarting ComfyUI

Starting ComfyUI from an SSH session loses the container's GPU context — torch dies with
`CUDA unknown error` even while `nvidia-smi` works. The script calls RunPod's `/reset`
endpoint so the image's own entrypoint starts ComfyUI properly. Your SSH session drops
when it does; that's expected, and ComfyUI is back about a minute later.

### Running it by hand

In the pod's Jupyter terminal:

```bash
curl -sL https://raw.githubusercontent.com/siddhantrangari/movie-studio/main/scripts/provision-ltx25.sh | bash
```
