import fs from 'fs'
import path from 'path'
import crypto from 'crypto'

export type NodeType = 'character' | 'prompt' | 'generator'

export type CanvasNode = {
  id: string
  type: NodeType
  x: number
  y: number
  data: {
    // Character data
    characterId?: string
    name?: string
    description?: string
    imageFile?: string
    // Prompt data
    title?: string
    prompt?: string
    seconds?: number
    cameraMotion?: string // dolly_in, dolly_out, pan_left, zoom_in, etc.
    lens?: string // cinematic, wide, portrait
    narration?: string
    audioMode?: string
    // Generator / output data
    promptId?: string
    filename?: string
    subfolder?: string
    state?: 'idle' | 'queued' | 'running' | 'done' | 'error'
    error?: string
  }
}

export type CanvasEdge = {
  id: string
  source: string // source Node ID
  target: string // target Node ID
}

export type CanvasState = {
  nodes: CanvasNode[]
  edges: CanvasEdge[]
  panX: number
  panY: number
  zoom: number
}

const DATA_DIR = path.join(process.cwd(), 'data')
const CANVAS_FILE = path.join(DATA_DIR, 'canvas.json')

function ensureDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true })
}

export function getCanvasState(): CanvasState {
  try {
    if (!fs.existsSync(CANVAS_FILE)) {
      return { nodes: [], edges: [], panX: 0, panY: 0, zoom: 1 }
    }
    return JSON.parse(fs.readFileSync(CANVAS_FILE, 'utf8')) as CanvasState
  } catch {
    return { nodes: [], edges: [], panX: 0, panY: 0, zoom: 1 }
  }
}

export function saveCanvasState(state: CanvasState): CanvasState {
  ensureDir()
  fs.writeFileSync(CANVAS_FILE, JSON.stringify(state, null, 2))
  return state
}
