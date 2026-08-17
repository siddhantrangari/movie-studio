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

    // Auto-poll and auto-dispatch queued scenes when GPU pod becomes ready
    const targetModel = (sb.model || 'ltx25') as 'ltx25' | 'minimax'
    const podId = await getRunningPodId(targetModel)

    if (podId) {
      let changed = false
      const { RESOLUTIONS } = await import('@/lib/resolutions')
      const res = RESOLUTIONS[sb.resolution] ?? RESOLUTIONS[0]
      const characters = getCharacters()
      const rawRefList = sb.referenceImages || []
      let uploadedRefs: string[] | null = null

      // Check if any scenes are waiting to be submitted
      const scenes = sb.scenes || []
      const { extractLastFrame } = await import('@/lib/assemble')
      const { getLocalClipPath } = await import('@/lib/storage')
      const { fetchVideo } = await import('@/lib/comfyui')
      const fs = await import('fs')

      for (let i = 0; i < scenes.length; i++) {
        const scene = scenes[i]
        if (scene.state === 'queued' && !scene.promptId) {
          // If this is Shot N (where N > 1), wait for previous shot to finish so we can chain last-to-first frame
          let startFrame: string | undefined
          if (i > 0) {
            const prevScene = scenes[i - 1]
            if (prevScene.state !== 'done') {
              // Wait for previous shot to finish rendering before dispatching this shot
              break
            }

            // Extract last frame of previous shot for seamless visual & camera continuity
            if (prevScene.filename) {
              try {
                let prevClipPath = getLocalClipPath(prevScene.filename)
                if (!fs.existsSync(prevClipPath) || fs.statSync(prevClipPath).size === 0) {
                  // Fetch from pod if not on local disk
                  const podRes = await fetchVideo(podId, prevScene.filename, prevScene.subfolder || 'gen')
                  if (podRes.ok && podRes.body) {
                    const buf = Buffer.from(await podRes.arrayBuffer())
                    const { persistClip } = await import('@/lib/storage')
                    prevClipPath = await persistClip(prevScene.filename, buf, { projectId: sb.projectId })
                  }
                }

                if (fs.existsSync(prevClipPath) && fs.statSync(prevClipPath).size > 0) {
                  const lastFrameBuf = await extractLastFrame(prevClipPath)
                  if (lastFrameBuf && lastFrameBuf.length > 0) {
                    const fname = `last_frame_${sb.id}_scene_${i}_${Date.now()}.png`
                    startFrame = await uploadImageToPod(podId, lastFrameBuf, fname)
                    console.log(`[Last-to-First Chaining] Extracted last frame of Scene #${i} -> Seeding as first frame for Scene #${i + 1} (${startFrame})`)
                  }
                }
              } catch (err: any) {
                console.error('[Last-to-First Chaining Error]', err?.message)
              }
            }
          }

          try {
            if (!uploadedRefs) {
              uploadedRefs = []
              for (let idx = 0; idx < rawRefList.length; idx++) {
                const img = rawRefList[idx]
                if (typeof img === 'string' && img.startsWith('data:image/')) {
                  const matches = img.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/)
                  if (matches && matches[2]) {
                    const mime = matches[1] || 'image/png'
                    const ext = mime.includes('jpeg') || mime.includes('jpg') ? 'jpg' : mime.includes('webp') ? 'webp' : 'png'
                    const buf = Buffer.from(matches[2], 'base64')
                    const fname = `ref_${idx}_${Date.now()}.${ext}`
                    uploadedRefs.push(await uploadImageToPod(podId, buf, fname))
                  }
                } else if (typeof img === 'string' && img.trim()) {
                  uploadedRefs.push(img.trim())
                }
              }
            }

            const composed = composeScenePrompt(scene, characters)
            const built = buildWorkflow({
              model: targetModel,
              prompt: composed,
              seconds: scene.seconds || 6,
              width: targetModel === 'minimax' ? (res.w >= 1280 ? res.w : 1280) : res.w,
              height: targetModel === 'minimax' ? (res.h >= 720 ? res.h : 720) : res.h,
              startFrame,
              referenceImages: uploadedRefs.length > 0 ? uploadedRefs : undefined,
            })

            const { prompt_id } = await submitPrompt(podId, built.workflow)
            scene.promptId = prompt_id
            scene.state = 'queued'
            changed = true
          } catch (err: any) {
            console.log('[Storyboard Auto-Dispatch] Waiting for ComfyUI to accept jobs:', err.message)
            break
          }
        }
      }

      // Check running jobs status
      const pendingScenes = (sb.scenes || []).filter((s) => s.promptId && (s.state === 'queued' || s.state === 'running' || !s.state))
      if (pendingScenes.length > 0) {
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
                model: targetModel === 'minimax' ? 'minimax-h3' : 'ltx-video-2.5',
                durationSeconds: renderSecs,
                clipSeconds: scene.seconds || 6,
                gpuModel: 'NVIDIA RTX 4090 / A100',
                gpuHourlyRate: 0.34,
                costUsd: cost,
                details: `Rendered "${sb.title} - Shot #${scene.order}: ${scene.title}" (${scene.seconds}s clip in ${renderSecs}s GPU time)`,
              })

              // Persist clip to local storage & R2 immediately so it never expires
              if (status.filename) {
                const { fetchVideo } = await import('@/lib/comfyui')
                const { hasLocalClip, persistClip } = await import('@/lib/storage')
                if (!hasLocalClip(status.filename)) {
                  fetchVideo(podId, status.filename, status.subfolder || 'gen')
                    .then(async (res) => {
                      if (res.ok && res.body) {
                        const arrayBuf = await res.arrayBuffer()
                        const buf = Buffer.from(arrayBuf)
                        if (buf.length > 0) {
                          await persistClip(status.filename!, buf, { projectId: sb.projectId })
                        }
                      }
                    })
                    .catch(() => {})
                }
              }
            }
          }
        }
      }

      if (changed) {
        saveStoryboard(sb)
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
  try {
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
  } catch (err: any) {
    console.error('[Storyboard PUT Error]', err)
    return NextResponse.json({ error: err?.message || 'Failed to save storyboard' }, { status: 500 })
  }
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
    console.log(`[Auto-Deploy] ${targetModel.toUpperCase()} GPU pod is offline. Launching on-demand node for storyboard...`)
    const { bringUp } = await import('@/lib/podops')
    const targetTier = targetModel === 'minimax' ? 'ultra_4k' : 'standard'
    // Fire bringUp in background so pod starts booting immediately
    ;(async () => {
      try {
        for await (const log of bringUp(targetTier, undefined, targetModel)) {
          console.log(`[Storyboard Auto-Deploy] ${log.text}`)
        }
      } catch (err) {
        console.error('[Storyboard Auto-Deploy Error]', err)
      }
    })()

    // Mark all target scenes as queued
    const targets = sceneIds?.length
      ? sb.scenes.filter((s) => sceneIds.includes(s.id))
      : sb.scenes

    for (const sc of targets) {
      sc.state = 'queued'
      sc.error = undefined
      sc.promptId = undefined
    }
    saveStoryboard(sb)

    return NextResponse.json({
      success: true,
      booting: true,
      storyboard: sb,
      podId: null,
      message: `🚀 ${targetModel === 'minimax' ? 'MiniMax Hailuo 3' : 'LTX-Video 2.5'} GPU node is starting up. All ${targets.length} shots are queued and will begin rendering automatically once ComfyUI initializes.`,
    })
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

  for (let i = 0; i < targets.length; i++) {
    const scene = targets[i]
    scene.prompt = (scene.prompt || (scene as { description?: string }).description || '').trim()
    scene.state = 'queued'
    scene.error = undefined
    scene.filename = undefined
    scene.promptId = undefined

    // Only dispatch Shot 1 immediately; Shots 2+ will be automatically dispatched
    // with Last-to-First frame chaining as each preceding shot finishes rendering.
    if (i === 0) {
      try {
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
      } catch (e) {
        scene.state = 'error'
        scene.error = (e as Error).message
      }
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
