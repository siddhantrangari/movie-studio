import { NextRequest, NextResponse } from 'next/server'
import { isAdminAuthenticated } from '@/lib/auth'
import { startJob, currentJob, findPod, listAllPods, accountBalance, type LogLine } from '@/lib/podops'

import { PodModel } from '@/lib/runpod'

// Bringing a pod up includes a ~4 minute download.
export const maxDuration = 900
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const model = (req.nextUrl.searchParams.get('model') || 'ltx25') as PodModel
  const [pod, allPods, account] = await Promise.all([findPod(model), listAllPods(), accountBalance()])
  const job = currentJob()

  const gpu = Number(pod?.costPerHr ?? 0)
  const diskGb = Number(pod?.containerDiskInGb ?? 0) + Number(pod?.volumeInGb ?? 0)
  const storage = (diskGb * 0.1) / 730

  return NextResponse.json({
    model,
    pod: pod
      ? {
          id: pod.id,
          name: pod.name,
          gpuDisplayName: (pod.machine as { gpuDisplayName?: string })?.gpuDisplayName || (pod.gpuName as string) || (pod.gpuTypeId as string) || 'NVIDIA GPU',
          status: pod.desiredStatus,
          costPerHr: gpu,
          storagePerHr: Number(storage.toFixed(4)),
          totalPerHr: Number((gpu + storage).toFixed(3)),
          diskGb,
          comfyui: `https://${pod.id}-8188.proxy.runpod.net`,
          jupyter: `https://${pod.id}-8888.proxy.runpod.net`,
        }
      : null,
    pods: allPods,
    account,
    // Lets a reloaded page re-attach to a run already in flight.
    job: job ? { running: job.running, action: job.action, lines: job.lines, tier: job.tier, model: job.model } : null,
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

  const { action, tier, model, terminatePodId, targetPodId } = await req.json()
  const validActions = ['up', 'down', 'stop', 'start', 'terminate']
  if (!validActions.includes(action)) {
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  }

  // The run itself is detached, so navigating away no longer strands a
  // half-provisioned pod that is still billing. This response just tails it.
  const targetModel = (model === 'minimax' ? 'minimax' : 'ltx25') as PodModel
  const job = startJob(action as 'up' | 'down' | 'stop' | 'start' | 'terminate', {
    model: targetModel,
    tier: tier || 'standard',
    terminatePodId,
    targetPodId,
  })
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
