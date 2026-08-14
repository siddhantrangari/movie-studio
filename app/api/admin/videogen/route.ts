import { NextRequest, NextResponse } from 'next/server'
import { isAdminAuthenticated } from '@/lib/auth'
import { listPods, runpodHeaders, POD_NAMES } from '@/lib/runpod'

const RUNPOD_API = 'https://rest.runpod.io/v1'

// Ordered cheapest → most expensive (community pricing)
const LTX_GPUS = [
  'NVIDIA GeForce RTX 3090',   // $0.22/hr — 24GB
  'NVIDIA GeForce RTX 4090',   // $0.34/hr — 24GB
  'NVIDIA RTX A6000',          // $0.33/hr — 48GB
  'NVIDIA A40',                // $0.35/hr — 48GB
  'NVIDIA L40S',               // $0.79/hr — 48GB
  'NVIDIA A100 80GB PCIe',     // $1.19/hr — last resort
]

// MiniMax H3 INT8 needs 48GB+
const MINIMAX_GPUS = [
  'NVIDIA RTX A6000',
  'NVIDIA A40',
  'NVIDIA L40S',
  'NVIDIA A100 80GB PCIe',
  'NVIDIA A100-SXM4-80GB',
]

const restHeaders = runpodHeaders

// GET /api/admin/videogen — fetch status of both pods
export async function GET() {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const pods = await listPods()

  const ltx = pods.find((p) => p.name === POD_NAMES.ltx25) ?? null
  const minimax = pods.find((p) => p.name === POD_NAMES.minimax) ?? null

  // Normalize: REST doesn't return runtime field, so synthesize it from desiredStatus
  // If desiredStatus === 'RUNNING', pod IS running (REST only lists active pods)
  const normalize = (pod: Record<string, unknown> | null) => {
    if (!pod) return null
    return {
      ...pod,
      // REST API: RUNNING means it's actually running — set runtime so client knows it's ready
      runtime: pod.desiredStatus === 'RUNNING' ? { active: true } : null,
    }
  }

  return NextResponse.json({ ltx: normalize(ltx), minimax: normalize(minimax) })
}

// POST /api/admin/videogen — deploy a pod
export async function POST(req: NextRequest) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { model } = await req.json()
  if (!['ltx25', 'minimax'].includes(model)) {
    return NextResponse.json({ error: 'Invalid model' }, { status: 400 })
  }

  const isLtx = model === 'ltx25'
  const gpuList = isLtx ? LTX_GPUS : MINIMAX_GPUS
  const name = isLtx ? POD_NAMES.ltx25 : POD_NAMES.minimax

  const env: Record<string, string> = {
    HF_TOKEN: process.env.HF_TOKEN ?? '',
  }
  if (!isLtx) {
    env.download_minimax_h3 = 'true'
    env.minimax_quant = 'int8'
  }

  const triedGpus: string[] = []

  for (const gpu of gpuList) {
    triedGpus.push(gpu)

    const payload: Record<string, unknown> = {
      name,
      gpuTypeIds: [gpu],
      gpuCount: 1,
      containerDiskInGb: isLtx ? 100 : 80,
      volumeInGb: 50,
      volumeMountPath: '/workspace',
      env,
      cloudType: 'COMMUNITY',
    }

    if (isLtx) {
      // Official RunPod ComfyUI template — pre-installs ComfyUI, hf CLI, all nodes
      payload.templateId = 'cw3nka7d08'
    } else {
      payload.imageName = 'hearmeman/comfyui-minimax-template:v2-cuda12'
      payload.ports = ['8188/http', '8888/http', '22/tcp']
    }

    const res = await fetch(`${RUNPOD_API}/pods`, {
      method: 'POST',
      headers: restHeaders(),
      body: JSON.stringify(payload),
    })
    const data = await res.json()

    if (data.id) {
      return NextResponse.json({
        success: true,
        pod: data,
        gpu,
        comfyuiUrl: `https://${data.id}-8188.proxy.runpod.net`,
        jupyterUrl: `https://${data.id}-8888.proxy.runpod.net`,
      })
    }
  }

  return NextResponse.json(
    { error: `No GPUs available (tried: ${triedGpus.join(', ')}). Try again in a few minutes.` },
    { status: 503 }
  )
}

