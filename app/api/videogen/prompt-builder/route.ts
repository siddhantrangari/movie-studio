import { NextRequest, NextResponse } from 'next/server'
import { isAdminAuthenticated } from '@/lib/auth'
import { logUsage, estimateOpenAiCost } from '@/lib/usage'

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
   - "movie": Deliver a 3 to 5 shot cinematic storyboard sequence with continuity tags (@image1, @image2, or @CharacterName for referenced identities), shot order, timecodes, camera moves, and individual scene prompts.
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

  const model = process.env.OPENAI_MODEL || 'gpt-5.6-luna'

  try {
    const { type, input, genre, cameraStyle, lightingStyle, durationSeconds = 10 } = await req.json()

    if (!input || typeof input !== 'string' || !input.trim()) {
      return NextResponse.json({ error: 'Prompt input is required' }, { status: 400 })
    }

    const isAutoCamera = !cameraStyle || cameraStyle.includes('Auto')
    const isAutoLighting = !lightingStyle || lightingStyle.includes('Auto')
    const isAutoGenre = !genre || genre.includes('Auto')

    let userPrompt = ''
    if (type === 'character') {
      userPrompt = `Analyze this character concept and autonomously design a complete photorealistic Character Style Sheet & Turnaround Prompt:
"${input.trim()}"

Genre/Theme: ${isAutoGenre ? 'Autonomously determine the most compelling cinematic genre for this character' : genre}
Lighting Preference: ${isAutoLighting ? 'Autonomously design the optimal lighting physics' : lightingStyle}

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
      userPrompt = `Analyze this story concept and autonomously design a 3 to 5 shot Cinematic Movie Storyboard Sequence:
"${input.trim()}"

Genre: ${isAutoGenre ? 'Autonomously choose the most fitting cinematic tone' : genre}
Camera Preference: ${isAutoCamera ? 'Autonomously choose dynamic camera setups per shot' : cameraStyle}
Lighting Preference: ${isAutoLighting ? 'Autonomously design lighting physics per shot' : lightingStyle}

CRITICAL CHARACTER REFERENCE TAGGING RULE:
- For the primary main character / performer, ALWAYS use the exact tag "@image1" in every shot's prompt to bind to the user's attached reference photo.
- If there is a secondary character, use "@image2".
- NEVER invent arbitrary role tags like "@Girl", "@Boy", "@Woman", "@Man", or "@hero" — always use "@image1" for the referenced character.

Respond ONLY with valid JSON in this exact structure:
{
  "title": "Movie Title",
  "logline": "1 sentence punchy logline",
  "shots": [
    {
      "order": 1,
      "title": "Shot Name",
      "seconds": 6,
      "camera": "Camera movement description (e.g. 35mm Prime, Slow Push In)",
      "lighting": "Lighting setup description",
      "prompt": "Full photorealistic shot prompt using @image1 for the referenced character, following physical optics, lighting, texture, and motion rules"
    }
  ]
}`
    } else {
      // Default: single scene / shot prompt (with duration & multi-beat dynamic camera choreography)
      userPrompt = `Analyze this scene concept and autonomously engineer an ultra-photorealistic, director-grade LTX 2.5 video prompt designed for a ${durationSeconds}-second shot:
"${input.trim()}"

Target Shot Duration: ${durationSeconds} seconds
Genre Strategy: ${isAutoGenre ? 'Autonomously determine the ideal cinematic genre & visual tone' : genre}
Lens & Camera Strategy: ${isAutoCamera ? `Autonomously select the optimal camera rig, prime lens (e.g. 35mm / 65mm / 85mm), aperture, and choreograph a smooth ${durationSeconds}-second camera move progression (e.g., establishing move -> push-in to focus on tension/emotion -> subtle reveal)` : cameraStyle}
Lighting Physics: ${isAutoLighting ? 'Autonomously engineer the optimal lighting physics, Kelvin temperature, bounce light, and volumetric shadows' : lightingStyle}

PROMPT FORMATTING REQUIREMENTS:
- Write a rich, seamless cinematic prose prompt (120-180 words) that flows continuously across the ${durationSeconds} seconds.
- Explicitly integrate the physical camera movement progression, lens optical characteristics (Arri Alexa 65 / Panavision Anamorphic T1.4), lighting temperature, epidermal micro-textures, and frame-one kinetic action.
- Do NOT include markdown bold asterisks or "Avoid" negative tags in the prompt text.

Respond ONLY with valid JSON in this exact structure:
{
  "title": "Short descriptive scene title",
  "prompt": "The complete, highly detailed photorealistic prompt text ready to be sent directly to LTX 2.5",
  "cameraMotion": "Recommended camera motion preset key (e.g. dolly_in, dolly_out, zoom_in, orbit_left, crane, static)",
  "lighting": "Recommended lighting preset key (e.g. Golden Hour, Natural Daylight, Moody Noir, Neon Cyber, Studio Softbox)",
  "colorPalette": "Recommended color grade (e.g. Luxury Warm, Teal Orange, Noir, Natural, Pastel)"
}`
    }

    const requestPayload: Record<string, unknown> = {
      model,
      messages: [
        { role: 'system', content: PHOTOREALISM_SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
    }

    // Only add response_format if model is not o1-preview or similar restricted variants
    if (!model.startsWith('o1-mini') && !model.startsWith('o1-preview')) {
      requestPayload.response_format = { type: 'json_object' }
    }

    const openaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(requestPayload),
    })

    if (!openaiRes.ok) {
      const errText = await openaiRes.text()
      let errMsg = `OpenAI API Error (${openaiRes.status})`
      try {
        const j = JSON.parse(errText)
        if (j.error?.message) errMsg += `: ${j.error.message}`
      } catch {
        errMsg += `: ${errText.slice(0, 300)}`
      }
      return NextResponse.json({ error: errMsg }, { status: openaiRes.status })
    }

    const data = await openaiRes.json()
    let content = data.choices?.[0]?.message?.content
    if (!content) {
      return NextResponse.json({ error: 'No response generated from AI' }, { status: 500 })
    }

    // Strip markdown code blocks if the model returned ```json ... ```
    content = content.replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/```\s*$/, '').trim()
    const parsed = JSON.parse(content)

    // Track and log OpenAI token consumption and estimated costs
    const promptTokens = data.usage?.prompt_tokens ?? 0
    const completionTokens = data.usage?.completion_tokens ?? 0
    const totalTokens = data.usage?.total_tokens ?? (promptTokens + completionTokens)
    const costUsd = estimateOpenAiCost(model, promptTokens, completionTokens)

    const title = parsed.title || parsed.name || (typeof parsed.logline === 'string' ? parsed.logline.slice(0, 40) : 'Prompt Generation')

    logUsage({
      category: 'openai_prompt',
      type: type || 'scene',
      model,
      promptTokens,
      completionTokens,
      totalTokens,
      costUsd,
      details: `${type?.toUpperCase() || 'SCENE'}: "${title}" (${input.trim().slice(0, 60)}...)`,
    })

    return NextResponse.json({
      success: true,
      type: type || 'scene',
      result: parsed,
      usage: {
        model,
        promptTokens,
        completionTokens,
        totalTokens,
        costUsd,
      },
    })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
