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
      const podId = await getRunningPodId('ltx25')
      if (podId) {
        let changed = false
        for (const scene of pendingScenes) {
          if (!scene.promptId) continue
          const status = await getJobStatus(podId, scene.promptId)
          if (status && status.state !== scene.state) {
            scene.state = status.state as typeof scene.state
            scene.filename = status.filename
            scene.subfolder = status.subfolder
            scene.error = status.error
            changed = true
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
 * Body: { id, sceneIds?: string[] }  (omit sceneIds to render the whole board)
 */
export async function POST(req: NextRequest) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id, sceneIds } = await req.json()
  const sb = getStoryboard(id)
  if (!sb) return NextResponse.json({ error: 'Storyboard not found' }, { status: 404 })

  const podId = await getRunningPodId('ltx25')
  if (!podId) {
    return NextResponse.json({ error: 'LTX 2.5 GPU Pod is offline. Please start the GPU node from the top banner first.' }, { status: 409 })
  }

  const { RESOLUTIONS } = await import('@/lib/resolutions')
  const res = RESOLUTIONS[sb.resolution] ?? RESOLUTIONS[0]
  const characters = getCharacters()
  const targets = sceneIds?.length
    ? sb.scenes.filter((s) => sceneIds.includes(s.id))
    : sb.scenes

  // Reference images are shared across scenes; upload each only once.
  const uploaded = new Map<string, string>()

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
        prompt: composed,
        seconds: scene.seconds || 6,
        width: res.w,
        height: res.h,
        referenceImage,
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
