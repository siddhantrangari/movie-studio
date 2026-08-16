import { NextRequest, NextResponse } from 'next/server'
import { isAdminAuthenticated } from '@/lib/auth'
import { getJobStatus, fetchVideo } from '@/lib/comfyui'
import { getRunningPodId } from '@/lib/runpod'
import { updateGenerationJob } from '@/lib/studio'
import { logUsage } from '@/lib/usage'
import { hasLocalClip, persistClip } from '@/lib/storage'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const ids = (req.nextUrl.searchParams.get('ids') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

  const requestedModel = req.nextUrl.searchParams.get('model') as 'ltx25' | 'minimax' | null
  const podId = requestedModel ? (await getRunningPodId(requestedModel)) : ((await getRunningPodId('ltx25')) || (await getRunningPodId('minimax')))
  if (!podId) {
    return NextResponse.json({ error: 'Pod not running', jobs: {} }, { status: 409 })
  }

  const entries = await Promise.all(
    ids.map(async (id) => {
      const st = await getJobStatus(podId, id)
      if (st) {
        const updated = updateGenerationJob(id, {
          state: st.state as 'queued' | 'running' | 'done' | 'error',
          filename: st.filename,
          subfolder: st.subfolder,
          error: st.error,
        })

        if (st.state === 'done' && st.filename && !hasLocalClip(st.filename)) {
          // Asynchronously cache the clip to persistent storage
          fetchVideo(podId, st.filename, st.subfolder || 'gen')
            .then(async (res) => {
              if (res.ok && res.body) {
                const arrayBuf = await res.arrayBuffer()
                const buf = Buffer.from(arrayBuf)
                if (buf.length > 0) {
                  await persistClip(st.filename!, buf, { projectId: updated?.projectId })
                }
              }
            })
            .catch(() => {})
        }

        if (st.state === 'done' && updated) {
          const startedAt = updated.startedAt || updated.createdAt || Date.now() - 40000
          const renderSecs = Math.max(5, Math.round((Date.now() - startedAt) / 1000))
          const cost = Number(((renderSecs / 3600) * 0.34).toFixed(5)) // standard pod baseline

          logUsage({
            category: 'gpu_compute',
            type: 'video_generation',
            model: 'ltx-video-2.5',
            durationSeconds: renderSecs,
            clipSeconds: updated.seconds || 6,
            gpuModel: 'NVIDIA RTX 4090 / A100',
            gpuHourlyRate: 0.34,
            costUsd: cost,
            details: `Rendered "${updated.label || 'Clip'}" (${updated.seconds || 6}s clip in ${renderSecs}s GPU time)`,
          })
        }
      }
      return [id, st] as const
    })
  )

  return NextResponse.json({ podId, jobs: Object.fromEntries(entries) })
}
