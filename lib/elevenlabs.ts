const API = 'https://api.elevenlabs.io/v1'

/** The user's cloned voice — the default, but every voice is selectable. */
export const CLONED_VOICE_ID = '4jUQ3OL4fPb8PS36QVVo'

export type Voice = {
  voiceId: string
  name: string
  category: string
  previewUrl?: string
}

function key() {
  const k = process.env.ELEVENLABS_API_KEY
  if (!k) throw new Error('ELEVENLABS_API_KEY is not configured')
  return k
}

export async function listVoices(): Promise<Voice[]> {
  const res = await fetch(`${API}/voices`, {
    headers: { 'xi-api-key': key() },
    cache: 'no-store',
  })
  if (!res.ok) throw new Error(`ElevenLabs voices failed (${res.status})`)

  const data = (await res.json()) as {
    voices: { voice_id: string; name: string; category?: string; preview_url?: string }[]
  }

  const voices = data.voices.map((v) => ({
    voiceId: v.voice_id,
    name: v.name,
    category: v.category ?? 'premade',
    previewUrl: v.preview_url,
  }))

  // Surface the cloned voice first — it's the usual pick.
  return voices.sort((a, b) =>
    a.voiceId === CLONED_VOICE_ID ? -1 : b.voiceId === CLONED_VOICE_ID ? 1 : 0
  )
}

export async function synthesize(text: string, voiceId: string): Promise<ArrayBuffer> {
  const res = await fetch(`${API}/text-to-speech/${voiceId}`, {
    method: 'POST',
    headers: { 'xi-api-key': key(), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text,
      model_id: 'eleven_multilingual_v2',
      // Tuned for narration: stable delivery with natural pacing rather than
      // the clipped read the defaults produce.
      voice_settings: { stability: 0.5, similarity_boost: 0.75, style: 0.0, use_speaker_boost: true },
    }),
  })

  if (!res.ok) {
    throw new Error(`Voiceover failed (${res.status}): ${(await res.text()).slice(0, 200)}`)
  }
  return res.arrayBuffer()
}
