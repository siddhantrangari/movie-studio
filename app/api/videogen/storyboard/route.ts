import { NextRequest, NextResponse } from 'next/server'
import { isAdminAuthenticated } from '@/lib/auth'
import {
  getStoryboards, getStoryboard, saveStoryboard, deleteStoryboard,
  getCharacters, readCharacterImage, composeScenePrompt, newId,
  type Storyboard,
} from '@/lib/studio'
import { buildWorkflow, submitPrompt, uploadImageToPod, getJobStatus } from '@/lib/comfyui'
import { DEFAULT_RESOLUTION } from '@/lib/resolutions'
import { getRunningPodId } from '@/lib/runpod'

export const maxDuration = 120
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const id = req.nextUrl.searchParams.get('id')
  if (id) {
    const sb = getStoryboard(id)
    if (!sb) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    // Auto-poll ComfyUI status for any pending scenes
    const pendingScenes = (sb.scenes || []).filter((s) => s.promptId && (s.state === 'queued' || s.state === 'running' || !s.state))
    if (pendingScenes.length > 0) {
      const podId = (await getRunningPodId('ltx25')) || (await getRunningPodId('minimax'))
      if (podId) {
        let changed = false
        const { logUsage } = await import('@/lib/usage')
        for (const scene of pendingScenes) {
          if (!scene.promptId) continue
          const status = await getJobStatus(podId, scene.promptId)
          if (status && status.state !== scene.state) {
            const prevState = scene.state
            scene.state = status.state as typeof scene.state
            scene.filename = status.filename
            scene.subfolder = status.subfolder
            scene.error = status.error
            changed = true

            if (status.state === 'done' && prevState !== 'done') {
              const renderSecs = Math.max(8, Math.round((scene.seconds || 6) * 6.5))
              const cost = Number(((renderSecs / 3600) * 0.34).toFixed(5))

              logUsage({
                category: 'gpu_compute',
                type: 'storyboard_shot_render',
                model: 'ltx-video-2.5',
                durationSeconds: renderSecs,
                clipSeconds: scene.seconds || 6,
                gpuModel: 'NVIDIA RTX 4090 / A100',
                gpuHourlyRate: 0.34,
                costUsd: cost,
                details: `Rendered "${sb.title} - Shot #${scene.order}: ${scene.title}" (${scene.seconds}s clip in ${renderSecs}s GPU time)`,
              })
            }
          }
        }
        if (changed) {
          saveStoryboard(sb)
        }
      }
    }

    return NextResponse.json({ storyboard: sb })
  }
  return NextResponse.json({ storyboards: getStoryboards() })
}

export async function PUT(req: NextRequest) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const body = (await req.json()) as Partial<Storyboard>
  const now = Date.now()
  const sb: Storyboard = {
    id: body.id || newId(),
    projectId: body.projectId || 'default-project',
    title: body.title || 'Untitled movie',
    model: body.model || 'ltx25',
    referenceImages: body.referenceImages,
    resolution: body.resolution ?? DEFAULT_RESOLUTION,
    audioMode: body.audioMode ?? 'native',
    voiceId: body.voiceId,
    scenes: (body.scenes || []).map((s, idx) => ({
      ...s,
      id: s.id || `sc_${now}_${idx}`,
      order: s.order || idx + 1,
      prompt: (s.prompt || (s as { description?: string }).description || '').trim(),
      seconds: s.seconds || 6,
      state: s.state || 'idle',
    })),
    createdAt: body.createdAt ?? now,
    updatedAt: now,
  }
  return NextResponse.json({ success: true, storyboard: saveStoryboard(sb) })
}

export async function DELETE(req: NextRequest) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  deleteStoryboard(id)
  return NextResponse.json({ success: true })
}

/**
 * POST — queue scenes for generation.
 * Body: { id, sceneIds?: string[], model?: string, referenceImages?: string[] }
 */
export async function POST(req: NextRequest) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id, sceneIds, model: reqModel, referenceImages: reqRefs } = await req.json()
  const sb = getStoryboard(id)
  if (!sb) return NextResponse.json({ error: 'Storyboard not found' }, { status: 404 })

  let targetModel: 'ltx25' | 'minimax' = (reqModel || sb.model || 'ltx25') as 'ltx25' | 'minimax'
  let podId = await getRunningPodId(targetModel)

  if (!podId) {
    return NextResponse.json({
      error: `${targetModel === 'minimax' ? 'MiniMax Hailuo 3' : 'LTX-Video 2.5'} GPU pod is not running or still initializing. Please check the Engines Hub.`,
    }, { status: 409 })
  }

  const { RESOLUTIONS } = await import('@/lib/resolutions')
  const res = RESOLUTIONS[sb.resolution] ?? RESOLUTIONS[0]
  const characters = getCharacters()
  const targets = sceneIds?.length
    ? sb.scenes.filter((s) => sceneIds.includes(s.id))
    : sb.scenes

  const rawRefList = (reqRefs && reqRefs.length > 0 ? reqRefs : (sb.referenceImages || []))
  const uploadedRefs: string[] = []
  const uploaded = new Map<string, string>()

  // Upload all attached reference images to the GPU pod
  for (let idx = 0; idx < rawRefList.length; idx++) {
    const img = rawRefList[idx]
    if (typeof img === 'string' && img.startsWith('data:image/')) {
      const matches = img.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/)
      if (matches && matches[2]) {
        const mime = matches[1] || 'image/png'
        const ext = mime.includes('jpeg') || mime.includes('jpg') ? 'jpg' : mime.includes('webp') ? 'webp' : 'png'
        const buf = Buffer.from(matches[2], 'base64')
        const fname = `ref_${idx}_${Date.now()}.${ext}`
        try {
          const uploadedName = await uploadImageToPod(podId, buf, fname)
          uploadedRefs.push(uploadedName)
        } catch (err) {
          console.error('Error uploading storyboard ref image:', err)
        }
      }
    } else if (typeof img === 'string' && img.startsWith('http')) {
      try {
        const res = await fetch(img)
        if (res.ok) {
          const buf = Buffer.from(await res.arrayBuffer())
          const fname = `ref_${idx}_${Date.now()}.png`
          const uploadedName = await uploadImageToPod(podId, buf, fname)
          uploadedRefs.push(uploadedName)
        }
      } catch (err) {
        console.error('Error fetching ref image URL:', err)
      }
    } else if (typeof img === 'string' && img.trim()) {
      uploadedRefs.push(img.trim())
    }
  }

  for (const scene of targets) {
    try {
      scene.prompt = (scene.prompt || (scene as { description?: string }).description || '').trim()
      if (!scene.prompt) {
        throw new Error('Scene prompt is empty')
      }

      let referenceImage: string | undefined
      const char = scene.characterId ? characters.find((c) => c.id === scene.characterId) : undefined

      if (char?.imageFile) {
        if (!uploaded.has(char.imageFile)) {
          const buf = readCharacterImage(char.imageFile)
          if (buf) uploaded.set(char.imageFile, await uploadImageToPod(podId, buf, char.imageFile))
        }
        referenceImage = uploaded.get(char.imageFile)
      }

      const composed = composeScenePrompt(scene, characters)
      const built = buildWorkflow({
        model: targetModel,
        prompt: composed,
        seconds: scene.seconds || 6,
        width: targetModel === 'minimax' ? (res.w >= 1280 ? res.w : 1280) : res.w,
        height: targetModel === 'minimax' ? (res.h >= 720 ? res.h : 720) : res.h,
        referenceImage,
        referenceImages: uploadedRefs.length > 0 ? uploadedRefs : undefined,
      })

      const { prompt_id } = await submitPrompt(podId, built.workflow)
      scene.promptId = prompt_id
      scene.state = 'queued'
      scene.error = undefined
      scene.filename = undefined
    } catch (e) {
      scene.state = 'error'
      scene.error = (e as Error).message
    }
  }

  const saved = saveStoryboard(sb)
  const failedCount = targets.filter((s) => s.state === 'error').length

  return NextResponse.json({
    success: failedCount === 0,
    storyboard: saved,
    podId,
    failedCount,
    error: failedCount > 0 ? `${failedCount} of ${targets.length} shots failed to queue: ${targets.find((s) => s.error)?.error || 'Unknown error'}` : undefined,
  })
}
