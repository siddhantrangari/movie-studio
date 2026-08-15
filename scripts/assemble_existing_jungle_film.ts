import fs from 'fs'
import path from 'path'
import { findPod, tearDown } from '../lib/podops'
import { getStoryboards } from '../lib/studio'
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

async function assembleExistingJungleFilm() {
  console.log('===============================================================')
  console.log('🎬 ASSEMBLING PRE-RENDERED 13-SCENE JUNGLE MOVIE')
  console.log('===============================================================\n')

  const pod = await findPod()
  const podId = (pod?.id as string) || null
  if (!podId) throw new Error('No active GPU pod found!')

  const storyboards = getStoryboards()
  const sb = storyboards.find((s) => s.id === '38bc1b247765') || storyboards.find((s) => s.scenes.filter((sc) => sc.state === 'done').length === 13)
  if (!sb) throw new Error('Sanctuary of Beasts storyboard with done scenes not found!')

  console.log(`Found Storyboard: "${sb.title}" with ${sb.scenes.length} scenes`)
  const readyScenes = sb.scenes.filter((s) => s.state === 'done' && s.filename)
  console.log(`Ready scenes on pod: ${readyScenes.length}/${sb.scenes.length}`)

  console.log('\nStarting server-side ffmpeg assembly & ElevenLabs George narration synthesis...')
  const filmRecord = startAssembly(sb, podId, {
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

  console.log(`Assembly started (Film ID: ${filmRecord.id}). Waiting for ffmpeg & Cloudflare R2 upload...`)

  let completedFilm = getFilm(filmRecord.id)
  while (completedFilm?.state === 'building') {
    process.stdout.write('#')
    await sleep(2000)
    completedFilm = getFilm(filmRecord.id)
  }

  if (completedFilm?.state === 'error') {
    throw new Error(`Film assembly error: ${completedFilm.error}`)
  }

  console.log('\n\n✅ Film Assembly & Cloudflare R2 Upload Complete!')

  let videoUrl = `/api/admin/videogen/assemble?file=${completedFilm?.file}`
  if (completedFilm?.storage === 'r2' || (isR2Configured() && completedFilm?.r2Key)) {
    const r2Url = await signedUrl(completedFilm?.r2Key || `${completedFilm?.id}.mp4`)
    if (r2Url) videoUrl = r2Url
  }

  const artifactDir = '/Users/siddhant/.gemini/antigravity-ide/brain/8aed1f1d-8578-479f-9167-3a14c151f0e4'
  const localFilmFile = path.join(process.cwd(), 'data', 'films', `${completedFilm?.id}.mp4`)
  const artifactTarget = path.join(artifactDir, 'jungle_film_full_story.mp4')

  if (fs.existsSync(localFilmFile)) {
    fs.copyFileSync(localFilmFile, artifactTarget)
    console.log(`Copied finished MP4 film to artifact directory: ${artifactTarget}`)
  }

  console.log('\nTerminating GPU pod on RunPod...')
  for await (const log of tearDown()) {
    console.log(`  [${log.level.toUpperCase()}] ${log.text}`)
  }

  console.log('\n===============================================================')
  console.log('🎉 FULL 65s JUNGLE MOVIE GENERATED & ASSEMBLED SUCCESSFULLY!')
  console.log(`Film Title: ${completedFilm?.title}`)
  console.log(`Film ID: ${completedFilm?.id}`)
  console.log(`Duration: ${completedFilm?.duration?.toFixed(1)} seconds`)
  console.log(`Storage: ${completedFilm?.storage?.toUpperCase()}`)
  console.log(`Cloudflare R2 Presigned Video Link:`)
  console.log(videoUrl)
  console.log('===============================================================\n')
}

assembleExistingJungleFilm().catch((err) => {
  console.error('\n❌ ASSEMBLY ERROR:', err)
  process.exit(1)
})
