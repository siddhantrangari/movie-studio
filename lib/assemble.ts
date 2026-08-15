import fs from 'fs'
import path from 'path'
import { spawn } from 'child_process'
import crypto from 'crypto'
import { fetchVideo } from './comfyui'
import { synthesize, CLONED_VOICE_ID } from './elevenlabs'
import { isR2Configured, putFilm, deleteFilmObject } from './storage'
import type { Scene, Storyboard } from './studio'

/**
 * Server-side film assembly: pulls each rendered scene off the pod, crossfades
 * them, mixes audio per the storyboard's audio mode, optionally burns in
 * captions, and writes a finished MP4 to disk.
 *
 * Scenes live on the pod, which is ephemeral — assembling copies them to the
 * VPS so the finished film survives the pod being terminated.
 */

const DATA_DIR = path.join(process.cwd(), 'data')
const FILMS_DIR = path.join(DATA_DIR, 'films')
const FILMS_FILE = path.join(DATA_DIR, 'films.json')
const WORK_DIR = path.join(DATA_DIR, 'work')

export const TRANSITION = 1 // seconds of crossfade between scenes

export const CAPTION_FONTS = [
  'DejaVu Sans',
  'Liberation Sans',
  'FreeSans',
  'DejaVu Serif',
  'Liberation Serif',
  'DejaVu Sans Mono',
  'Bitstream Charter',
]

export const CAPTION_POSITIONS = [
  { key: 'bottom', label: 'Bottom', alignment: 2, marginV: 40 },
  { key: 'middle', label: 'Middle', alignment: 5, marginV: 0 },
  { key: 'top', label: 'Top', alignment: 8, marginV: 40 },
]

export type CaptionStyle = {
  enabled: boolean
  font: string
  fontSize: number
  /** #RRGGBB */
  color: string
  outlineColor: string
  outlineWidth: number
  position: string
  /** Draw a translucent box behind the text instead of an outline. */
  boxed: boolean
  uppercase: boolean
}

export const DEFAULT_CAPTIONS: CaptionStyle = {
  enabled: false,
  font: 'DejaVu Sans',
  fontSize: 22,
  color: '#FFFFFF',
  outlineColor: '#000000',
  outlineWidth: 2,
  position: 'bottom',
  boxed: false,
  uppercase: false,
}

export type Film = {
  id: string
  storyboardId: string
  title: string
  state: 'building' | 'done' | 'error'
  file?: string
  storage?: 'r2' | 'local'
  r2Key?: string
  bytes?: number
  duration?: number
  error?: string
  createdAt: number
}

function ensureDirs() {
  fs.mkdirSync(FILMS_DIR, { recursive: true })
  fs.mkdirSync(WORK_DIR, { recursive: true })
}

function readFilms(): Film[] {
  try {
    if (!fs.existsSync(FILMS_FILE)) return []
    return JSON.parse(fs.readFileSync(FILMS_FILE, 'utf8'))
  } catch {
    return []
  }
}

function writeFilms(films: Film[]) {
  ensureDirs()
  fs.writeFileSync(FILMS_FILE, JSON.stringify(films, null, 2))
}

export function getFilms(): Film[] {
  return readFilms().sort((a, b) => b.createdAt - a.createdAt)
}

export function getFilm(id: string): Film | null {
  return readFilms().find((f) => f.id === id) ?? null
}

function upsertFilm(film: Film) {
  const all = readFilms()
  const i = all.findIndex((f) => f.id === film.id)
  if (i >= 0) all[i] = film
  else all.push(film)
  writeFilms(all)
}

export function deleteFilm(id: string) {
  const film = getFilm(id)
  if (film?.storage === 'r2' || film?.r2Key) {
    const key = film.r2Key || film.file || `${id}.mp4`
    deleteFilmObject(key).catch(() => {})
  }
  if (film?.file) {
    try {
      fs.unlinkSync(path.join(FILMS_DIR, film.file))
    } catch {
      // file already gone
    }
  }
  // A film deleted mid-assembly would otherwise strand its scratch dir.
  fs.rmSync(path.join(WORK_DIR, id), { recursive: true, force: true })
  writeFilms(readFilms().filter((f) => f.id !== id))
}

/**
 * Clears scratch directories left behind by assemblies that never finished.
 *
 * assemble() removes its own work dir in a finally block, but that can't run if
 * the process is killed mid-render — a PM2 restart or an OOM during ffmpeg.
 * Those dirs hold every downloaded scene clip, so on a shared VPS they are the
 * one thing here that can quietly grow without bound.
 */
export function sweepOrphanedWork(): number {
  if (!fs.existsSync(WORK_DIR)) return 0
  const building = new Set(readFilms().filter((f) => f.state === 'building').map((f) => f.id))
  let freed = 0
  for (const entry of fs.readdirSync(WORK_DIR)) {
    const dir = path.join(WORK_DIR, entry)
    try {
      const stat = fs.statSync(dir)
      if (!stat.isDirectory()) continue
      // An in-flight assembly keeps its dir, unless it's old enough that the
      // 'building' record must be a crash leftover rather than live work.
      const stale = Date.now() - stat.mtimeMs > 6 * 60 * 60 * 1000
      if (building.has(entry) && !stale) continue
      fs.rmSync(dir, { recursive: true, force: true })
      freed++
    } catch {
      // racing with a live assembly; leave it alone
    }
  }
  return freed
}

export function readFilmFile(file: string): string | null {
  const p = path.join(FILMS_DIR, path.basename(file))
  return p.startsWith(FILMS_DIR) && fs.existsSync(p) ? p : null
}

function run(cmd: string, args: string[], cwd?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { cwd })
    let stderr = ''
    p.stderr.on('data', (d) => {
      stderr += d.toString()
      if (stderr.length > 20000) stderr = stderr.slice(-8000)
    })
    p.on('error', reject)
    p.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(stderr.split('\n').slice(-6).join(' ').slice(0, 400)))
    )
  })
}

async function probeDuration(file: string): Promise<number> {
  return new Promise((resolve) => {
    const p = spawn('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file])
    let out = ''
    p.stdout.on('data', (d) => (out += d.toString()))
    p.on('close', () => resolve(parseFloat(out.trim()) || 0))
    p.on('error', () => resolve(0))
  })
}

/** #RRGGBB → ASS &HBBGGRR (ASS is BGR and wants no alpha here). */
function assColor(hex: string): string {
  const h = hex.replace('#', '').padEnd(6, '0')
  return `&H${h.slice(4, 6)}${h.slice(2, 4)}${h.slice(0, 2)}`.toUpperCase()
}

function assTime(sec: number): string {
  const cs = Math.max(0, Math.round(sec * 100))
  const h = Math.floor(cs / 360000)
  const m = Math.floor((cs % 360000) / 6000)
  const s = Math.floor((cs % 6000) / 100)
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`
}

/** Where each scene begins on the final timeline, accounting for crossfades. */
export function sceneOffsets(durations: number[]): number[] {
  const offsets: number[] = []
  let t = 0
  durations.forEach((d, i) => {
    offsets.push(t)
    t += d - (i < durations.length - 1 ? TRANSITION : 0)
  })
  return offsets
}

function buildAss(scenes: Scene[], durations: number[], style: CaptionStyle): string {
  const pos = CAPTION_POSITIONS.find((p) => p.key === style.position) ?? CAPTION_POSITIONS[0]
  const offsets = sceneOffsets(durations)

  const header = `[Script Info]
ScriptType: v4.00+
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, OutlineColour, BackColour, Bold, Italic, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Main,${style.font},${style.fontSize},${assColor(style.color)},${assColor(style.outlineColor)},&H80000000,0,0,${style.boxed ? 3 : 1},${style.outlineWidth},0,${pos.alignment},30,30,${pos.marginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`

  const lines = scenes
    .map((s, i) => {
      const text = (s.narration ?? '').trim()
      if (!text) return null
      const start = offsets[i]
      // Hold the caption for the scene, minus the crossfade so it doesn't
      // bleed over the cut.
      const end = start + Math.max(1, durations[i] - (i < scenes.length - 1 ? TRANSITION : 0))
      const body = (style.uppercase ? text.toUpperCase() : text)
        .replace(/\r?\n/g, '\\N')
        .replace(/,/g, '‚') // commas break the ASS field split
      return `Dialogue: 0,${assTime(start)},${assTime(end)},Main,,0,0,0,,${body}`
    })
    .filter(Boolean)

  return header + lines.join('\n') + '\n'
}

/**
 * Assembles a film. Returns immediately with a 'building' record; the work
 * continues in the background and the record flips to 'done' or 'error'.
 */
export function startAssembly(sb: Storyboard, podId: string, captions: CaptionStyle): Film {
  const film: Film = {
    id: crypto.randomBytes(6).toString('hex'),
    storyboardId: sb.id,
    title: sb.title,
    state: 'building',
    createdAt: Date.now(),
  }
  upsertFilm(film)

  assemble(sb, podId, captions, film).catch((e) => {
    upsertFilm({ ...film, state: 'error', error: (e as Error).message })
  })

  return film
}

async function assemble(sb: Storyboard, podId: string, captions: CaptionStyle, film: Film) {
  ensureDirs()
  // Cheap, and this is the moment disk headroom actually matters.
  sweepOrphanedWork()
  const work = path.join(WORK_DIR, film.id)
  fs.mkdirSync(work, { recursive: true })

  try {
    const scenes = sb.scenes
      .filter((s) => s.state === 'done' && s.filename)
      .sort((a, b) => a.order - b.order)

    if (scenes.length === 0) throw new Error('No generated scenes to assemble')

    // 1. Pull each scene off the pod.
    const files: string[] = []
    for (const [i, s] of scenes.entries()) {
      const res = await fetchVideo(podId, s.filename!, s.subfolder ?? 'gen')
      if (!res.ok) throw new Error(`Could not fetch "${s.title}" from the pod (${res.status})`)
      const f = path.join(work, `s${String(i).padStart(2, '0')}.mp4`)
      fs.writeFileSync(f, Buffer.from(await res.arrayBuffer()))
      files.push(f)
    }

    const durations = await Promise.all(files.map(probeDuration))
    // 2. Synthesize narration per scene, placed at that scene's offset.
    const offsets = sceneOffsets(durations)
    const narrations: { file: string; offset: number }[] = []
    for (const [i, s] of scenes.entries()) {
      const effMode = s.audioMode || sb.audioMode
      const sceneWantsVoice = effMode === 'elevenlabs' || effMode === 'both'
      if (!sceneWantsVoice) continue

      const text = (s.narration ?? '').trim()
      if (!text) continue
      const mp3 = path.join(work, `vo${i}.mp3`)
      const voiceId = sb.voiceId && sb.voiceId !== 'elevenlabs_default' ? sb.voiceId : CLONED_VOICE_ID
      fs.writeFileSync(mp3, Buffer.from(await synthesize(text, voiceId)))
      narrations.push({ file: mp3, offset: offsets[i] })
    }

    // 3. Build the filter graph.
    const inputs: string[] = []
    files.forEach((f) => inputs.push('-i', f))
    narrations.forEach((n) => inputs.push('-i', n.file))

    const n = files.length
    const parts: string[] = []

    // Video: chain crossfades across all scenes.
    if (n === 1) {
      parts.push(`[0:v]format=yuv420p[vraw]`)
    } else {
      let prev = '0:v'
      let acc = 0
      for (let i = 1; i < n; i++) {
        acc += durations[i - 1] - TRANSITION
        const out = i === n - 1 ? 'vraw' : `vx${i}`
        parts.push(
          `[${prev}][${i}:v]xfade=transition=fade:duration=${TRANSITION}:offset=${acc.toFixed(3)},format=yuv420p[${out}]`
        )
        prev = out
      }
    }

    // Captions burned in over the crossfaded video.
    let vOut = 'vraw'
    const hasCaptionText = scenes.some((s) => (s.narration ?? '').trim())
    if (captions.enabled && hasCaptionText) {
      const assFile = path.join(work, 'captions.ass')
      fs.writeFileSync(assFile, buildAss(scenes, durations, captions))
      parts.push(`[vraw]subtitles='${assFile.replace(/'/g, "\\'")}'[vcap]`)
      vOut = 'vcap'
    }

    // Audio: ambience crossfaded, narration delayed to its scene, then mixed.
    const audioBits: string[] = []
    const hasAmbience = scenes.some((s) => {
      const effMode = s.audioMode || sb.audioMode
      return effMode === 'native' || effMode === 'both'
    })

    if (hasAmbience) {
      for (const [i, s] of scenes.entries()) {
        const effMode = s.audioMode || sb.audioMode
        const sceneWantsVoice = effMode === 'elevenlabs' || effMode === 'both'
        const sceneWantsAmbience = effMode === 'native' || effMode === 'both'

        if (!sceneWantsAmbience) {
          parts.push(`[${i}:a]volume=0[a_mod_${i}]`)
        } else if (sceneWantsVoice) {
          parts.push(`[${i}:a]volume=0.35[a_mod_${i}]`)
        } else {
          parts.push(`[${i}:a]volume=1.0[a_mod_${i}]`)
        }
      }

      if (n === 1) {
        parts.push(`[a_mod_0]anull[amb]`)
      } else {
        let prev = 'a_mod_0'
        for (let i = 1; i < n; i++) {
          const out = i === n - 1 ? 'amb' : `ax${i}`
          parts.push(`[${prev}][a_mod_${i}]acrossfade=d=${TRANSITION}[${out}]`)
          prev = out
        }
      }
      audioBits.push('[amb]')
    }

    narrations.forEach((nar, i) => {
      const idx = n + i
      const ms = Math.round(nar.offset * 1000)
      parts.push(`[${idx}:a]adelay=${ms}|${ms}[vo${i}]`)
      audioBits.push(`[vo${i}]`)
    })

    const args = ['-y', ...inputs]
    let mapAudio: string[] = []

    if (audioBits.length === 1) {
      parts.push(`${audioBits[0]}aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo[aout]`)
      mapAudio = ['-map', '[aout]']
    } else if (audioBits.length > 1) {
      parts.push(
        `${audioBits.join('')}amix=inputs=${audioBits.length}:duration=longest:dropout_transition=0,` +
          `aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo[aout]`
      )
      mapAudio = ['-map', '[aout]']
    }

    const out = path.join(FILMS_DIR, `${film.id}.mp4`)
    args.push(
      '-filter_complex', parts.join(';'),
      '-map', `[${vOut}]`,
      ...mapAudio,
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p',
      ...(mapAudio.length ? ['-c:a', 'aac', '-b:a', '192k'] : ['-an']),
      '-movflags', '+faststart',
      out
    )

    await run('ffmpeg', args)

    const bytes = fs.statSync(out).size
    const duration = await probeDuration(out)
    let storage: 'r2' | 'local' = 'local'
    let r2Key: string | undefined

    if (isR2Configured()) {
      try {
        r2Key = `${film.id}.mp4`
        await putFilm(r2Key, out)
        storage = 'r2'
        try {
          fs.unlinkSync(out)
        } catch {
          // file already removed
        }
      } catch (err) {
        console.error('Failed to upload film to R2, falling back to local storage:', err)
        storage = 'local'
      }
    }

    upsertFilm({
      ...film,
      state: 'done',
      file: `${film.id}.mp4`,
      storage,
      r2Key,
      bytes,
      duration,
    })
  } finally {
    fs.rmSync(work, { recursive: true, force: true })
  }
}

/** Total bytes held by finished films — surfaced in the UI. */
export function filmsDiskUsage(): number {
  return readFilms().reduce((n, f) => n + (f.bytes ?? 0), 0)
}
