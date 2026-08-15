import { NextRequest, NextResponse } from 'next/server'
import { isAdminAuthenticated } from '@/lib/auth'
import {
  getCharacters, saveCharacter, deleteCharacter,
  storeCharacterImage, readCharacterImage,
  storeCharacterAudio, readCharacterAudio, newId,
} from '@/lib/studio'
import path from 'path'

export const maxDuration = 60

export async function GET(req: NextRequest) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // ?image=<file> streams a stored reference/turnaround image
  const image = req.nextUrl.searchParams.get('image')
  if (image) {
    const buf = readCharacterImage(image)
    if (!buf) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    const ext = path.extname(image).toLowerCase()
    const type = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : ext === '.webp' ? 'image/webp' : 'image/png'
    return new NextResponse(new Uint8Array(buf), {
      headers: { 'Content-Type': type, 'Cache-Control': 'private, max-age=3600' },
    })
  }

  // ?audio=<file> streams a stored character voice audio sample
  const audio = req.nextUrl.searchParams.get('audio')
  if (audio) {
    const buf = readCharacterAudio(audio)
    if (!buf) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    const ext = path.extname(audio).toLowerCase()
    const type = ext === '.wav' ? 'audio/wav' : ext === '.ogg' ? 'audio/ogg' : 'audio/mpeg'
    return new NextResponse(new Uint8Array(buf), {
      headers: { 'Content-Type': type, 'Cache-Control': 'private, max-age=3600' },
    })
  }

  return NextResponse.json({ characters: getCharacters() })
}

export async function POST(req: NextRequest) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const form = await req.formData()
  const name = String(form.get('name') ?? '').trim()
  const description = String(form.get('description') ?? '').trim()
  const styleSheetNotes = String(form.get('styleSheetNotes') ?? '').trim()
  const voiceId = String(form.get('voiceId') ?? '').trim()
  const id = String(form.get('id') ?? '') || newId()
  const file = form.get('image')
  const voiceFile = form.get('voiceSample')

  if (!name) return NextResponse.json({ error: 'Name is required' }, { status: 400 })

  let imageFile: string | undefined
  if (file && typeof file === 'object' && 'arrayBuffer' in file) {
    const f = file as File
    if (f.size > 12 * 1024 * 1024) {
      return NextResponse.json({ error: 'Image must be under 12MB' }, { status: 400 })
    }
    if (f.size > 0) {
      const buf = Buffer.from(await f.arrayBuffer())
      imageFile = storeCharacterImage(id, buf, path.extname(f.name) || '.png')
    }
  }

  // Handle multiple turnaround images (front, side, back view)
  const turnaroundImages: string[] = []
  const turnaroundFiles = form.getAll('turnaroundImages')
  for (let i = 0; i < turnaroundFiles.length; i++) {
    const tf = turnaroundFiles[i]
    if (tf && typeof tf === 'object' && 'arrayBuffer' in tf) {
      const f = tf as File
      if (f.size > 0 && f.size <= 12 * 1024 * 1024) {
        const buf = Buffer.from(await f.arrayBuffer())
        const savedName = storeCharacterImage(id, buf, path.extname(f.name) || '.png', `turnaround_${i + 1}`)
        turnaroundImages.push(savedName)
      }
    }
  }

  let voiceSampleFile: string | undefined
  if (voiceFile && typeof voiceFile === 'object' && 'arrayBuffer' in voiceFile) {
    const vf = voiceFile as File
    if (vf.size > 0 && vf.size <= 25 * 1024 * 1024) {
      const buf = Buffer.from(await vf.arrayBuffer())
      voiceSampleFile = storeCharacterAudio(id, buf, path.extname(vf.name) || '.mp3')
    }
  }

  const saved = saveCharacter({
    id,
    name,
    description,
    imageFile,
    turnaroundImages: turnaroundImages.length > 0 ? turnaroundImages : undefined,
    styleSheetNotes,
    voiceId,
    voiceSampleFile,
  })
  return NextResponse.json({ success: true, character: saved })
}

export async function DELETE(req: NextRequest) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  deleteCharacter(id)
  return NextResponse.json({ success: true })
}
