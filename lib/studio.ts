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
export function composeScenePrompt(scene: Scene, characters: Character[]): string {
  const c = scene.characterId ? characters.find((x) => x.id === scene.characterId) : undefined
  if (!c) return scene.prompt
  
  const parts: string[] = []
  if (c.description?.trim()) parts.push(c.description.trim())
  if (c.styleSheetNotes?.trim()) parts.push(`Character Style: ${c.styleSheetNotes.trim()}`)
  parts.push(scene.prompt.trim())

  return parts.join('. ').replace(/\.\s*\./g, '.')
}
