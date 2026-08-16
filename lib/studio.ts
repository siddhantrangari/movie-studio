import fs from 'fs'
import path from 'path'
import crypto from 'crypto'

/**
 * File-backed store for the video studio.
 *
 * Character reference images live here rather than on the pod: pods are
 * ephemeral, so a terminated pod takes ComfyUI's input folder with it. Images
 * are re-uploaded to whichever pod is current at generation time.
 */

const DATA_DIR = path.join(process.cwd(), 'data')
const CHAR_DIR = path.join(DATA_DIR, 'characters')
const AUDIO_DIR = path.join(DATA_DIR, 'audio')
const STORYBOARD_FILE = path.join(DATA_DIR, 'storyboards.json')
const CHAR_FILE = path.join(DATA_DIR, 'characters.json')
const PROJECTS_FILE = path.join(DATA_DIR, 'projects.json')
const GENERATIONS_FILE = path.join(DATA_DIR, 'generations.json')

function ensureDirs() {
  fs.mkdirSync(CHAR_DIR, { recursive: true })
  fs.mkdirSync(AUDIO_DIR, { recursive: true })
}

function readJson<T>(file: string, fallback: T): T {
  try {
    if (!fs.existsSync(file)) return fallback
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T
  } catch {
    return fallback
  }
}

function writeJson(file: string, data: unknown) {
  ensureDirs()
  fs.writeFileSync(file, JSON.stringify(data, null, 2))
}

export type VideoProject = {
  id: string
  name: string
  description?: string
  createdAt: number
  updatedAt: number
  isPublished?: boolean
}

export type Character = {
  id: string
  name: string
  /** Primary appearance notes appended to every scene prompt this character appears in. */
  description: string
  /** Basename inside data/characters, absent if the character is prompt-only. */
  imageFile?: string
  /** Multiple turnaround / style sheet images (front, side, back view). */
  turnaroundImages?: string[]
  /** Detailed character style sheet guidance (costume, colors, expression rules). */
  styleSheetNotes?: string
  /** Mapped ElevenLabs voice ID or voice preset name. */
  voiceId?: string
  /** Custom reference audio sample file for voiceover cloning / TTS. */
  voiceSampleFile?: string
  createdAt: number
}

export type Scene = {
  id: string
  order: number
  title: string
  prompt: string
  seconds: number
  /** Character whose reference image seeds the first frame. */
  characterId?: string
  /** Narration script. Empty means no voiceover on this scene. */
  narration?: string
  // Populated once generated
  promptId?: string
  filename?: string
  subfolder?: string
  state?: 'idle' | 'queued' | 'running' | 'done' | 'error'
  error?: string
  audioMode?: string
}

export type Storyboard = {
  id: string
  projectId?: string
  title: string
  /** 0-based index into the shared RESOLUTIONS list. */
  resolution: number
  /** 'none' | 'native' | 'elevenlabs' | 'both' */
  audioMode: string
  voiceId?: string
  scenes: Scene[]
  createdAt: number
  updatedAt: number
  isPublished?: boolean
}

export const newId = () => crypto.randomBytes(6).toString('hex')

// ── Projects ──

export function getVideoProjects(): VideoProject[] {
  const projects = readJson<VideoProject[]>(PROJECTS_FILE, [])
  if (projects.length === 0) {
    const defaultProj: VideoProject = {
      id: 'default-project',
      name: 'Default Project',
      description: 'Default workspace for movies and video generations',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    writeJson(PROJECTS_FILE, [defaultProj])
    return [defaultProj]
  }
  return projects
}

export function saveVideoProject(p: Partial<VideoProject> & { name: string }): VideoProject {
  const all = getVideoProjects()
  const existing = p.id ? all.find((x) => x.id === p.id) : undefined
  const record: VideoProject = {
    id: existing?.id ?? p.id ?? newId(),
    name: p.name,
    description: p.description ?? existing?.description ?? '',
    createdAt: existing?.createdAt ?? Date.now(),
    updatedAt: Date.now(),
    isPublished: p.isPublished ?? existing?.isPublished ?? false,
  }
  const next = existing ? all.map((x) => (x.id === record.id ? record : x)) : [...all, record]
  writeJson(PROJECTS_FILE, next)
  return record
}

export function deleteVideoProject(id: string) {
  if (id === 'default-project') return
  writeJson(PROJECTS_FILE, getVideoProjects().filter((p) => p.id !== id))
}

// ── Characters ──

export function getCharacters(): Character[] {
  return readJson<Character[]>(CHAR_FILE, [])
}

export function saveCharacter(c: Omit<Character, 'id' | 'createdAt'> & { id?: string }): Character {
  const all = getCharacters()
  const existing = c.id ? all.find((x) => x.id === c.id) : undefined
  const record: Character = {
    id: existing?.id ?? c.id ?? newId(),
    name: c.name,
    description: c.description,
    imageFile: c.imageFile ?? existing?.imageFile,
    turnaroundImages: c.turnaroundImages ?? existing?.turnaroundImages ?? [],
    styleSheetNotes: c.styleSheetNotes ?? existing?.styleSheetNotes ?? '',
    voiceId: c.voiceId ?? existing?.voiceId ?? '',
    voiceSampleFile: c.voiceSampleFile ?? existing?.voiceSampleFile ?? '',
    createdAt: existing?.createdAt ?? Date.now(),
  }
  const next = existing ? all.map((x) => (x.id === record.id ? record : x)) : [...all, record]
  writeJson(CHAR_FILE, next)
  return record
}

export function deleteCharacter(id: string) {
  const all = getCharacters()
  const target = all.find((c) => c.id === id)
  if (target?.imageFile) {
    try {
      fs.unlinkSync(path.join(CHAR_DIR, target.imageFile))
    } catch {
      // ignore
    }
  }
  if (target?.turnaroundImages) {
    for (const img of target.turnaroundImages) {
      try { fs.unlinkSync(path.join(CHAR_DIR, img)) } catch {}
    }
  }
  if (target?.voiceSampleFile) {
    try { fs.unlinkSync(path.join(AUDIO_DIR, target.voiceSampleFile)) } catch {}
  }
  writeJson(CHAR_FILE, all.filter((c) => c.id !== id))
}

/** Persists an uploaded reference image and returns its basename. */
export function storeCharacterImage(id: string, buf: Buffer, ext: string, suffix = ''): string {
  ensureDirs()
  const safeExt = ['.png', '.jpg', '.jpeg', '.webp'].includes(ext.toLowerCase()) ? ext.toLowerCase() : '.png'
  const filename = suffix ? `${id}_${suffix}${safeExt}` : `${id}${safeExt}`
  fs.writeFileSync(path.join(CHAR_DIR, filename), buf)
  return filename
}

export function storeCharacterAudio(id: string, buf: Buffer, ext: string): string {
  ensureDirs()
  const safeExt = ['.mp3', '.wav', '.ogg', '.m4a'].includes(ext.toLowerCase()) ? ext.toLowerCase() : '.mp3'
  const filename = `${id}_voice${safeExt}`
  fs.writeFileSync(path.join(AUDIO_DIR, filename), buf)
  return filename
}

export function readCharacterImage(filename: string): Buffer | null {
  const p = path.join(CHAR_DIR, path.basename(filename))
  if (!p.startsWith(CHAR_DIR) || !fs.existsSync(p)) return null
  return fs.readFileSync(p)
}

export function readCharacterAudio(filename: string): Buffer | null {
  const p = path.join(AUDIO_DIR, path.basename(filename))
  if (!p.startsWith(AUDIO_DIR) || !fs.existsSync(p)) return null
  return fs.readFileSync(p)
}

// ── Storyboards ──

export function getStoryboards(projectId?: string): Storyboard[] {
  const all = readJson<Storyboard[]>(STORYBOARD_FILE, [])
  if (!projectId) return all
  return all.filter((s) => (s.projectId ?? 'default-project') === projectId)
}

export function getStoryboard(id: string): Storyboard | null {
  return readJson<Storyboard[]>(STORYBOARD_FILE, []).find((s) => s.id === id) ?? null
}

export function saveStoryboard(sb: Storyboard): Storyboard {
  const all = readJson<Storyboard[]>(STORYBOARD_FILE, [])
  const record = {
    ...sb,
    projectId: sb.projectId ?? 'default-project',
    updatedAt: Date.now(),
  }
  const exists = all.some((s) => s.id === sb.id)
  writeJson(STORYBOARD_FILE, exists ? all.map((s) => (s.id === sb.id ? record : s)) : [...all, record])
  return record
}

export function deleteStoryboard(id: string) {
  const all = readJson<Storyboard[]>(STORYBOARD_FILE, [])
  writeJson(STORYBOARD_FILE, all.filter((s) => s.id !== id))
}

/**
 * Builds the final prompt for a scene, folding in character visual description,
 * character turnaround style sheet guidelines, and scene prompt.
 */
export function composeScenePrompt(scene: Partial<Scene> & { description?: string }, characters: Character[]): string {
  const rawPrompt = (scene.prompt || scene.description || '').trim()
  const c = scene.characterId ? characters.find((x) => x.id === scene.characterId) : undefined
  if (!c) return rawPrompt
  
  const parts: string[] = []
  if (c.description?.trim()) parts.push(c.description.trim())
  if (c.styleSheetNotes?.trim()) parts.push(`Character Style: ${c.styleSheetNotes.trim()}`)
  if (rawPrompt) parts.push(rawPrompt)

  return parts.join('. ').replace(/\.\s*\./g, '.')
}

// ── Generation Jobs (Custom Video Generations Ledger) ──

export type GenerationJob = {
  id: string
  projectId?: string
  promptId: string
  prompt: string
  label: string
  startedAt?: number
  createdAt: number
  updatedAt?: number
  state: 'idle' | 'queued' | 'running' | 'done' | 'error'
  filename?: string
  subfolder?: string
  error?: string
  width?: number
  height?: number
  seconds?: number
  characterId?: string
}

export function getGenerationJobs(projectId?: string): GenerationJob[] {
  const all = readJson<GenerationJob[]>(GENERATIONS_FILE, [])
  // Discover any generated scenes from storyboards so all generated content appears in history
  const storyboards = getStoryboards(projectId)
  const storyboardJobs: GenerationJob[] = []
  for (const sb of storyboards) {
    for (const sc of sb.scenes || []) {
      if (sc.promptId && !all.some((j) => j.promptId === sc.promptId)) {
        storyboardJobs.push({
          id: sc.id || `sc_${sc.promptId}`,
          projectId: sb.projectId,
          promptId: sc.promptId,
          prompt: sc.prompt,
          label: `${sb.title || 'Movie'} - Scene ${sc.order}`,
          createdAt: sb.createdAt || Date.now(),
          updatedAt: sb.updatedAt,
          state: sc.state || 'done',
          filename: sc.filename,
          subfolder: sc.subfolder || 'gen',
          error: sc.error,
          seconds: sc.seconds,
        })
      }
    }
  }

  const combined = [...all, ...storyboardJobs]
  combined.sort((a, b) => b.createdAt - a.createdAt)

  if (!projectId || projectId === 'all') return combined
  return combined.filter((j) => (j.projectId ?? 'default-project') === projectId || !j.projectId)
}

export function saveGenerationJob(job: GenerationJob): GenerationJob {
  const all = readJson<GenerationJob[]>(GENERATIONS_FILE, [])
  const record: GenerationJob = {
    ...job,
    projectId: job.projectId ?? 'default-project',
    updatedAt: Date.now(),
  }
  const idx = all.findIndex((j) => j.id === job.id || j.promptId === job.promptId)
  if (idx >= 0) {
    all[idx] = record
  } else {
    all.unshift(record)
  }
  writeJson(GENERATIONS_FILE, all.slice(0, 500))
  return record
}

export function updateGenerationJob(idOrPromptId: string, patch: Partial<GenerationJob>): GenerationJob | null {
  const all = readJson<GenerationJob[]>(GENERATIONS_FILE, [])
  const idx = all.findIndex((j) => j.id === idOrPromptId || j.promptId === idOrPromptId)
  if (idx < 0) return null
  all[idx] = { ...all[idx], ...patch, updatedAt: Date.now() }
  writeJson(GENERATIONS_FILE, all)
  return all[idx]
}

export function deleteGenerationJob(id: string) {
  const all = readJson<GenerationJob[]>(GENERATIONS_FILE, [])
  writeJson(GENERATIONS_FILE, all.filter((j) => j.id !== id && j.promptId !== id))
}
