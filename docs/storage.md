# Storage — what this app writes, and where

The VPS is shared with other production apps (`chalonline`, `getmyagent`,
`siddhantrangari`, `trading-os`, and others under `/var/www/`). This document
exists so Movie Studio's disk usage stays predictable and auditable, and so
nobody has to guess whether a stray directory belongs to this app.

## Everything lives under one app-specific folder

All runtime state is written inside the app's own directory:

```
/var/www/movie-studio/data/
```

Nothing is written to `/tmp`, `/var/lib`, a home directory, or any shared
location. The path comes from `process.cwd()` in `lib/assemble.ts`,
`lib/studio.ts`, `lib/canvas.ts`, and `lib/podops.ts` — so the app is
relocatable and can never collide with a sibling app.

`data/` is gitignored and is **not** created by the deploy; it accumulates at
runtime.

### Layout

| Path | Contents | Grows? | Cleaned up by |
|---|---|---|---|
| `data/films/*.mp4` | Finished films | **Yes — unbounded** | Manual delete in the UI |
| `data/work/<filmId>/` | Scratch: downloaded scene clips, voiceover mp3s, ASS captions | Transient | `finally` in `assemble()`, plus `sweepOrphanedWork()` |
| `data/characters/*` | Reference portraits | Slowly | Deleting a character |
| `data/films.json` | Film index | Negligible | — |
| `data/storyboards.json`, `data/characters.json`, `data/canvas.json` | Project state | Negligible | — |
| `data/ssh/` | Server keypair injected as `PUBLIC_KEY` for pod debugging | Fixed, ~8KB | — |

## The two things that can actually grow

**1. `data/films/` is unbounded by design.** Finished films are the app's
output and are only removed when a user deletes them. At CRF 18 a minute of
1080p runs roughly 100–200MB, so this is the number to watch. The UI surfaces
the running total via `filmsDiskUsage()` — check it before assembling a batch.
There is deliberately no automatic expiry: silently deleting someone's
finished film is worse than running out of headroom, which is visible and
recoverable.

**2. `data/work/` can leak on a hard kill.** `assemble()` removes its own
scratch directory in a `finally` block, which covers success and error. It
cannot cover the process being killed outright — a PM2 restart or an OOM
during ffmpeg. Those directories hold every downloaded scene clip, so they are
the largest transient files the app produces.

`sweepOrphanedWork()` in `lib/assemble.ts` handles that case. It runs at the
start of every assembly and removes any scratch directory that is not backed
by a film currently in the `building` state — plus any `building` directory
older than 6 hours, which by then must be a crash leftover rather than live
work.

## What is NOT stored on the VPS

Generated scene clips live **only on the RunPod pod** until a film is
assembled. `data/` holds character images, storyboards, and assembled films —
not raw scenes. Terminating a pod loses any unassembled scenes; that is the
documented tradeoff for not mirroring tens of GB onto the VPS.

Model weights (~35GB for LTX 2.5) are downloaded onto the pod's own volume at
provisioning time and never touch the VPS. See `scripts/provision-ltx25.sh`.

## Checking usage

```bash
ssh vps 'df -h / ; du -sh /var/www/movie-studio/data/* 2>/dev/null | sort -h'
```

As of the last check the VPS was at 50% (196G free) and this app's `data/` was
under 30KB, with `/var/www/movie-studio` itself at 776MB — almost entirely
`node_modules` and `.next`.

If headroom ever gets tight, delete finished films from the UI first; that is
where the bytes are.
