/**
 * Exercises the whole pipeline against a running pod: multi-scene generation,
 * then server-side assembly with crossfades and burned-in captions.
 *
 *   npm run movie -- <resolutionIndex> <sceneSeconds> <sceneCount>
 *
 * Unlike benchclip.ts this writes into data/, so it leaves a real film behind.
 */
import fs from 'fs'
import path from 'path'
import { findPod } from '../lib/podops'
import { buildWorkflow, submitPrompt, getJobStatus } from '../lib/comfyui'
import { RESOLUTIONS } from '../lib/resolutions'
import { startAssembly, getFilm, DEFAULT_CAPTIONS } from '../lib/assemble'
import type { Storyboard, Scene } from '../lib/studio'

const resIndex = Number(process.argv[2] ?? 0)
const seconds = Number(process.argv[3] ?? 3)
const count = Number(process.argv[4] ?? 3)

// Enough distinct shots for a full minute. Each prompt is different on
// purpose: ComfyUI caches the text-encoder output per prompt, so reusing one
// makes generation look ~30% faster than it really is.
const SHOTS = [
  'a lighthouse on a rocky cliff at dusk, waves breaking below, slow push in, cinematic',
  'storm clouds gathering over a grey ocean horizon, time lapse, wide shot',
  'a fishing boat cutting through heavy swell, spray over the bow, tracking shot',
  'rain lashing a weathered window pane, warm lamplight inside, shallow focus',
  'the lighthouse beam sweeping across black water, night, wide shot',
  'gulls scattering from a stone jetty as waves crash, slow motion',
  'an old keeper climbing a spiral iron staircase, lantern light, low angle',
  'close on brass gears turning inside the lighthouse lamp room, macro',
  'the beam cutting through thick fog, volumetric light, aerial view',
  'a small boat struggling toward harbour lights, distant, handheld',
  'waves exploding against black rocks, backlit by moonlight, slow motion',
  'the storm breaking, first light on a calm sea, wide aerial',
  'the lighthouse silhouetted against a pale dawn sky, static wide',
  'sunlight scattering across still water, gentle ripples, drifting close-up',
  'the keeper stepping out onto the gallery rail, looking out to a calm sea, wide',
]

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function main() {
  const pod = await findPod()
  if (!pod?.id) {
    console.error('No pod running — start one with `npm run pod up`.')
    process.exit(1)
  }
  const podId = String(pod.id)
  const rate = Number(pod.costPerHr) || 0
  const res = RESOLUTIONS[resIndex]
  console.log(`pod ${podId} at $${rate}/hr — ${count} x ${seconds}s at ${res.label}\n`)

  const t0 = Date.now()
  const scenes: Scene[] = []

  for (let i = 0; i < count; i++) {
    const built = buildWorkflow({
      prompt: SHOTS[i % SHOTS.length],
      seconds,
      width: res.w,
      height: res.h,
      seed: Math.floor(Math.random() * 2 ** 31),
    })
    const tScene = Date.now()
    const { prompt_id } = await submitPrompt(podId, built.workflow)

    for (;;) {
      await sleep(5000)
      const s = await getJobStatus(podId, prompt_id)
      if (s.state === 'done') {
        const secs = (Date.now() - tScene) / 1000
        console.log(`  scene ${i + 1}/${count} done in ${secs.toFixed(1)}s — ${s.filename}`)
        scenes.push({
          id: `s${i}`,
          order: i,
          title: `Scene ${i + 1}`,
          prompt: SHOTS[i % SHOTS.length],
          seconds,
          filename: s.filename,
          subfolder: s.subfolder,
          state: 'done',
          narration: '',
        })
        break
      }
      if (s.state === 'error') {
        console.error(`  scene ${i + 1} FAILED:`, s.error)
        process.exit(1)
      }
    }
  }

  const genSecs = (Date.now() - t0) / 1000
  console.log(`\nall ${count} scenes generated in ${genSecs.toFixed(1)}s`)

  const sb: Storyboard = {
    id: 'bench',
    title: 'Pipeline Benchmark',
    resolution: resIndex,
    audioMode: 'native',
    scenes,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }

  console.log('\nassembling (crossfades + burned-in captions)…')
  const tAsm = Date.now()
  const film = startAssembly(sb, podId, { ...DEFAULT_CAPTIONS, enabled: true })

  for (;;) {
    await sleep(3000)
    const f = getFilm(film.id)
    if (f?.state === 'done') {
      const asmSecs = (Date.now() - tAsm) / 1000
      const out = path.join(process.cwd(), 'data', 'films', f.file!)
      console.log(`\nASSEMBLED in ${asmSecs.toFixed(1)}s`)
      console.log(`  file:     ${out}`)
      console.log(`  size:     ${((f.bytes ?? 0) / 1048576).toFixed(1)} MB`)
      console.log(`  duration: ${f.duration?.toFixed(1)}s`)
      console.log(`  exists:   ${fs.existsSync(out)}`)
      const gpuCost = (genSecs / 3600) * rate
      console.log(`\n  GPU cost for ${count}x${seconds}s at ${res.label}: $${gpuCost.toFixed(4)}`)
      console.log(`  per 1-min video at this resolution: $${(gpuCost * (60 / (count * seconds))).toFixed(3)}`)
      return
    }
    if (f?.state === 'error') {
      console.error('\nASSEMBLY FAILED:', f.error)
      process.exit(1)
    }
  }
}

main().catch((e) => {
  console.error('FATAL', e)
  process.exit(1)
})
