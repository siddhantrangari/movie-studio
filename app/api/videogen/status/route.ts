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

  const rawParam = req.nextUrl.searchParams.get('promptId') || req.nextUrl.searchParams.get('ids') || ''
  const ids = rawParam
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

  const explicitPodId = req.nextUrl.searchParams.get('podId')
  const requestedModel = req.nextUrl.searchParams.get('model') as 'ltx25' | 'minimax' | null
  const podId = explicitPodId || (requestedModel ? (await getRunningPodId(requestedModel)) : ((await getRunningPodId('minimax')) || (await getRunningPodId('ltx25'))))
  
  if (!podId) {
    // Return graceful 200 with booting flag so UI polling stays smooth
    return NextResponse.json({ podId: null, booting: true, jobs: {} })
  }

  const { getGenerationJobs, getCharacters, readCharacterImage } = await import('@/lib/studio')
  const { buildWorkflow, submitPrompt, uploadImageToPod } = await import('@/lib/comfyui')
  const { composePrompt } = await import('@/lib/cinematography')
  const allJobs = getGenerationJobs('all')

  const entries = await Promise.all(
    ids.map(async (id) => {
      // Check if this is a queued job without a promptId that needs dispatching
      const matchingJob = allJobs.find((j) => j.id === id || j.promptId === id)
      if (matchingJob && (!matchingJob.promptId || matchingJob.state === 'queued') && !matchingJob.filename) {
        if (!matchingJob.promptId) {
          try {
            const targetModel = matchingJob.model || 'ltx25'
            const characters = getCharacters()
            const char = matchingJob.characterId ? characters.find((c) => c.id === matchingJob.characterId) : undefined
            let referenceImage: string | undefined
            const uploadedRefs: string[] = []

            if (char?.imageFile) {
              const buf = readCharacterImage(char.imageFile)
              if (buf) {
                referenceImage = await uploadImageToPod(podId, buf, char.imageFile)
              }
            }

            if (Array.isArray(matchingJob.referenceImages) && matchingJob.referenceImages.length > 0) {
              for (let i = 0; i < matchingJob.referenceImages.length; i++) {
                const img = matchingJob.referenceImages[i]
                if (typeof img === 'string' && img.startsWith('data:image/')) {
                  const matches = img.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/)
                  if (matches && matches[2]) {
                    const ext = matches[1]?.includes('jpeg') ? 'jpg' : 'png'
                    const buf = Buffer.from(matches[2], 'base64')
                    const fname = `ref_${Date.now()}_${i}.${ext}`
                    uploadedRefs.push(await uploadImageToPod(podId, buf, fname))
                  }
                }
              }
            }

            const built = buildWorkflow({
              model: targetModel,
              prompt: composePrompt({ prompt: matchingJob.prompt, characterDescription: char?.description }),
              seconds: matchingJob.seconds || 4,
              width: matchingJob.width || (targetModel === 'minimax' ? 1280 : 704),
              height: matchingJob.height || (targetModel === 'minimax' ? 720 : 384),
              referenceImage,
              referenceImages: uploadedRefs.length > 0 ? uploadedRefs : undefined,
            })

            const { prompt_id } = await submitPrompt(podId, built.workflow)
            matchingJob.promptId = prompt_id
            matchingJob.state = 'running'
            updateGenerationJob(id, { promptId: prompt_id, state: 'running' })
            return [id, { state: 'running' as const, filename: undefined, subfolder: undefined, error: undefined }] as const
          } catch (err: any) {
            console.log('[Auto-Dispatch Status] Waiting for ComfyUI:', err?.message)
            return [id, { state: 'queued' as const, filename: undefined, subfolder: undefined, error: undefined }] as const
          }
        }
      }

      const lookupId = matchingJob?.promptId || id
      const st = await getJobStatus(podId, lookupId)
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

  const singleJob = ids.length === 1 ? entries[0]?.[1] : null
  const jobsMap = Object.fromEntries(entries)

  return NextResponse.json({
    podId,
    jobs: jobsMap,
    state: singleJob?.state,
    filename: singleJob?.filename,
    subfolder: singleJob?.subfolder,
    videoUrl: singleJob?.filename ? `/api/videogen/video?file=${encodeURIComponent(singleJob.filename)}` : undefined,
    error: singleJob?.error,
  })
}
