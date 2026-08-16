import { NextRequest, NextResponse } from 'next/server'
import { isAdminAuthenticated } from '@/lib/auth'
import { podBase, comfyHeaders } from '@/lib/comfyui'
import { listPods, findPod } from '@/lib/runpod'
import { currentJob } from '@/lib/podops'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const podId = req.nextUrl.searchParams.get('podId') || (await findPod('minimax'))?.id || (await findPod('ltx25'))?.id

  if (!podId) {
    return NextResponse.json({ error: 'No active pod running' }, { status: 404 })
  }

  const base = podBase(String(podId))
  const headers = comfyHeaders(base)

  const logs: { time: string; level: 'info' | 'ok' | 'warn' | 'error'; text: string }[] = []
  let vramTotalGb = 0
  let vramFreeGb = 0
  let gpuName = 'NVIDIA GPU'
  let isComfyOnline = false
  let runningJobs: any[] = []
  let pendingJobs: any[] = []
  let historyCount = 0

  // 1. Check current provisioning job logs if available
  const job = currentJob()
  if (job && job.lines.length > 0) {
    for (const line of job.lines) {
      logs.push({
        time: new Date().toLocaleTimeString(),
        level: line.level === 'done' ? 'ok' : line.level,
        text: line.text,
      })
    }
  }

  // 2. Fetch ComfyUI /system_stats
  try {
    const statsRes = await fetch(`${base}/system_stats`, {
      headers,
      signal: AbortSignal.timeout(3500),
      cache: 'no-store',
    })
    if (statsRes.ok) {
      isComfyOnline = true
      const stats = await statsRes.json()
      const dev = stats?.devices?.[0]
      if (dev) {
        gpuName = dev.name || 'NVIDIA GPU'
        vramTotalGb = Number((dev.vram_total / (1024 ** 3)).toFixed(1))
        vramFreeGb = Number((dev.vram_free / (1024 ** 3)).toFixed(1))
      }
      logs.push({
        time: new Date().toLocaleTimeString(),
        level: 'ok',
        text: `ComfyUI Server Online on ${gpuName} — VRAM: ${(vramTotalGb - vramFreeGb).toFixed(1)}GB used / ${vramTotalGb}GB total`,
      })
    }
  } catch (err: any) {
    logs.push({
      time: new Date().toLocaleTimeString(),
      level: 'warn',
      text: `ComfyUI system stats probe: ${err.message || 'Connecting...'}`,
    })
  }

  // 3. Fetch ComfyUI /queue
  if (isComfyOnline) {
    try {
      const qRes = await fetch(`${base}/queue`, {
        headers,
        signal: AbortSignal.timeout(3500),
        cache: 'no-store',
      })
      if (qRes.ok) {
        const q = await qRes.json()
        runningJobs = Array.isArray(q.queue_running) ? q.queue_running : []
        pendingJobs = Array.isArray(q.queue_pending) ? q.queue_pending : []

        if (runningJobs.length > 0) {
          logs.push({
            time: new Date().toLocaleTimeString(),
            level: 'info',
            text: `▶ Actively executing prompt: ${runningJobs[0]?.[1] || 'video generation'} (Queue: ${runningJobs.length} running, ${pendingJobs.length} pending)`,
          })
        } else if (pendingJobs.length > 0) {
          logs.push({
            time: new Date().toLocaleTimeString(),
            level: 'info',
            text: `⏳ Jobs waiting in queue: ${pendingJobs.length}`,
          })
        } else {
          logs.push({
            time: new Date().toLocaleTimeString(),
            level: 'ok',
            text: `✓ GPU Worker idle & ready for incoming prompts.`,
          })
        }
      }
    } catch {
      // ignore
    }

    // 4. Fetch ComfyUI /history
    try {
      const hRes = await fetch(`${base}/history`, {
        headers,
        signal: AbortSignal.timeout(3500),
        cache: 'no-store',
      })
      if (hRes.ok) {
        const h = await hRes.json()
        const keys = Object.keys(h)
        historyCount = keys.length
        if (keys.length > 0) {
          const lastKey = keys[keys.length - 1]
          const lastJob = h[lastKey]
          const isSuccess = !!lastJob?.outputs
          logs.push({
            time: new Date().toLocaleTimeString(),
            level: isSuccess ? 'ok' : 'warn',
            text: `Last completed job: ${lastKey.slice(0, 8)}... (${isSuccess ? 'Success' : 'Error'})`,
          })
        }
      }
    } catch {
      // ignore
    }
  }

  // 5. Get Pod details
  const allPods = await listPods()
  const pod = allPods.find((p) => String(p.id) === String(podId))

  return NextResponse.json({
    podId,
    podName: pod?.name || 'gpu-node',
    gpuName,
    status: pod?.desiredStatus || (isComfyOnline ? 'RUNNING' : 'WARMING'),
    isComfyOnline,
    vram: {
      totalGb: vramTotalGb,
      freeGb: vramFreeGb,
      usedGb: Number((vramTotalGb - vramFreeGb).toFixed(1)),
      usagePercent: vramTotalGb > 0 ? Math.round(((vramTotalGb - vramFreeGb) / vramTotalGb) * 100) : 0,
    },
    uptimeSeconds: (pod?.runtime as { uptimeInSeconds?: number })?.uptimeInSeconds || 0,
    costPerHr: Number(pod?.costPerHr || 0.69),
    queue: {
      runningCount: runningJobs.length,
      pendingCount: pendingJobs.length,
      historyCount,
    },
    logs,
  })
}
