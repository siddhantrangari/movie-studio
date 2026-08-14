import { NextResponse } from 'next/server'
import { isAdminAuthenticated } from '@/lib/auth'
import { listVoices, CLONED_VOICE_ID } from '@/lib/elevenlabs'

export async function GET() {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    return NextResponse.json({ voices: await listVoices(), clonedVoiceId: CLONED_VOICE_ID })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message, voices: [] }, { status: 502 })
  }
}
