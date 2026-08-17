import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import { Readable } from 'stream'
import { isAdminAuthenticated } from '@/lib/auth'
import { fetchVideo } from '@/lib/comfyui'
import { getRunningPodId } from '@/lib/runpod'
import { getLocalClipPath, hasLocalClip, persistClip, signedUrl, isR2Configured } from '@/lib/storage'

export const maxDuration = 60
export const dynamic = 'force-dynamic'

function serveStream(
  filePath: string,
  req: NextRequest,
  filename: string,
  download: boolean
) {
  const stat = fs.statSync(filePath)
  const fileSize = stat.size
  const range = req.headers.get('range')

  if (range) {
    const parts = range.replace(/bytes=/, '').split('-')
    const start = parseInt(parts[0], 10)
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1
    const chunkSize = end - start + 1

    const fileStream = fs.createReadStream(filePath, { start, end })
    const webStream = Readable.toWeb(fileStream) as ReadableStream

    const headers = new Headers({
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': String(chunkSize),
      'Content-Type': 'video/mp4',
      'Cache-Control': 'public, max-age=86400',
    })
    if (download) {
      headers.set('Content-Disposition', `attachment; filename="${filename}"`)
    }
    return new NextResponse(webStream, { status: 206, headers })
  }

  const fileStream = fs.createReadStream(filePath)
  const webStream = Readable.toWeb(fileStream) as ReadableStream
  const headers = new Headers({
    'Content-Length': String(fileSize),
    'Accept-Ranges': 'bytes',
    'Content-Type': 'video/mp4',
    'Cache-Control': 'public, max-age=86400',
  })
  if (download) {
    headers.set('Content-Disposition', `attachment; filename="${filename}"`)
  }
  return new NextResponse(webStream, { status: 200, headers })
}

/**
 * Streams a generated clip back through the app.
 * Automatically caches clips to persistent local disk & Cloudflare R2
 * so clips remain permanently playable even when GPU compute nodes are turned off.
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

  // 1. Check local persistent disk cache first (instant 0ms response)
  if (hasLocalClip(filename)) {
    const localPath = getLocalClipPath(filename)
    return serveStream(localPath, req, filename, download)
  }

  // Check alternative local candidates
  const localCandidates = [
    path.join(process.cwd(), 'data', 'films', filename),
    path.join(process.cwd(), 'scratch', 'demo_assets', filename),
    path.join(process.cwd(), 'showcase', 'minimax_hl3_demo_proof.mp4'),
  ]
  for (const p of localCandidates) {
    if (fs.existsSync(p) && fs.statSync(p).size > 0) {
      return serveStream(p, req, filename, download)
    }
  }

  // 2. If GPU pod is running, fetch directly from pod, save to local disk & R2, and stream
  const podId = (await getRunningPodId('ltx25')) || (await getRunningPodId('minimax'))
  if (podId) {
    try {
      const upstream = await fetchVideo(podId, filename, subfolder)
      if (upstream.ok && upstream.body) {
        const arrayBuf = await upstream.arrayBuffer()
        const buf = Buffer.from(arrayBuf)
        if (buf.length > 0) {
          const savedPath = await persistClip(filename, buf)
          return serveStream(savedPath, req, filename, download)
        }
      }
    } catch (err) {
      console.error('[Video Proxy Error] Failed to fetch video from pod:', err)
    }
  }

  // 3. Fallback: check Cloudflare R2 if pod is offline
  if (isR2Configured()) {
    try {
      const url = await signedUrl(filename, 3600)
      if (url) {
        return NextResponse.redirect(url, { status: 307 })
      }
    } catch {
      // Continue to 404
    }
  }

  // 4. Fallback if pod is offline and clip was not found
  return NextResponse.json(
    {
      error: 'Clip not available. The GPU pod where this clip was rendered is currently stopped or offline.',
      filename,
      status: 'offline',
    },
    { status: 404 }
  )
}
