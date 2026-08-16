import { NextRequest, NextResponse } from 'next/server'
import { isAdminAuthenticated } from '@/lib/auth'

export const maxDuration = 60

const MUSIC_VIDEO_DIRECTOR_PROMPT = `You are a world-class music video director and prompt engineer specializing in MiniMax Hailuo 3 multimodal Ref2VA (Reference-to-Video-Audio) generation.

In MiniMax Ref2VA:
1. <Picture 1> is the identity reference tag for the performing singer/artist.
2. <Audio 1> is the audio reference tag for the user's vocal/song track.
3. Every prompt MUST explicitly include "<Picture 1>" and "<Audio 1>".
4. Camera distance & choreography: Close-up and medium shots provide the cleanest lip sync. Direct the camera with smooth pans, slow push-ins, tracking arcs, and crane reveals.
5. Lighting & Atmospherics: Ground visuals in cinematic lighting (e.g. volumetric neon stage beams, atmospheric smoke haze, anamorphic lens flares, rim light highlighting hair).
6. Performance Motion: Describe natural singing dynamics (e.g. passionate vocal delivery, micro-expressions, emotive head tilts, rhythmic hand gestures, singing directly into camera).
7. NEVER use generic buzzwords like "photorealistic", "4K", "hyperrealistic". Use physical optical terminology (e.g. 50mm prime, T1.4 aperture, authentic 35mm film motion blur).
`

export async function POST(req: NextRequest) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    return NextResponse.json(
      { error: 'OpenAI API key not configured on server.' },
      { status: 400 }
    )
  }

  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini'

  try {
    const {
      action = 'storyboard', // 'storyboard' | 'regenerate_scene'
      songTitle = 'Untitled Track',
      genre = 'Pop',
      mood = 'Energetic',
      lyricsTheme = 'High energy performance',
      stylePreset = 'Cyberpunk Neon Concert',
      performerDesc = 'Charismatic singer',
      songDuration = 45,
      segmentDuration = 15,
      // For regenerate_scene:
      sceneIndex = 0,
      currentPrompt = '',
      revisionNotes = '',
    } = await req.json()

    if (action === 'regenerate_scene') {
      const userPrompt = `You are directing Scene #${sceneIndex + 1} of a music video for "${songTitle}" (${genre}, ${mood}).
Performer Identity: <Picture 1> (${performerDesc})
Song Audio Track: <Audio 1>
Style Aesthetic: ${stylePreset}
Lyrics / Scene Beat: ${lyricsTheme}

Current Scene Prompt to Replace:
"${currentPrompt}"

Director Revision Notes / User Feedback:
"${revisionNotes || 'Provide a fresh, dynamic alternative camera choreography and stage setting while keeping perfect lip-sync to <Audio 1> and character identity <Picture 1>.'}"

Respond ONLY with valid JSON in this exact structure:
{
  "title": "Scene #${sceneIndex + 1}: Descriptive Name",
  "camera": "Specific camera movement description (e.g., Dynamic Arc Shot with Slow Push-In)",
  "lighting": "Lighting & atmosphere setup description",
  "prompt": "Full MiniMax Ref2VA prompt containing <Picture 1> and <Audio 1>"
}`

      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: MUSIC_VIDEO_DIRECTOR_PROMPT },
            { role: 'user', content: userPrompt },
          ],
          response_format: { type: 'json_object' },
        }),
      })

      if (!res.ok) {
        const errText = await res.text()
        return NextResponse.json({ error: `AI generation failed: ${errText}` }, { status: res.status })
      }

      const data = await res.json()
      const parsed = JSON.parse(data.choices?.[0]?.message?.content || '{}')
      return NextResponse.json({ scene: parsed })
    }

    // Storyboard mode: calculate scenes
    const totalScenes = Math.max(1, Math.min(8, Math.ceil(songDuration / segmentDuration)))
    const sceneRanges: { start: number; end: number; duration: number; label: string }[] = []
    
    for (let i = 0; i < totalScenes; i++) {
      const start = i * segmentDuration
      const end = Math.min(songDuration, (i + 1) * segmentDuration)
      const duration = end - start
      let label = 'Performance Verse'
      if (i === 0) label = 'Opening Intro / Verse 1'
      else if (i === totalScenes - 1) label = 'Climactic Finale / Outro'
      else if (i % 2 === 1) label = 'High-Energy Chorus'
      else label = 'Emotional Bridge / Verse 2'

      sceneRanges.push({ start, end, duration, label })
    }

    const userPrompt = `Design a complete ${totalScenes}-shot cinematic Music Video Storyboard for the song "${songTitle}".
Genre: ${genre}
Mood / Vibe: ${mood}
Lyric Concept: ${lyricsTheme}
Visual Style: ${stylePreset}
Performer Description: ${performerDesc}
Total Song Length: ${songDuration}s

Scene Breakdown Schedule:
${sceneRanges.map((s, idx) => `Part ${idx + 1}: ${s.start.toFixed(1)}s to ${s.end.toFixed(1)}s (${s.duration.toFixed(1)}s) — Role: ${s.label}`).join('\n')}

MANDATORY RULES:
1. Every shot's "prompt" field MUST include "<Picture 1>" (the singer) and "<Audio 1>" (the song vocal track).
2. Prioritize close-ups, medium close-ups, and smooth camera dollies/arcs to maximize facial lip-sync clarity.
3. Keep visual lighting and wardrobe consistent across shots to ensure the music video feels cohesive.

Respond ONLY with valid JSON in this exact structure:
{
  "title": "Music Video Title",
  "logline": "1-2 sentence visual summary of the music video concept",
  "styleTheme": "${stylePreset}",
  "scenes": [
    ${sceneRanges.map((s, idx) => `{
      "order": ${idx + 1},
      "title": "${s.label}",
      "startSec": ${s.start},
      "endSec": ${s.end},
      "durationSec": ${s.duration},
      "camera": "Camera movement description",
      "lighting": "Lighting setup",
      "prompt": "Full MiniMax Ref2VA prompt containing <Picture 1> and <Audio 1>"
    }`).join(',\n    ')}
  ]
}`

    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: MUSIC_VIDEO_DIRECTOR_PROMPT },
          { role: 'user', content: userPrompt },
        ],
        response_format: { type: 'json_object' },
      }),
    })

    if (!res.ok) {
      const errText = await res.text()
      return NextResponse.json({ error: `AI storyboard generation failed: ${errText}` }, { status: res.status })
    }

    const data = await res.json()
    const parsed = JSON.parse(data.choices?.[0]?.message?.content || '{}')
    return NextResponse.json(parsed)
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 })
  }
}
