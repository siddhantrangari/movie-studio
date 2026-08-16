import { NextRequest, NextResponse } from 'next/server'
import { isAdminAuthenticated } from '@/lib/auth'
import {
  startJob,
  currentJob,
  findPod,
  listAllPods,
  accountBalance,
  listNetworkVolumes,
  resizeVolume,
  deleteVolume,
  createVolume,
  type LogLine,
} from '@/lib/podops'

import { PodModel } from '@/lib/runpod'

import {
  checkAndAutoTerminateIdlePods,
  getAutoShutdownMinutes,
  setAutoShutdownMinutes,
  getPodIdleInfo,
  recordPodActivity,
} from '@/lib/auto-shutdown'

// Bringing a pod up includes a ~4 minute download.
export const maxDuration = 900
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const model = (req.nextUrl.searchParams.get('model') || 'ltx25') as PodModel

  // Run opportunistic idle check
  checkAndAutoTerminateIdlePods().catch(() => {})

  const [pod, allPods, account, volumes] = await Promise.all([
    findPod(model),
    listAllPods(),
    accountBalance(),
    listNetworkVolumes(),
  ])
  const job = currentJob()

  const gpu = Number(pod?.costPerHr ?? 0)
  const diskGb = Number(pod?.containerDiskInGb ?? 0) + Number(pod?.volumeInGb ?? 0)
  const storage = (diskGb * 0.1) / 730

  const idleInfo = pod ? getPodIdleInfo(String(pod.id)) : null

  return NextResponse.json({
    model,
    pod: pod
      ? {
          id: pod.id,
          name: pod.name,
          gpuDisplayName:
            (pod.gpuDisplayName as string) ||
            (pod.gpu as { id?: string })?.id ||
            (pod.machine as { gpuDisplayName?: string })?.gpuDisplayName ||
            (pod.gpuName as string) ||
            (pod.gpuTypeId as string) ||
            'NVIDIA GPU',
          status: pod.desiredStatus,
          costPerHr: gpu,
          storagePerHr: Number(storage.toFixed(4)),
          totalPerHr: Number((gpu + storage).toFixed(3)),
          diskGb,
          comfyui: `https://${pod.id}-8188.proxy.runpod.net`,
          jupyter: `https://${pod.id}-8888.proxy.runpod.net`,
          idleInfo,
        }
      : null,
    pods: allPods.map((p) => ({
      ...p,
      idleInfo: getPodIdleInfo(String(p.id)),
    })),
    volumes,
    account,
    autoShutdownMinutes: getAutoShutdownMinutes(),
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

  const body = await req.json()
  const { action, tier, model, terminatePodId, targetPodId, volumeId, newSizeGb, volumeName, dataCenterId } = body

  // Direct Network Volume Management Actions
  if (action === 'resize-volume') {
    if (!volumeId || !newSizeGb) {
      return NextResponse.json({ error: 'volumeId and newSizeGb are required' }, { status: 400 })
    }
    const res = await resizeVolume(volumeId, Number(newSizeGb))
    if (!res.ok) return NextResponse.json({ error: res.error || 'Resize failed' }, { status: 500 })
    return NextResponse.json({ ok: true, message: `Volume resized to ${newSizeGb} GB successfully!` })
  }

  if (action === 'delete-volume') {
    if (!volumeId) {
      return NextResponse.json({ error: 'volumeId is required' }, { status: 400 })
    }
    const res = await deleteVolume(volumeId)
    if (!res.ok) return NextResponse.json({ error: res.error || 'Delete failed' }, { status: 500 })
    return NextResponse.json({ ok: true, message: 'Volume deleted successfully!' })
  }

  if (action === 'create-volume') {
    if (!volumeName || !newSizeGb) {
      return NextResponse.json({ error: 'volumeName and newSizeGb are required' }, { status: 400 })
    }
    const res = await createVolume(volumeName, Number(newSizeGb), dataCenterId || 'EU-RO-1')
    if (!res.ok) return NextResponse.json({ error: res.error || 'Create failed' }, { status: 500 })
    return NextResponse.json({ ok: true, id: res.id, message: `Volume ${volumeName} created successfully!` })
  }

  if (action === 'set-auto-shutdown') {
    const minutes = Number(body.minutes || 5)
    setAutoShutdownMinutes(minutes)
    return NextResponse.json({ ok: true, minutes: getAutoShutdownMinutes(), message: `Auto-shutdown set to ${minutes} minutes of inactivity.` })
  }

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
