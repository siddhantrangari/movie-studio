import { NextRequest, NextResponse } from 'next/server'
import { isAdminAuthenticated } from '@/lib/auth'
import { synthesize, CLONED_VOICE_ID } from '@/lib/elevenlabs'

export const maxDuration = 120

/** Synthesizes narration and streams back MP3. Costs ElevenLabs credits. */
export async function POST(req: NextRequest) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { text, voiceId } = await req.json()
  if (!text || typeof text !== 'string' || !text.trim()) {
    return NextResponse.json({ error: 'Narration text is required' }, { status: 400 })
  }
  if (text.length > 5000) {
    return NextResponse.json({ error: 'Narration is too long (max 5000 chars)' }, { status: 400 })
  }

  try {
    const audio = await synthesize(text.trim(), voiceId || CLONED_VOICE_ID)
    return new NextResponse(audio, {
      headers: { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'no-store' },
    })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 })
  }
}
