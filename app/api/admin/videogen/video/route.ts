import { NextRequest, NextResponse } from 'next/server'
import { isAdminAuthenticated } from '@/lib/auth'
import { fetchVideo } from '@/lib/comfyui'
import { getRunningPodId } from '@/lib/runpod'

export const maxDuration = 60

/**
 * Streams a generated clip back through the app.
 * The browser can't hit the pod's /view directly — Cloudflare blocks it
 * without the right headers, and the pod URL changes every deploy.
 */
export async function GET(req: NextRequest) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const filename = req.nextUrl.searchParams.get('filename')
  const subfolder = req.nextUrl.searchParams.get('subfolder') ?? 'gen'
  const download = req.nextUrl.searchParams.get('download') === '1'

  if (!filename || filename.includes('..') || filename.includes('/')) {
    return NextResponse.json({ error: 'Invalid filename' }, { status: 400 })
  }

  const podId = await getRunningPodId('ltx25')
  if (!podId) {
    return NextResponse.json({ error: 'Pod not running' }, { status: 409 })
  }

  const upstream = await fetchVideo(podId, filename, subfolder)
  if (!upstream.ok || !upstream.body) {
    return NextResponse.json({ error: `Clip not available (${upstream.status})` }, { status: 502 })
  }

  const headers = new Headers({
    'Content-Type': 'video/mp4',
    'Cache-Control': 'private, max-age=3600',
  })
  const len = upstream.headers.get('content-length')
  if (len) headers.set('Content-Length', len)
  if (download) headers.set('Content-Disposition', `attachment; filename="${filename}"`)

  return new NextResponse(upstream.body, { status: 200, headers })
}
