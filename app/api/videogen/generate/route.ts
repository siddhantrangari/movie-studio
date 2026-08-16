import { NextRequest, NextResponse } from 'next/server'
import { isAdminAuthenticated } from '@/lib/auth'
import { buildWorkflow, submitPrompt, uploadImageToPod } from '@/lib/comfyui'
import { getRunningPodId } from '@/lib/runpod'
import { getCharacters, readCharacterImage, getGenerationJobs, saveGenerationJob, deleteGenerationJob, newId } from '@/lib/studio'
import { composePrompt } from '@/lib/cinematography'
import { logUsage } from '@/lib/usage'
import { putReferenceAsset } from '@/lib/storage'

export const maxDuration = 60
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const projectId = req.nextUrl.searchParams.get('projectId') || undefined
  const jobs = getGenerationJobs(projectId)
  return NextResponse.json({ success: true, jobs })
}

export async function DELETE(req: NextRequest) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })
  deleteGenerationJob(id)
  return NextResponse.json({ success: true })
}

export async function POST(req: NextRequest) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json()
  const {
    prompt, seconds, width, height, seed, referenceStrength, negativePrompt,
    characterId, cameraMotion, lens, lighting, colorPalette, projectId, label,
  } = body
  const model = body.model === 'minimax' ? 'minimax' : 'ltx25'
  let { referenceImage, referenceImages } = body

  if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
    return NextResponse.json({ error: 'Prompt is required' }, { status: 400 })
  }

  const podId = await getRunningPodId(model)
  if (!podId) {
    return NextResponse.json(
      { error: `${model === 'minimax' ? 'MiniMax Hailuo 3' : 'LTX 2.5'} pod is not running. Deploy or resume it first.` },
      { status: 409 }
    )
  }

  const maxRefs = model === 'minimax' ? 9 : 5
  let uploadedRefs: string[] = []

  if (Array.isArray(referenceImages) && referenceImages.length > 0) {
    for (let i = 0; i < Math.min(referenceImages.length, maxRefs); i++) {
      const img = referenceImages[i]
      if (typeof img === 'string' && img.startsWith('data:image/')) {
        const matches = img.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/)
        if (matches && matches[2]) {
          const mime = matches[1] || 'image/png'
          const buf = Buffer.from(matches[2], 'base64')
          const fname = `ref_${Date.now()}_${i}.png`
          try {
            // 1. Permanently preserve in Cloudflare R2 user gallery & media assets
            await putReferenceAsset(fname, buf, projectId || 'default-project', mime)
            // 2. Upload directly to GPU pod for diffusion sampling
            const uploadedName = await uploadImageToPod(podId, buf, fname)
            uploadedRefs.push(uploadedName)
          } catch (err) {
            console.error('Error uploading ref image:', err)
          }
        }
      } else if (typeof img === 'string' && img.trim()) {
        uploadedRefs.push(img)
      }
    }
  }

  // A character contributes both ways: its portrait seeds the first frame, and
  // its appearance notes lead the prompt.
  let characterDescription: string | undefined
  if (characterId) {
    const character = getCharacters().find((c) => c.id === characterId)
    if (character) {
      characterDescription = character.description
      if (!referenceImage && uploadedRefs.length === 0 && character.imageFile) {
        const buf = readCharacterImage(character.imageFile)
        if (buf) {
          try {
            referenceImage = await uploadImageToPod(podId, buf, character.imageFile)
          } catch (e) {
            return NextResponse.json({ error: (e as Error).message }, { status: 502 })
          }
        }
      }
    }
  }

  const built = buildWorkflow({
    model,
    prompt: composePrompt({ prompt, characterDescription, cameraMotion, lens, lighting, colorPalette }),
    negativePrompt,
    seconds: seconds ?? (model === 'minimax' ? 5 : 4),
    width: width ?? (model === 'minimax' ? 1280 : 704),
    height: height ?? (model === 'minimax' ? 720 : 384),
    seed,
    referenceImage,
    referenceImages: uploadedRefs.length > 0 ? uploadedRefs : undefined,
    referenceStrength,
  })

  try {
    const { prompt_id } = await submitPrompt(podId, built.workflow)

    const jobId = `job_${newId()}`
    const saved = saveGenerationJob({
      id: jobId,
      projectId: projectId || 'default-project',
      promptId: prompt_id,
      prompt,
      label: label || 'Custom Video Shot',
      createdAt: Date.now(),
      state: 'queued',
      width: built.width,
      height: built.height,
      seconds: seconds ?? 4,
      characterId,
    })

    logUsage({
      category: 'video_gen',
      type: 'clip_render',
      model: model === 'minimax' ? 'MiniMax Hailuo 3' : 'LTX 2.5',
      durationSeconds: seconds ?? 4,
      costUsd: 0,
      details: `Generated Clip (${model.toUpperCase()}): "${prompt.slice(0, 50)}..." (${built.width}x${built.height})`,
    })

    return NextResponse.json({
      success: true,
      job: saved,
      promptId: prompt_id,
      podId,
      seed: built.seed,
      frames: built.length,
      width: built.width,
      height: built.height,
      fps: built.fps,
    })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 })
  }
}
