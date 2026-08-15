import { bringUp, tearDown, findPod, comfyReady } from '../lib/podops'
import { createResetToken, saveCharacter, storeCharacterImage, saveStoryboard, newId, Storyboard, Scene } from '../lib/studio'
import { buildWorkflow, submitPrompt, getJobStatus, uploadImageToPod } from '../lib/comfyui'
import { startAssembly, getFilm } from '../lib/assemble'
import { signedUrl, isR2Configured } from '../lib/storage'
import fs from 'fs'
import path from 'path'

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function runMcpFullFilmDemo() {
  console.log('=== STARTING MCP FULL FILM GENERATION DEMO ===\n')

  // 1. Start Pod
  console.log('1. [MCP Tool: movie_pod_start] Provisioning LTX 2.5 GPU pod on RunPod...')
  for await (const log of bringUp()) {
    console.log(`   [${log.level.toUpperCase()}] ${log.text}`)
  }

  // Wait for pod to be fully ready
  let pod = await findPod()
  let podId = (pod?.id as string) || null
  console.log(`\n2. [MCP Tool: movie_pod_status] Pod initialized with ID: ${podId}`)

  let isReady = false
  for (let attempt = 1; attempt <= 30; attempt++) {
    if (podId && (await comfyReady(podId))) {
      isReady = true
      break
    }
    console.log(`   Waiting for ComfyUI v0.33.1 readiness on pod ${podId} (Attempt ${attempt}/30)...`)
    await sleep(5000)
    pod = await findPod()
    podId = (pod?.id as string) || null
  }

  if (!isReady || !podId) {
    throw new Error('Pod failed to become ready in time.')
  }
  console.log('   ✅ ComfyUI is live and ready for video generation!')

  // 3. Create Character Profile for Consistency
  console.log('\n3. [MCP Tool: movie_create_character] Creating character consistency profile...')
  const charId = newId()
  // Create a 1x1 dummy solid image buffer as character portrait
  const dummyPng = Buffer.from(
    'iVBORw0KGgoAAAANSUh0EUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64'
  )
  const imageFile = storeCharacterImage(charId, dummyPng, '.png')
  const character = saveCharacter({
    id: charId,
    name: 'Cyber Voyager Nova',
    description: 'Cybernetic explorer wearing a glowing neon blue visor and metallic silver spacesuit',
    imageFile,
  })
  console.log(`   ✅ Character created: ${character.name} (ID: ${character.id})`)

  // Upload character portrait to GPU pod
  console.log('   Uploading character reference image to pod ComfyUI...')
  const uploadedImage = await uploadImageToPod(podId, dummyPng, imageFile)
  console.log(`   ✅ Image uploaded to pod as: ${uploadedImage}`)

  // 4. Create Storyboard
  console.log('\n4. [MCP Tool: movie_create_storyboard] Creating sci-fi film storyboard...')
  const scenes: Scene[] = [
    {
      id: newId(),
      order: 0,
      title: 'Scene 1: Neon City Arrival',
      prompt: `${character.description}, flying speeder car arriving at glowing futuristic neon skyscraper city at twilight, cinematic wide tracking shot, hyperrealistic`,
      characterId: character.id,
      seconds: 5,
      narration: 'Nova arrives at the neon pulse of Sector 9, searching for the ancient data core.',
      state: 'idle',
    },
    {
      id: newId(),
      order: 1,
      title: 'Scene 2: Data Chamber Discovery',
      prompt: `${character.description}, standing inside high-tech holographic server vault, glowing blue data streams reflecting on metallic visor, cinematic medium shot`,
      characterId: character.id,
      seconds: 5,
      narration: 'Deep within the vault, the holographic streams reveal forgotten secrets.',
      state: 'idle',
    },
    {
      id: newId(),
      order: 2,
      title: 'Scene 3: Quantum Horizon Departure',
      prompt: `${character.description}, stepping onto launchpad overlooking vast starship galaxy horizon, cinematic slow motion lens flare`,
      characterId: character.id,
      seconds: 5,
      narration: 'With the core secured, Nova sets course for the uncharted galaxy.',
      state: 'idle',
    },
  ]

  const storyboard: Storyboard = {
    id: newId(),
    title: 'Cyber Voyager: Sector 9 (MCP Demo)',
    resolution: 2, // 1280x704 Max
    audioMode: 'both',
    voiceId: undefined,
    scenes,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }

  saveStoryboard(storyboard)
  console.log(`   ✅ Storyboard created: "${storyboard.title}" with 3 scenes (${scenes.length * 5}s total)`)

  // 5. Generate Scene Clips
  console.log('\n5. [MCP Tool: movie_generate_scene] Triggering LTX 2.5 rendering for all scenes...')
  const promptIds: { sceneId: string; promptId: string; index: number }[] = []

  for (const [i, sc] of scenes.entries()) {
    console.log(`   Rendering Scene ${i + 1}/${scenes.length}: "${sc.title}"...`)
    const built = buildWorkflow({
      prompt: sc.prompt,
      width: 1280,
      height: 704,
      seconds: sc.seconds,
      seed: 42000 + i * 100,
    })

    const { prompt_id } = await submitPrompt(podId, built.workflow)
    sc.state = 'running'
    sc.promptId = prompt_id
    promptIds.push({ sceneId: sc.id, promptId: prompt_id, index: i })
    console.log(`   -> Submitted to ComfyUI (Prompt ID: ${prompt_id})`)
  }

  saveStoryboard(storyboard)

  // Poll for completion of all scenes
  console.log('\n   Polling ComfyUI for scene renders completion...')
  for (const item of promptIds) {
    let done = false
    while (!done) {
      const status = await getJobStatus(podId, item.promptId)
      if (status.state === 'done' && status.filename) {
        scenes[item.index].state = 'done'
        scenes[item.index].filename = status.filename
        scenes[item.index].subfolder = status.subfolder || 'gen'
        console.log(`   ✅ Scene ${item.index + 1} finished: ${status.filename}`)
        done = true
      } else if (status.state === 'error') {
        throw new Error(`Scene ${item.index + 1} failed: ${status.error}`)
      } else {
        process.stdout.write('.')
        await sleep(4000)
      }
    }
  }

  saveStoryboard(storyboard)

  // 6. Assemble Film
  console.log('\n6. [MCP Tool: movie_assemble_film] Starting server-side ffmpeg assembly & Cloudflare R2 upload...')
  const filmRecord = startAssembly(storyboard, podId, {
    enabled: true,
    font: 'DejaVu Sans',
    fontSize: 22,
    color: '#FFFFFF',
    outlineColor: '#000000',
    outlineWidth: 2,
    position: 'bottom',
    boxed: false,
    uppercase: false,
  })

  console.log(`   Film assembly started (Film ID: ${filmRecord.id}). Waiting for ffmpeg & R2 upload...`)

  let completedFilm = getFilm(filmRecord.id)
  while (completedFilm?.state === 'building') {
    process.stdout.write('#')
    await sleep(2000)
    completedFilm = getFilm(filmRecord.id)
  }

  if (completedFilm?.state === 'error') {
    throw new Error(`Film assembly error: ${completedFilm.error}`)
  }

  console.log('\n   ✅ Film Assembly & Cloudflare R2 Upload Complete!')

  // 7. Get Presigned R2 Video URL
  console.log('\n7. [MCP Tool: movie_get_film] Fetching presigned Cloudflare R2 streaming URL...')
  let videoUrl = `/api/admin/videogen/assemble?file=${completedFilm?.file}`
  if (completedFilm?.storage === 'r2' || (isR2Configured() && completedFilm?.r2Key)) {
    const r2Url = await signedUrl(completedFilm?.r2Key || `${completedFilm?.id}.mp4`)
    if (r2Url) videoUrl = r2Url
  }

  console.log(`\n==================================================`)
  console.log(`SUCCESS! Full MCP Movie Generated:`)
  console.log(`Film ID: ${completedFilm?.id}`)
  console.log(`Duration: ${completedFilm?.duration?.toFixed(1)} seconds`)
  console.log(`Storage: ${completedFilm?.storage?.toUpperCase()}`)
  console.log(`Cloudflare R2 Video URL:`)
  console.log(videoUrl)
  console.log(`==================================================\n`)

  // 8. Copy file locally to artifacts directory for user viewing
  const artifactsDir = '/Users/siddhant/.gemini/antigravity-ide/brain/b00c3155-9248-4137-8e34-264bfe5a3ca0'
  const localFilmFile = path.join(process.cwd(), 'data', 'films', `${completedFilm?.id}.mp4`)
  const artifactTarget = path.join(artifactsDir, `mcp_generated_movie.mp4`)

  if (fs.existsSync(localFilmFile)) {
    fs.copyFileSync(localFilmFile, artifactTarget)
    console.log(`Copied MCP movie file to artifact directory: ${artifactTarget}`)
  }

  // 9. Stop Pod
  console.log('8. [MCP Tool: movie_pod_stop] Terminating GPU pod...')
  for await (const log of tearDown()) {
    console.log(`   [${log.level.toUpperCase()}] ${log.text}`)
  }

  console.log('=== MCP DEMO COMPLETED SUCCESSFULLY ===')
}

runMcpFullFilmDemo().catch((err) => {
  console.error('\n❌ MCP DEMO ERROR:', err)
  process.exit(1)
})
