import { NextRequest, NextResponse } from 'next/server'
import { isAdminAuthenticated } from '@/lib/auth'

export const maxDuration = 60

const PHOTOREALISM_SYSTEM_PROMPT = `You are an elite cinematic AI director and master prompt engineer specializing in LTX 2.5 and Seedance diffusion video models.
Your objective is to turn user concepts into ultra-photorealistic, director-grade cinematic video prompts that look indistinguishable from real 35mm/65mm film.

CRITICAL PROMPT ENGINEERING RULES:
1. NEVER use generic AI buzzwords like "ultra realistic", "photorealistic", "hyperrealistic", "4K UHD", "8K", "Octane render", "Unreal engine", "cinematic lighting". These degrade output quality by biasing toward 3D video game assets.
2. Ground every visual in PHYSICAL OPTICS & CINEMATOGRAPHY:
   - Camera & Optics: Specify physical camera gear (e.g., "Shot on 35mm Arri Alexa 65, Panavision Anamorphic prime lens, T1.4 aperture, authentic 180° shutter motion blur, subtle Kodak Vision3 500T 35mm film grain").
   - Lighting Physics: Specify light sources, Kelvin temperature, and falloff (e.g., "Natural 5600K diffuse window light from high camera-left, subtle contre-jour backlight, volumetric dust haze, deep organic shadow falloff").
   - Micro-texture & Surface: Specify physical tactile details (e.g., "Natural epidermal skin pores, fine vellus hair, distinct eye moisture with sharp catchlights, authentic fabric weave texture with subtle folds").
   - Motion Dynamics: Ensure continuous natural physical motion from frame one (e.g., "subtle rhythmic chest rise from breathing, micro eye dart, gentle breeze fluttering fine strands of hair").
3. Always tailor output to the requested type:
   - "scene": Deliver an ultra-rich single shot prompt (~100-160 words) + suggested camera move + suggested lighting + short title.
   - "character": Deliver a consistent character style sheet (character description, signature wardrobe textures, lighting profile, and exact image prompt for generating reference turnaround).
   - "movie": Deliver a 3 to 5 shot cinematic storyboard sequence with continuity tags (@hero, @location), shot order, timecodes, camera moves, and individual scene prompts.
`

export async function POST(req: NextRequest) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    return NextResponse.json(
      {
        error:
          'OpenAI API key not configured on server. Add OPENAI_API_KEY to .env.production on the VPS.',
      },
      { status: 400 }
    )
  }

  const model = process.env.OPENAI_MODEL || 'gpt-4o'

  try {
    const { type, input, genre, cameraStyle, lightingStyle } = await req.json()

    if (!input || typeof input !== 'string' || !input.trim()) {
      return NextResponse.json({ error: 'Prompt input is required' }, { status: 400 })
    }

    let userPrompt = ''
    if (type === 'character') {
      userPrompt = `Generate a complete photorealistic Character Style Sheet & Turnaround Prompt based on this character idea:
"${input.trim()}"

Genre/Theme: ${genre || 'Cinematic Drama'}
Lighting Preference: ${lightingStyle || 'Natural 5600K Daylight'}

Respond ONLY with valid JSON in this exact structure:
{
  "name": "Character Name",
  "tag": "@character_tag",
  "description": "2-3 sentences concise description of facial features, age, ethnicity, expression, and distinct characteristics",
  "wardrobe": "Detailed description of physical clothing, materials, weave textures, and color tones",
  "turnaroundPrompt": "Full photorealistic generation prompt for creating a master reference turnaround portrait of this character with neutral lighting, natural skin texture, and sharp eyes",
  "voiceRecommendation": "Recommended voice style/tone for ElevenLabs (e.g. 'Deep Raspy Male, Calm Baritone, 35yo')"
}`
    } else if (type === 'movie') {
      userPrompt = `Generate a 3 to 5 shot Cinematic Movie Storyboard Sequence based on this logline/story:
"${input.trim()}"

Genre: ${genre || 'Cinematic Drama'}
Camera Preference: ${cameraStyle || 'Dynamic Cinematic'}
Lighting Preference: ${lightingStyle || 'Natural Daylight'}

Respond ONLY with valid JSON in this exact structure:
{
  "title": "Movie Title",
  "logline": "1 sentence punchy logline",
  "shots": [
    {
      "order": 1,
      "title": "Shot Name",
      "seconds": 5,
      "camera": "Camera movement description (e.g. Slow Push In)",
      "lighting": "Lighting setup description",
      "prompt": "Full LTX 2.5 photorealistic shot prompt following the optics, lighting, texture, and motion rules"
    }
  ]
}`
    } else {
      // Default: single scene / shot prompt
      userPrompt = `Generate an ultra-photorealistic, director-grade LTX 2.5 video prompt for this scene concept:
"${input.trim()}"

Genre: ${genre || 'Cinematic'}
Camera Style: ${cameraStyle || 'Dynamic Master'}
Lighting Style: ${lightingStyle || 'Natural Organic'}

Respond ONLY with valid JSON in this exact structure:
{
  "title": "Short descriptive scene title",
  "prompt": "The complete, highly detailed photorealistic prompt text ready to be sent directly to LTX 2.5 (including physical camera optics, natural lighting physics, skin/material textures, and kinetic motion from frame one)",
  "cameraMotion": "Recommended camera motion preset key (e.g. dolly_in, dolly_out, zoom_in, orbit_left, crane, static)",
  "lighting": "Recommended lighting preset key (e.g. Golden Hour, Natural Daylight, Moody Noir, Neon Cyber, Studio Softbox)",
  "colorPalette": "Recommended color grade (e.g. Luxury Warm, Teal Orange, Noir, Natural, Pastel)"
}`
    }

    const openaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: PHOTOREALISM_SYSTEM_PROMPT },
          { role: 'user', content: userPrompt },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.7,
      }),
    })

    if (!openaiRes.ok) {
      const errText = await openaiRes.text()
      return NextResponse.json(
        { error: `OpenAI API Error (${openaiRes.status}): ${errText}` },
        { status: openaiRes.status }
      )
    }

    const data = await openaiRes.json()
    const content = data.choices?.[0]?.message?.content
    if (!content) {
      return NextResponse.json({ error: 'No response generated from AI' }, { status: 500 })
    }

    const parsed = JSON.parse(content)
    return NextResponse.json({
      success: true,
      type: type || 'scene',
      result: parsed,
    })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
