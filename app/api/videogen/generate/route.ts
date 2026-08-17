import { NextRequest, NextResponse } from 'next/server'
import { isAdminAuthenticated } from '@/lib/auth'
import { buildWorkflow, submitPrompt, uploadImageToPod } from '@/lib/comfyui'
import { getRunningPodId } from '@/lib/runpod'
import { getCharacters, readCharacterImage, getGenerationJobs, saveGenerationJob, deleteGenerationJob, newId } from '@/lib/studio'
import { composePrompt } from '@/lib/cinematography'
import { logUsage } from '@/lib/usage'
import { putReferenceAsset } from '@/lib/storage'
import { recordPodActivity } from '@/lib/auto-shutdown'
import { bringUp } from '@/lib/podops'

export const maxDuration = 300
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

  const maxRefs = model === 'minimax' ? 9 : 5
  let uploadedRefs: string[] = []

  // Check if pod is currently running and accepting jobs
  let podId = await getRunningPodId(model)

  // If pod is offline or booting, trigger background bringUp and queue the job immediately
  if (!podId) {
    console.log(`[Auto-Deploy] ${model.toUpperCase()} GPU pod is offline. Launching on-demand node for generation...`)
    const targetTier = model === 'minimax' ? 'ultra_4k' : (body.tier || 'standard')
    ;(async () => {
      try {
        for await (const log of bringUp(targetTier, undefined, model)) {
          console.log(`[Generate Auto-Deploy] ${log.text}`)
        }
      } catch (err) {
        console.error('[Generate Auto-Deploy Error]', err)
      }
    })()

    const jobId = `job_${newId()}`
    const saved = saveGenerationJob({
      id: jobId,
      projectId: projectId || 'default-project',
      promptId: '',
      prompt,
      label: label || 'Custom Video Shot',
      createdAt: Date.now(),
      state: 'queued',
      width: width ?? (model === 'minimax' ? 1280 : 704),
      height: height ?? (model === 'minimax' ? 720 : 384),
      seconds: seconds ?? 4,
      characterId,
      model,
      referenceImages: Array.isArray(referenceImages) ? referenceImages : undefined,
    })

    return NextResponse.json({
      success: true,
      booting: true,
      job: saved,
      promptId: jobId,
      message: `🚀 ${model === 'minimax' ? 'MiniMax Hailuo 3' : 'LTX-Video 2.5'} GPU node is starting up. Your shot is queued and will begin rendering automatically once ComfyUI finishes booting (~30-45s).`,
    })
  }

  // Upload and resolve all reference images
  if (Array.isArray(referenceImages) && referenceImages.length > 0) {
    const fs = await import('fs')
    const path = await import('path')

    for (let i = 0; i < Math.min(referenceImages.length, maxRefs); i++) {
      const img = referenceImages[i]
      if (typeof img === 'string' && img.startsWith('data:image/')) {
        const matches = img.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/)
        if (matches && matches[2]) {
          const mime = matches[1] || 'image/png'
          const ext = mime.includes('jpeg') || mime.includes('jpg') ? 'jpg' : mime.includes('webp') ? 'webp' : 'png'
          const buf = Buffer.from(matches[2], 'base64')
          const fname = `ref_${Date.now()}_${i}.${ext}`
          try {
            await putReferenceAsset(fname, buf, projectId || 'default-project', mime)
            const uploadedName = await uploadImageToPod(podId, buf, fname)
            uploadedRefs.push(uploadedName)
          } catch (err) {
            console.error('Error uploading base64 ref image:', err)
          }
        }
      } else if (typeof img === 'string' && (img.startsWith('http://') || img.startsWith('https://'))) {
        try {
          const res = await fetch(img)
          if (res.ok) {
            const buf = Buffer.from(await res.arrayBuffer())
            const fname = `ref_${Date.now()}_${i}.png`
            const uploadedName = await uploadImageToPod(podId, buf, fname)
            uploadedRefs.push(uploadedName)
          }
        } catch (err) {
          console.error('Error fetching ref image URL:', err)
        }
      } else if (typeof img === 'string' && img.trim()) {
        try {
          let buf: Buffer | null = null
          const clean = img.trim()
          if (clean.includes('/characters') || clean.includes('characters/')) {
            const fname = clean.split('file=')[1] || path.basename(clean)
            const { readCharacterImage } = await import('@/lib/studio')
            buf = readCharacterImage(decodeURIComponent(fname))
          } else if (clean.includes('/references') || clean.includes('references/')) {
            const fname = clean.split('key=')[1] || clean.split('file=')[1] || path.basename(clean)
            const localRefPath = path.join(process.cwd(), 'data', 'references', path.basename(decodeURIComponent(fname)))
            if (fs.existsSync(localRefPath)) {
              buf = fs.readFileSync(localRefPath)
            }
          } else {
            const localRefPath = path.join(process.cwd(), 'data', 'references', path.basename(clean))
            if (fs.existsSync(localRefPath)) {
              buf = fs.readFileSync(localRefPath)
            }
          }
          if (buf) {
            const fname = `ref_${Date.now()}_${i}.png`
            const uploadedName = await uploadImageToPod(podId, buf, fname)
            uploadedRefs.push(uploadedName)
          }
        } catch (err) {
          console.error('Error loading relative reference image:', err)
        }
      }
    }
  }

  let uploadedAudio: string | undefined
  const rawAudio = body.audioFile || body.audioUrl || body.songAudio
  if (rawAudio && typeof rawAudio === 'string' && rawAudio.startsWith('data:audio/')) {
    const matches = rawAudio.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/)
    if (matches && matches[2]) {
      const mime = matches[1] || 'audio/mpeg'
      const ext = mime.includes('wav') ? 'wav' : 'mp3'
      const buf = Buffer.from(matches[2], 'base64')
      const fname = `song_${Date.now()}.${ext}`
      try {
        uploadedAudio = await uploadImageToPod(podId, buf, fname)
      } catch (err) {
        console.error('Error uploading song audio to pod:', err)
      }
    }
  } else if (rawAudio && typeof rawAudio === 'string' && rawAudio.trim()) {
    uploadedAudio = rawAudio.trim()
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
            console.error('Error uploading character ref image:', e)
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
    audioFile: uploadedAudio,
    referenceStrength,
  })

  try {
    const { prompt_id } = await submitPrompt(podId, built.workflow)
    recordPodActivity(podId)

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
    const errText = (e as Error).message
    // If pod is still warming up ComfyUI, save job as queued rather than throwing 502 error
    if (errText.includes('initializing') || errText.includes('502') || errText.includes('ComfyUI')) {
      const jobId = `job_${newId()}`
      const saved = saveGenerationJob({
        id: jobId,
        projectId: projectId || 'default-project',
        promptId: '',
        prompt,
        label: label || 'Custom Video Shot',
        createdAt: Date.now(),
        state: 'queued',
        width: built.width,
        height: built.height,
        seconds: seconds ?? 4,
        characterId,
      })
      return NextResponse.json({
        success: true,
        booting: true,
        job: saved,
        promptId: jobId,
        message: '🚀 GPU node is initializing model weights. Shot is queued and will render automatically.',
      })
    }
    return NextResponse.json({ error: errText }, { status: 502 })
  }
}
