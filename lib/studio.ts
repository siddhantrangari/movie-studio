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
const STORYBOARD_FILE = path.join(DATA_DIR, 'storyboards.json')
const CHAR_FILE = path.join(DATA_DIR, 'characters.json')

function ensureDirs() {
  fs.mkdirSync(CHAR_DIR, { recursive: true })
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

export type Character = {
  id: string
  name: string
  /** Appearance notes appended to every scene prompt this character appears in. */
  description: string
  /** Basename inside data/characters, absent if the character is prompt-only. */
  imageFile?: string
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
  title: string
  /** 0-based index into the shared RESOLUTIONS list. */
  resolution: number
  /** 'none' | 'native' | 'elevenlabs' | 'both' */
  audioMode: string
  voiceId?: string
  scenes: Scene[]
  createdAt: number
  updatedAt: number
}

export const newId = () => crypto.randomBytes(6).toString('hex')

// ── Characters ──

export function getCharacters(): Character[] {
  return readJson<Character[]>(CHAR_FILE, [])
}

export function saveCharacter(c: Omit<Character, 'id' | 'createdAt'> & { id?: string }): Character {
  const all = getCharacters()
  const existing = c.id ? all.find((x) => x.id === c.id) : undefined
  const record: Character = {
    // Honour the caller's id — the reference image is already stored under it.
    id: existing?.id ?? c.id ?? newId(),
    name: c.name,
    description: c.description,
    imageFile: c.imageFile ?? existing?.imageFile,
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
      // image already gone; the record still needs removing
    }
  }
  writeJson(CHAR_FILE, all.filter((c) => c.id !== id))
}

/** Persists an uploaded reference image and returns its basename. */
export function storeCharacterImage(id: string, buf: Buffer, ext: string): string {
  ensureDirs()
  const safeExt = ['.png', '.jpg', '.jpeg', '.webp'].includes(ext.toLowerCase()) ? ext.toLowerCase() : '.png'
  const filename = `${id}${safeExt}`
  fs.writeFileSync(path.join(CHAR_DIR, filename), buf)
  return filename
}

export function readCharacterImage(filename: string): Buffer | null {
  const p = path.join(CHAR_DIR, path.basename(filename))
  if (!p.startsWith(CHAR_DIR) || !fs.existsSync(p)) return null
  return fs.readFileSync(p)
}

// ── Storyboards ──

export function getStoryboards(): Storyboard[] {
  return readJson<Storyboard[]>(STORYBOARD_FILE, [])
}

export function getStoryboard(id: string): Storyboard | null {
  return getStoryboards().find((s) => s.id === id) ?? null
}

export function saveStoryboard(sb: Storyboard): Storyboard {
  const all = getStoryboards()
  const record = { ...sb, updatedAt: Date.now() }
  const exists = all.some((s) => s.id === sb.id)
  writeJson(STORYBOARD_FILE, exists ? all.map((s) => (s.id === sb.id ? record : s)) : [...all, record])
  return record
}

export function deleteStoryboard(id: string) {
  writeJson(STORYBOARD_FILE, getStoryboards().filter((s) => s.id !== id))
}

/**
 * Builds the final prompt for a scene, folding in the character's appearance
 * notes so the description stays consistent across every shot.
 */
export function composeScenePrompt(scene: Scene, characters: Character[]): string {
  const c = scene.characterId ? characters.find((x) => x.id === scene.characterId) : undefined
  if (!c?.description) return scene.prompt
  return `${c.description.trim()}. ${scene.prompt.trim()}`
}
