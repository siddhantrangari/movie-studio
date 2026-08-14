import { NextRequest, NextResponse } from 'next/server'
import { createReadStream, statSync } from 'fs'
import { Readable } from 'stream'
import { isAdminAuthenticated } from '@/lib/auth'
import { getStoryboard } from '@/lib/studio'
import { getRunningPodId } from '@/lib/runpod'
import {
  startAssembly, getFilms, getFilm, deleteFilm, readFilmFile,
  filmsDiskUsage, DEFAULT_CAPTIONS, CAPTION_FONTS, CAPTION_POSITIONS,
  type CaptionStyle,
} from '@/lib/assemble'

export const maxDuration = 300

export async function GET(req: NextRequest) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // ?file=<id>.mp4 streams a finished film from disk.
  const file = req.nextUrl.searchParams.get('file')
  if (file) {
    const p = readFilmFile(file)
    if (!p) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const size = statSync(p).size
    const headers = new Headers({
      'Content-Type': 'video/mp4',
      'Content-Length': String(size),
      'Cache-Control': 'private, max-age=3600',
    })
    if (req.nextUrl.searchParams.get('download') === '1') {
      headers.set('Content-Disposition', `attachment; filename="${file}"`)
    }
    const stream = Readable.toWeb(createReadStream(p)) as ReadableStream
    return new NextResponse(stream, { headers })
  }

  return NextResponse.json({
    films: getFilms(),
    diskBytes: filmsDiskUsage(),
    fonts: CAPTION_FONTS,
    positions: CAPTION_POSITIONS,
    defaultCaptions: DEFAULT_CAPTIONS,
  })
}

export async function POST(req: NextRequest) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { storyboardId, captions } = await req.json()
  const sb = getStoryboard(storyboardId)
  if (!sb) return NextResponse.json({ error: 'Storyboard not found' }, { status: 404 })

  const ready = sb.scenes.filter((s) => s.state === 'done' && s.filename)
  if (ready.length === 0) {
    return NextResponse.json({ error: 'Generate at least one scene first' }, { status: 400 })
  }

  // Scenes live on the pod, so it has to be up to copy them off.
  const podId = await getRunningPodId('ltx25')
  if (!podId) {
    return NextResponse.json(
      { error: 'The pod holds the generated clips — start it before assembling.' },
      { status: 409 }
    )
  }

  const style: CaptionStyle = { ...DEFAULT_CAPTIONS, ...(captions ?? {}) }
  return NextResponse.json({ success: true, film: startAssembly(sb, podId, style) })
}

export async function DELETE(req: NextRequest) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  deleteFilm(id)
  return NextResponse.json({ success: true })
}

export async function PATCH(req: NextRequest) {
  // Lightweight status poll for a single film.
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const { id } = await req.json()
  const film = getFilm(id)
  if (!film) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ film })
}
