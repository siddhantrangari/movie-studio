import { NextRequest, NextResponse } from 'next/server'
import { isAdminAuthenticated } from '@/lib/auth'
import { startJob, currentJob, findPod, accountBalance, type LogLine } from '@/lib/podops'

// Bringing a pod up includes a ~4 minute download.
export const maxDuration = 900
export const dynamic = 'force-dynamic'

export async function GET() {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const [pod, account] = await Promise.all([findPod(), accountBalance()])
  const job = currentJob()

  // The API's costPerHr is the GPU rate only; RunPod's console shows GPU plus
  // storage, which is why the two disagreed. Storage runs ~$0.10/GB/month on a
  // running pod. GPU rates also move with demand, so this is re-read every poll
  // rather than cached from creation time.
  const gpu = Number(pod?.costPerHr ?? 0)
  const diskGb = Number(pod?.containerDiskInGb ?? 0) + Number(pod?.volumeInGb ?? 0)
  const storage = (diskGb * 0.1) / 730

  return NextResponse.json({
    pod: pod
      ? {
          id: pod.id,
          status: pod.desiredStatus,
          costPerHr: gpu,
          storagePerHr: Number(storage.toFixed(4)),
          totalPerHr: Number((gpu + storage).toFixed(3)),
          diskGb,
          comfyui: `https://${pod.id}-8188.proxy.runpod.net`,
          jupyter: `https://${pod.id}-8888.proxy.runpod.net`,
        }
      : null,
    account,
    // Lets a reloaded page re-attach to a run already in flight.
    job: job ? { running: job.running, action: job.action, lines: job.lines } : null,
  })
}

/**
 * Streams lifecycle progress as newline-delimited JSON so the UI can show the
 * log as it happens instead of staring at a spinner for four minutes.
 */
export async function POST(req: NextRequest) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { action } = await req.json()
  if (!['up', 'down'].includes(action)) {
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  }

  // The run itself is detached, so navigating away no longer strands a
  // half-provisioned pod that is still billing. This response just tails it.
  const job = startJob(action)
  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      const send = (line: LogLine) => {
        try {
          controller.enqueue(encoder.encode(JSON.stringify(line) + '\n'))
        } catch {
          // client hung up; the job keeps going regardless
        }
      }
      let sent = 0
      for (;;) {
        while (sent < job.lines.length) send(job.lines[sent++])
        if (!job.running && sent >= job.lines.length) break
        await new Promise((r) => setTimeout(r, 400))
      }
      send({ level: 'done', text: '' })
      try { controller.close() } catch { /* already closed */ }
    },
  })

  return new NextResponse(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-store, no-transform',
      Connection: 'keep-alive',
      // Nginx buffers proxied responses by default, which would defeat streaming.
      'X-Accel-Buffering': 'no',
    },
  })
}
