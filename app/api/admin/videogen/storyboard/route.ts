import { NextRequest, NextResponse } from 'next/server'
import { isAdminAuthenticated } from '@/lib/auth'
import {
  getStoryboards, getStoryboard, saveStoryboard, deleteStoryboard,
  getCharacters, readCharacterImage, composeScenePrompt, newId,
  type Storyboard,
} from '@/lib/studio'
import { buildWorkflow, submitPrompt, uploadImageToPod } from '@/lib/comfyui'
import { getRunningPodId } from '@/lib/runpod'

export const maxDuration = 120

export async function GET(req: NextRequest) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const id = req.nextUrl.searchParams.get('id')
  if (id) {
    const sb = getStoryboard(id)
    if (!sb) return NextResponse.json({ error: 'Not found' }, { status: 404 })
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
    title: body.title || 'Untitled movie',
    resolution: body.resolution ?? 0,
    audioMode: body.audioMode ?? 'native',
    voiceId: body.voiceId,
    scenes: body.scenes ?? [],
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
 *
 * Each scene's character reference image is uploaded to the current pod first,
 * so the same face carries across every shot it appears in.
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
    return NextResponse.json({ error: 'LTX 2.5 pod is not running.' }, { status: 409 })
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
      let referenceImage: string | undefined
      const char = scene.characterId ? characters.find((c) => c.id === scene.characterId) : undefined

      if (char?.imageFile) {
        if (!uploaded.has(char.imageFile)) {
          const buf = readCharacterImage(char.imageFile)
          if (buf) uploaded.set(char.imageFile, await uploadImageToPod(podId, buf, char.imageFile))
        }
        referenceImage = uploaded.get(char.imageFile)
      }

      const built = buildWorkflow({
        prompt: composeScenePrompt(scene, characters),
        seconds: scene.seconds,
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

  return NextResponse.json({ success: true, storyboard: saveStoryboard(sb), podId })
}
