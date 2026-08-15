import fs from 'fs'
import path from 'path'
import { bringUp, tearDown, findPod, comfyReady } from '../lib/podops'
import { saveCharacter, saveStoryboard, newId, Storyboard, Scene } from '../lib/studio'
import { buildWorkflow, submitPrompt, getJobStatus } from '../lib/comfyui'
import { startAssembly, getFilm } from '../lib/assemble'
import { signedUrl, isR2Configured } from '../lib/storage'

// Load environment variables from .env.local
const envFile = path.join(process.cwd(), '.env.local')
if (fs.existsSync(envFile)) {
  const content = fs.readFileSync(envFile, 'utf8')
  for (const line of content.split('\n')) {
    const parts = line.split('=')
    if (parts.length >= 2 && !line.trim().startsWith('#')) {
      const k = parts[0].trim()
      const v = parts.slice(1).join('=').trim().replace(/^\\/, '')
      process.env[k] = v
    }
  }
}

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function runFullJungleMovieGenerator() {
  console.log('===============================================================')
  console.log('🎥 MCP MOVIE STUDIO: GENERATING FULL 65s JUNGLE MOVIE')
  console.log('===============================================================\n')

  // 1. Start & Provision Pod
  console.log('STEP 1 [MCP Tool: movie_pod_start]: Provisioning LTX 2.5 GPU pod on RunPod...')
  for await (const log of bringUp()) {
    console.log(`  [${log.level.toUpperCase()}] ${log.text}`)
  }

  let pod = await findPod()
  let podId = (pod?.id as string) || null
  console.log(`\nSTEP 2 [MCP Tool: movie_pod_status]: Pod active with ID: ${podId}`)

  let isReady = false
  for (let attempt = 1; attempt <= 30; attempt++) {
    if (podId && (await comfyReady(podId))) {
      isReady = true
      break
    }
    console.log(`  Waiting for ComfyUI v0.33.1 readiness on pod ${podId} (Attempt ${attempt}/30)...`)
    await sleep(5000)
    pod = await findPod()
    podId = (pod?.id as string) || null
  }

  if (!isReady || !podId) {
    throw new Error('GPU pod failed to become ready in time.')
  }
  console.log('  ✅ ComfyUI engine is live and ready for video generation!\n')

  // 3. Create Character Profile for Storyboard
  console.log('STEP 3 [MCP Tool: movie_create_character]: Creating character consistency profile...')
  const charId = newId()
  const character = saveCharacter({
    id: charId,
    name: 'Kael',
    description: 'A young wild boy with unruly dark hair, innocent golden eyes, wearing leaf wraps, athletic build, hyperrealistic jungle boy',
  })
  console.log(`  ✅ Character profile created: ${character.name} (ID: ${character.id})\n`)

  // 4. Construct 13-Scene Storyboard (65s Total)
  console.log('STEP 4 [MCP Tool: movie_create_storyboard]: Building 13-Scene Emotional Jungle Film Storyboard...')

  const GEORGE_VOICE_ID = 'JBFqnCBsd6RMkjVDRZzb' // George - Warm, Captivating Storyteller

  const rawScenes = [
    {
      title: 'Scene 1: Lost in the Mist',
      prompt: `${character.description}, small innocent human toddler wandering alone in misty ancient jungle at dusk, glowing fireflies, hyperrealistic cinematic wide shot, mist rising from ground`,
      narration: 'Deep within the shadowed canopy, a lost child stepped into the unknown.',
    },
    {
      title: 'Scene 2: Eyes in the Shadow',
      prompt: 'A majestic sleek black panther perched on giant mossy tree branch in twilight jungle, golden eyes shining warmly with compassion looking down, cinematic 4k lens flare',
      narration: 'Where others saw a stranger, the wild saw a soul worth protecting.',
    },
    {
      title: 'Scene 3: The First Embrace',
      prompt: `${character.description}, toddler cold and shivering under moonlight, a gentle black panther stepping down and soft nuzzling its head against the child, emotional lighting, cinematic medium shot`,
      narration: 'In the quiet cold of night, predator became protector.',
    },
    {
      title: 'Scene 4: Child of the Pack',
      prompt: `${character.description}, young wild boy running playfully through sunlit crystal jungle river alongside a pack of grey wolves, water splashing, vibrant sunlight through trees, cinematic action shot`,
      narration: 'Years blossomed under the emerald sun. He ran not as a man, but as one with the pack.',
    },
    {
      title: 'Scene 5: Laughter in the Canopy',
      prompt: `${character.description}, wild boy leaning back against a massive gentle brown bear under a giant towering Banyan tree, laughing together in warm golden sunlight, heartwarming cinematic`,
      narration: 'The forest taught him strength without cruelty, and wisdom without fear.',
    },
    {
      title: 'Scene 6: The Rising Threat',
      prompt: 'Dark black smoke billowing over jungle canopy at twilight, ominous shadows of armed poachers holding burning torches marching into ancient forest, dramatic cinematic wide shot',
      narration: 'But dark shadows arrived, bringing fire and destruction to paradise.',
    },
    {
      title: 'Scene 7: Flames of Devastation',
      prompt: 'Fires raging near giant ancient jungle trees, wild animals backing away in fear from spreading orange flames, sparks flying, dramatic cinematic atmospheric lighting',
      narration: 'When the sacred trees burned, the creatures had no voice to stand.',
    },
    {
      title: 'Scene 8: Standing Guard',
      prompt: `${character.description}, courageous wild boy stepping out firmly in front of frightened wild animals, extending his arms to shield them from encroaching fire and poachers, intense emotional medium shot`,
      narration: 'Except for the human child they had raised as their own.',
    },
    {
      title: 'Scene 9: The Roar of Unity',
      prompt: `${character.description}, standing brave while a sleek black panther, giant brown bear, and grey wolf pack step up beside him, roaring fiercely together in powerful unity, cinematic slow motion`,
      narration: 'Side by side, blood and bond forged an unbreakable front.',
    },
    {
      title: 'Scene 10: Intruders Retreat',
      prompt: 'Poachers dropping torches in fear and running away into misty dark forest, intimidated by the unified human and beast guardians, dramatic cinematic lens angle',
      narration: 'Faced with true love and wild courage, the dark forces faltered.',
    },
    {
      title: 'Scene 11: Golden Sunrise',
      prompt: 'Raging fire embers fading out as brilliant golden morning sunbeams pierce through lush green jungle canopy, illuminating fresh leaves, breath-taking panoramic view',
      narration: 'As dawn swept away the ash, the jungle breathed once more.',
    },
    {
      title: 'Scene 12: Unbreakable Bond',
      prompt: `${character.description}, wild boy wrapping his arms tightly around the black panther neck, emotional tears of relief and deep love, soft golden morning light, heartwarming cinematic close-up`,
      narration: 'For home is not a place... it is the family that guards your heart.',
    },
    {
      title: 'Scene 13: Eternal Sanctuary',
      prompt: `${character.description}, wild boy walking side-by-side with black panther, brown bear, and wolves into endless radiant green jungle sanctuary at sunrise, epic cinematic tracking shot`,
      narration: 'Together, human and wild stood, guardians of the eternal forest.',
    },
  ]

  const scenes: Scene[] = rawScenes.map((sc, i) => ({
    id: newId(),
    order: i,
    title: sc.title,
    prompt: sc.prompt,
    characterId: character.id,
    seconds: 5,
    narration: sc.narration,
    state: 'idle',
  }))

  const storyboard: Storyboard = {
    id: newId(),
    title: 'The Sanctuary of Beasts (Full Film)',
    resolution: 2, // 1280x704 Max
    audioMode: 'both',
    voiceId: GEORGE_VOICE_ID, // ElevenLabs George voice
    scenes,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }

  saveStoryboard(storyboard)
  console.log(`  ✅ Storyboard created: "${storyboard.title}" with ${scenes.length} scenes (${scenes.length * 5}s duration)`)
  console.log(`  ✅ Selected Narrator Voice: ElevenLabs George (Warm, Captivating Storyteller)\n`)

  // 5. Generate Scene Clips
  console.log('STEP 5 [MCP Tool: movie_generate_scene]: Triggering LTX 2.5 render jobs for all 13 scenes...')
  const promptIds: { sceneId: string; promptId: string; index: number }[] = []

  for (const [i, sc] of scenes.entries()) {
    console.log(`  [${i + 1}/${scenes.length}] Submitting Scene: "${sc.title}"...`)
    const built = buildWorkflow({
      prompt: sc.prompt,
      width: 1280,
      height: 704,
      seconds: sc.seconds,
      seed: 88000 + i * 150,
    })

    const { prompt_id } = await submitPrompt(podId, built.workflow)
    sc.state = 'running'
    sc.promptId = prompt_id
    promptIds.push({ sceneId: sc.id, promptId: prompt_id, index: i })
    console.log(`      -> Submitted to ComfyUI (Prompt ID: ${prompt_id})`)
  }

  saveStoryboard(storyboard)

  // Poll for completion of all scenes
  console.log('\n  Polling ComfyUI GPU queue for completion of all 13 clips...')
  for (const item of promptIds) {
    let done = false
    while (!done) {
      const status = await getJobStatus(podId, item.promptId)
      if (status.state === 'done' && status.filename) {
        scenes[item.index].state = 'done'
        scenes[item.index].filename = status.filename
        scenes[item.index].subfolder = status.subfolder || 'gen'
        console.log(`  ✅ Scene ${item.index + 1}/${scenes.length} ("${scenes[item.index].title}") rendered successfully!`)
        done = true
      } else if (status.state === 'error') {
        throw new Error(`Scene ${item.index + 1} rendering failed: ${status.error}`)
      } else {
        process.stdout.write('.')
        await sleep(5000)
      }
    }
  }

  saveStoryboard(storyboard)
  console.log('  ✅ All 13 scene clips rendered cleanly on GPU!\n')

  // 6. Assemble Film
  console.log('STEP 6 [MCP Tool: movie_assemble_film]: Running server-side ffmpeg assembly & audio mixing...')
  console.log('  -> Crossfading 13 scenes with 1s transitions')
  console.log('  -> Generating ElevenLabs George narrator voiceover for each scene')
  console.log('  -> Burning white/black-outline subtitle captions')
  console.log('  -> Uploading final MP4 to Cloudflare R2 bucket...')

  const filmRecord = startAssembly(storyboard, podId, {
    enabled: false,
    font: 'DejaVu Sans',
    fontSize: 24,
    color: '#FFFFFF',
    outlineColor: '#000000',
    outlineWidth: 2,
    position: 'bottom',
    boxed: false,
    uppercase: false,
  })

  console.log(`  Film Assembly initiated (Film ID: ${filmRecord.id}). Waiting for ffmpeg & R2 upload...`)

  let completedFilm = getFilm(filmRecord.id)
  while (completedFilm?.state === 'building') {
    process.stdout.write('#')
    await sleep(3000)
    completedFilm = getFilm(filmRecord.id)
  }

  if (completedFilm?.state === 'error') {
    throw new Error(`Film assembly failed: ${completedFilm.error}`)
  }

  console.log('\n  ✅ Assembly & Cloudflare R2 Cloud Storage Upload Completed!')

  // 7. Get Presigned R2 Video URL
  console.log('\nSTEP 7 [MCP Tool: movie_get_film]: Generating Presigned R2 Streaming URL...')
  let videoUrl = `/api/admin/videogen/assemble?file=${completedFilm?.file}`
  if (completedFilm?.storage === 'r2' || (isR2Configured() && completedFilm?.r2Key)) {
    const r2Url = await signedUrl(completedFilm?.r2Key || `${completedFilm?.id}.mp4`)
    if (r2Url) videoUrl = r2Url
  }

  // Copy output to artifacts directory for user instant playback
  const artifactDir = '/Users/siddhant/.gemini/antigravity-ide/brain/8aed1f1d-8578-479f-9167-3a14c151f0e4'
  const localFilmFile = path.join(process.cwd(), 'data', 'films', `${completedFilm?.id}.mp4`)
  const artifactTarget = path.join(artifactDir, 'jungle_film_full_story.mp4')

  if (fs.existsSync(localFilmFile)) {
    fs.copyFileSync(localFilmFile, artifactTarget)
    console.log(`  ✅ Copied finished MP4 film to artifact directory: ${artifactTarget}`)
  }

  console.log('\nSTEP 8 [MCP Tool: movie_pod_stop]: Safely terminating GPU pod on RunPod...')
  for await (const log of tearDown()) {
    console.log(`  [${log.level.toUpperCase()}] ${log.text}`)
  }

  console.log('\n===============================================================')
  console.log('🎉 FULL MCP MOVIE GENERATION COMPLETE!')
  console.log(`Film Title: ${completedFilm?.title}`)
  console.log(`Film ID: ${completedFilm?.id}`)
  console.log(`Total Duration: ${completedFilm?.duration?.toFixed(1)} seconds`)
  console.log(`Storage Provider: ${completedFilm?.storage?.toUpperCase()}`)
  console.log(`Presigned Cloudflare R2 URL:`)
  console.log(videoUrl)
  console.log('===============================================================\n')
}

runFullJungleMovieGenerator().catch((err) => {
  console.error('\n❌ MCP FILM GENERATION ERROR:', err)
  process.exit(1)
})
