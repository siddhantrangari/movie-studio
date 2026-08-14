import { NextRequest, NextResponse } from 'next/server'
import { isAdminAuthenticated } from '@/lib/auth'

const RUNPOD_API = 'https://rest.runpod.io/v1'
const RUNPOD_GQL = 'https://api.runpod.io/graphql'
const POD_NAMES = { ltx25: 'ltx25-videogen', minimax: 'minimax-h3-videogen' }

function gqlHeaders() {
  return {
    Authorization: `Bearer ${process.env.RUNPOD_API_KEY}`,
    'Content-Type': 'application/json',
  }
}

function restHeaders() {
  return { Authorization: `Bearer ${process.env.RUNPOD_API_KEY}` }
}

async function findPodId(model: string): Promise<string | null> {
  const name = model === 'ltx25' ? POD_NAMES.ltx25 : POD_NAMES.minimax
  const res = await fetch(RUNPOD_GQL, {
    method: 'POST',
    headers: gqlHeaders(),
    body: JSON.stringify({ query: '{ myself { pods { id name } } }' }),
    cache: 'no-store',
  })
  const json = await res.json()
  const pods: { id: string; name: string }[] = json?.data?.myself?.pods ?? []
  const pod = pods.find((p) => p.name === name)
  return pod?.id ?? null
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ action: string }> }
) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { action } = await params
  const { model } = await req.json()

  if (!['ltx25', 'minimax'].includes(model)) {
    return NextResponse.json({ error: 'Invalid model' }, { status: 400 })
  }

  const podId = await findPodId(model)
  if (!podId) {
    return NextResponse.json({ error: 'Pod not found' }, { status: 404 })
  }

  let result: unknown

  switch (action) {
    case 'stop': {
      // GraphQL mutation to stop pod
      const res = await fetch(RUNPOD_GQL, {
        method: 'POST',
        headers: gqlHeaders(),
        body: JSON.stringify({
          query: `mutation { podStop(input: { podId: "${podId}" }) { id desiredStatus } }`,
        }),
      })
      const json = await res.json()
      result = json?.data?.podStop ?? json
      break
    }
    case 'start': {
      // GraphQL mutation to resume pod
      const res = await fetch(RUNPOD_GQL, {
        method: 'POST',
        headers: gqlHeaders(),
        body: JSON.stringify({
          query: `mutation { podResume(input: { podId: "${podId}", gpuCount: 1 }) { id desiredStatus } }`,
        }),
      })
      const json = await res.json()
      result = json?.data?.podResume ?? json
      break
    }
    case 'terminate': {
      // REST DELETE to terminate pod
      const res = await fetch(`${RUNPOD_API}/pods/${podId}`, {
        method: 'DELETE',
        headers: restHeaders(),
      })
      result = await res.json().catch(() => ({ deleted: true }))
      break
    }
    default:
      return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  }

  return NextResponse.json({ success: true, result })
}
