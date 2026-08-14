import { NextRequest, NextResponse } from 'next/server'
import { isAdminAuthenticated } from '@/lib/auth'
import { buildWorkflow, submitPrompt } from '@/lib/comfyui'
import { getRunningPodId } from '@/lib/runpod'

export const maxDuration = 60

export async function POST(req: NextRequest) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json()
  const { prompt, seconds, width, height, seed, referenceImage, referenceStrength, negativePrompt } = body

  if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
    return NextResponse.json({ error: 'Prompt is required' }, { status: 400 })
  }

  const podId = await getRunningPodId('ltx25')
  if (!podId) {
    return NextResponse.json(
      { error: 'LTX 2.5 pod is not running. Deploy or resume it first.' },
      { status: 409 }
    )
  }

  const built = buildWorkflow({
    prompt: prompt.trim(),
    negativePrompt,
    seconds: seconds ?? 4,
    width: width ?? 704,
    height: height ?? 384,
    seed,
    referenceImage,
    referenceStrength,
  })

  try {
    const { prompt_id } = await submitPrompt(podId, built.workflow)
    return NextResponse.json({
      success: true,
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
