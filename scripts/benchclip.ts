/**
 * Times a real clip generation on a running pod, so per-video cost is measured
 * rather than extrapolated from an old benchmark.
 *
 *   npm run bench -- <seconds>
 */
import { findPod } from '../lib/podops'
import { buildWorkflow, submitPrompt, getJobStatus } from '../lib/comfyui'

const seconds = Number(process.argv[2] ?? 5)

async function main() {
  const pod = await findPod()
  if (!pod?.id) {
    console.error('No pod running — start one first with `npm run pod up`.')
    process.exit(1)
  }
  const podId = String(pod.id)
  const rate = Number(pod.costPerHr) || 0

  console.log(`pod ${podId} at $${rate}/hr — generating a ${seconds}s clip`)

  const built = buildWorkflow({
    prompt:
      'a lighthouse on a rocky cliff at dusk, waves breaking below, slow push in, cinematic',
    seconds,
    // Fresh every run — ComfyUI caches by prompt+seed, so a repeated seed
    // returns the previous output in a few seconds and looks like a wildly
    // fast generation.
    seed: Math.floor(Math.random() * 2 ** 31),
  })

  const t0 = Date.now()
  const { prompt_id: promptId } = await submitPrompt(podId, built.workflow)
  console.log(`submitted ${promptId}`)

  for (;;) {
    await new Promise((r) => setTimeout(r, 5000))
    const s = await getJobStatus(podId, promptId)
    const elapsed = ((Date.now() - t0) / 1000).toFixed(0)
    if (s.state === 'done') {
      const secs = (Date.now() - t0) / 1000
      const cost = (secs / 3600) * rate
      console.log(`\nDONE in ${secs.toFixed(1)}s`)
      console.log(`  cost for this ${seconds}s clip: $${cost.toFixed(4)}`)
      const perMin = cost * (60 / seconds)
      console.log(`  extrapolated 1-minute video: $${perMin.toFixed(3)} (${((secs * (60 / seconds)) / 60).toFixed(1)} min GPU)`)
      return
    }
    if (s.state === 'error') {
      console.error(`\nFAILED after ${elapsed}s:`, s.error)
      process.exit(1)
    }
    console.log(`  ${elapsed}s — ${s.state}`)
  }
}

main().catch((e) => {
  console.error('FATAL', e)
  process.exit(1)
})
