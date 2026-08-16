import { NextRequest, NextResponse } from 'next/server'
import { isAdminAuthenticated } from '@/lib/auth'
import { getJobStatus } from '@/lib/comfyui'
import { getRunningPodId } from '@/lib/runpod'
import { updateGenerationJob } from '@/lib/studio'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const ids = (req.nextUrl.searchParams.get('ids') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

  if (ids.length === 0) return NextResponse.json({ jobs: {} })

  const podId = await getRunningPodId('ltx25')
  if (!podId) {
    return NextResponse.json({ error: 'Pod not running', jobs: {} }, { status: 409 })
  }

  const entries = await Promise.all(
    ids.map(async (id) => {
      const st = await getJobStatus(podId, id)
      if (st) {
        updateGenerationJob(id, {
          state: st.state as 'queued' | 'running' | 'done' | 'error',
          filename: st.filename,
          subfolder: st.subfolder,
          error: st.error,
        })
      }
      return [id, st] as const
    })
  )

  return NextResponse.json({ podId, jobs: Object.fromEntries(entries) })
}
