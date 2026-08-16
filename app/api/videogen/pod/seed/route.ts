import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import { findVolume, fetchProvisionLog, PORTS } from '@/lib/podops'

const RUNPOD_REST = 'https://rest.runpod.io/v1'
const TEMPLATE_ID = 'cw3nka7d08'

function rpHeaders() {
  return {
    Authorization: `Bearer ${process.env.RUNPOD_API_KEY}`,
    'Content-Type': 'application/json',
  }
}

async function rpApi(path: string, init?: RequestInit) {
  const res = await fetch(`${RUNPOD_REST}${path}`, {
    ...init,
    headers: rpHeaders(),
    cache: 'no-store',
    signal: AbortSignal.timeout(20_000),
  })
  const text = await res.text()
  try { return { ok: res.ok, data: JSON.parse(text) } } catch { return { ok: res.ok, data: text } }
}

/**
 * POST /api/videogen/pod/seed
 * Spins up a cheap GPU pod with the 200GB network volume mounted at /workspace,
 * then runs seed-volume.sh to download ALL models (LTX 2.5 + MiniMax H3) in one go.
 * Pod auto-terminates on completion. Returns a streaming NDJSON progress log.
 */
export const dynamic = 'force-dynamic'
export const maxDuration = 1800 // 30 min

// Cheapest GPUs that can run the download job (any GPU works, we just need /start.sh)
const SEED_GPUS = [
  'NVIDIA GeForce RTX 3090',
  'NVIDIA RTX A5000',
  'NVIDIA GeForce RTX 4090',
  'NVIDIA RTX A6000',
  'NVIDIA A40',
  'NVIDIA L40',
]

export async function POST(req: NextRequest) {
  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      const send = (level: string, text: string) => {
        try { controller.enqueue(encoder.encode(JSON.stringify({ level, text }) + '\n')) } catch {}
      }

      try {
        // 1. Find the persistent volume
        send('info', '🔍 Looking for persistent network volume...')
        const volume = await findVolume()
        if (!volume) {
          send('error', '❌ No network volume found on this account. Create a 200GB volume first from Engines Hub.')
          controller.close()
          return
        }
        send('ok', `✓ Found volume "${volume.name}" (${volume.size}GB, ${volume.dataCenterId})`)

        // 2. Read seed script
        let seedScript = ''
        try {
          seedScript = fs.readFileSync(path.join(process.cwd(), 'scripts', 'seed-volume.sh'), 'utf8')
        } catch {
          send('error', '❌ Could not read scripts/seed-volume.sh from server.')
          controller.close()
          return
        }
        send('ok', `✓ Seed script loaded (${(seedScript.length / 1024).toFixed(1)} KB)`)

        // 3. Build boot command that starts the log server + runs the seed script
        const LOG_PORT = 7777
        const LOG_DIR = '/var/log/provision'
        const bootCmd = [
          `mkdir -p ${LOG_DIR}`,
          `LOG=${LOG_DIR}/provision.log`,
          ': > "$LOG"',
          `PY=$(command -v python3 || command -v python)`,
          `[ -n "$PY" ] && ("$PY" -m http.server ${LOG_PORT} --directory ${LOG_DIR} >/dev/null 2>&1 &)`,
          `printenv PROVISION_SCRIPT > ${LOG_DIR}/provision.sh`,
          `(bash ${LOG_DIR}/provision.sh 2>&1 | tee -a "$LOG")`,
          'exec /start.sh',
        ].join('\n')

        // 4. Boot the cheapest available GPU pod with volume in the volume's datacenter
        send('info', `🚀 Starting seed pod in ${volume.dataCenterId} with volume attached...`)
        send('info', '   (Any GPU works — we just need Docker to run, no GPU compute needed)')

        let podId = ''
        let podGpu = ''

        for (const gpu of SEED_GPUS) {
          send('info', `  Trying ${gpu}...`)

          const body: Record<string, unknown> = {
            name: 'model-volume-seeder',
            templateId: TEMPLATE_ID,
            gpuTypeIds: [gpu],
            gpuCount: 1,
            volumeInGb: 0,           // Use network volume only
            containerDiskInGb: 50,
            cloudType: 'COMMUNITY',
            ports: PORTS,
            networkVolumeId: volume.id,
            volumeMountPath: '/workspace',
            env: {
              HF_TOKEN: process.env.HF_TOKEN ?? '',
              PROVISION_SCRIPT: seedScript,
            },
            dockerEntrypoint: ['/bin/bash', '-c'],
            dockerStartCmd: [bootCmd],
          }

          let res = await rpApi('/pods', { method: 'POST', body: JSON.stringify(body) })

          // Try SECURE cloud as fallback in the same datacenter
          if (!res.data?.id) {
            body.cloudType = 'SECURE'
            res = await rpApi('/pods', { method: 'POST', body: JSON.stringify(body) })
          }

          if (res.data?.id) {
            podId = String(res.data.id)
            podGpu = gpu
            const rate = Number(res.data.costPerHr ?? 0).toFixed(2)
            send('ok', `✓ Seed pod created: ${podId} — ${gpu} @ $${rate}/hr`)
            send('info', `   Pod will auto-terminate after all downloads complete`)
            break
          }

          const errMsg = typeof res.data?.error === 'string' ? res.data.error : JSON.stringify(res.data)
          send('warn', `  ${gpu} unavailable: ${errMsg.slice(0, 80)}`)
        }

        if (!podId) {
          send('error', '❌ No GPU available for seeding. Try again in a few minutes.')
          controller.close()
          return
        }

        // 5. Tail the provision log until SEED_COMPLETE
        send('info', '')
        send('info', '═══════════════════════════════════════════════════')
        send('info', '📥 Download progress (streaming from pod):')
        send('info', '   LTX 2.5:     ~37 GB')
        send('info', '   MiniMax H3:  ~66.5 GB')
        send('info', '   Total:       ~103 GB @ ~100-200 MB/s ≈ 10-20 min')
        send('info', '═══════════════════════════════════════════════════')

        const MAX_TRIES = 200 // ~33 min at 10s
        let lastLogLen = 0
        let seedComplete = false

        for (let i = 0; i < MAX_TRIES; i++) {
          await new Promise((r) => setTimeout(r, 10_000))

          // Check pod is still alive
          const { data: podData } = await rpApi(`/pods/${podId}`)
          const status = String(podData?.desiredStatus ?? podData?.status ?? '')
          if (status && !['RUNNING', 'PENDING', ''].includes(status)) {
            if (!seedComplete) {
              send('warn', `⚠ Pod entered ${status} before SEED_COMPLETE — check RunPod dashboard`)
            }
            break
          }

          // Fetch new log lines
          const log = await fetchProvisionLog(podId)
          if (!log) {
            if (i < 6) send('info', `  Waiting for pod to boot... (${(i + 1) * 10}s)`)
            continue
          }

          const newContent = log.slice(lastLogLen)
          lastLogLen = log.length

          for (const line of newContent.split('\n').filter(Boolean)) {
            send('log', line)
            if (line.includes('SEED_COMPLETE')) {
              seedComplete = true
              send('ok', '')
              send('ok', '🎉 ALL MODELS SEEDED TO PERSISTENT VOLUME!')
              send('ok', '   Future pods will find weights already present and skip downloading.')
              send('ok', '   Terminating seed pod...')
              await rpApi(`/pods/${podId}`, { method: 'DELETE' })
              send('done', podId)
              controller.close()
              return
            }
          }
        }

        if (!seedComplete) {
          send('warn', `⏱ Seeding timed out. Pod ${podId} may still be running on RunPod.`)
          send('info', 'If downloads completed successfully, models are already on the volume.')
          send('info', 'You can terminate the seed pod manually from Engines Hub.')
        }
      } catch (err: any) {
        try { controller.enqueue(encoder.encode(JSON.stringify({ level: 'error', text: String(err?.message ?? err) }) + '\n')) } catch {}
      }
      try { controller.close() } catch {}
    },
  })

  return new NextResponse(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'X-Accel-Buffering': 'no',
    },
  })
}

export async function GET() {
  return NextResponse.json({ status: 'Use POST to start volume seeding' })
}
