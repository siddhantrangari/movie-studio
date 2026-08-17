'use client'

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import Link from 'next/link'
import { RESOLUTIONS } from '@/lib/resolutions'
import PromptBuilderDrawer from './components/PromptBuilderDrawer'
import UsageDashboard from './components/UsageDashboard'
import EnginesHub from './components/EnginesHub'
import SingingStudio from './components/SingingStudio'
import PodLogsModal from './components/PodLogsModal'
import { useToast } from './components/Toast'

type PodData = {
  id: string
  name: string
  desiredStatus: string
  runtime: Record<string, unknown> | null
  machine?: { gpuDisplayName?: string }
  gpu?: { id?: string; gpuUtilPercent?: number; memoryUtilPercent?: number }
  gpuDisplayName?: string
  gpuVram?: number
  gpuTypeId?: string
  costPerHr: number
} | null

export function getPodGpuName(pod: PodData | Record<string, unknown> | null | undefined): string {
  if (!pod) return ''
  const p = pod as Record<string, unknown>
  const gpuObj = p.gpu as { id?: string } | undefined
  const machineObj = p.machine as { gpuDisplayName?: string } | undefined
  return (
    (p.gpuDisplayName as string) ||
    gpuObj?.id ||
    machineObj?.gpuDisplayName ||
    (p.gpuName as string) ||
    (p.gpuTypeId as string) ||
    ''
  )
}

export function getPodVram(pod: PodData | Record<string, unknown> | null | undefined): number {
  if (!pod) return 0
  const p = pod as Record<string, unknown>
  if (typeof p.gpuVram === 'number' && p.gpuVram > 0) return p.gpuVram
  const name = getPodGpuName(pod).toUpperCase()
  if (name.includes('A100') || name.includes('H100') || name.includes('80GB')) return 80
  if (name.includes('A6000') || name.includes('A40') || name.includes('L40') || name.includes('48GB')) return 48
  if (name.includes('3090') || name.includes('4090') || name.includes('24GB') || name.includes('TITAN')) return 24
  if (name.includes('4080') || name.includes('16GB')) return 16
  if (typeof p.costPerHr === 'number' && p.costPerHr >= 0.50) return 48
  return 24
}

type Project = {
  id: string
  name: string
  description?: string
  createdAt: number
  updatedAt: number
}

const PUBLISHED_PROJECTS = [
  {
    id: 'pub_01',
    title: 'Cyber Voyager: Sector 9',
    tag: 'Sci-Fi Action',
    duration: '15s',
    shotsCount: 3,
    look: 'Slow Push In',
    grade: 'Teal & Orange',
    prompt: 'Cybernetic explorer wearing a glowing neon blue visor and metallic silver spacesuit, flying speeder car arriving at glowing futuristic neon skyscraper city at twilight.',
    scenes: [
      { order: 1, title: 'Neon City Arrival', prompt: 'Cybernetic explorer wearing a glowing neon blue visor arriving at neon city.', look: 'Slow Push In', grade: 'Teal & Orange' },
      { order: 2, title: 'Data Vault Discovery', prompt: 'Inside high-tech holographic server vault, blue data streams reflecting on visor.', look: 'Orbit', grade: 'High Contrast Noir' },
      { order: 3, title: 'Quantum Horizon', prompt: 'Stepping onto launchpad overlooking vast starship galaxy horizon.', look: 'Crane Down', grade: 'Golden Hour' }
    ]
  },
  {
    id: 'pub_02',
    title: 'Jungle Chronicles: Kael',
    tag: 'Wildlife Adventure',
    duration: '18s',
    shotsCount: 3,
    look: 'Handheld Doc',
    grade: 'Kodachrome',
    prompt: 'A young wild boy with unruly dark hair and golden eyes walking through dense mist-filled jungle canopy.',
    scenes: [
      { order: 1, title: 'Canopy Walk', prompt: 'Young wild boy Kael walking along high branches in lush ancient jungle.', look: 'Handheld Doc', grade: 'Natural' },
      { order: 2, title: 'Panther Encounter', prompt: 'Kael locking eyes with a majestic black panther by a waterfall.', look: 'Slow Push In', grade: 'Teal & Orange' },
      { order: 3, title: 'Tree Top Sunset', prompt: 'Kael standing atop a giant ancient banyan tree looking out over jungle.', look: 'Crane Down', grade: 'Golden Hour' }
    ]
  },
  {
    id: 'pub_03',
    title: 'Royal Heritage: Luxury Reveal',
    tag: 'Commercial',
    duration: '12s',
    shotsCount: 2,
    look: 'Macro Detail',
    grade: 'Luxury Gold',
    prompt: 'Cinematic close-up of a luxurious gold diamond necklace rotating slowly on black velvet.',
    scenes: [
      { order: 1, title: 'Diamond Facets', prompt: 'Macro detail of artisan setting diamond into gold ring.', look: 'Macro Detail', grade: 'Luxury Gold' },
      { order: 2, title: 'Editorial Model', prompt: 'Elegant Indian woman wearing gold necklace in warm window light.', look: 'Pull Back Reveal', grade: 'Luxury Gold' }
    ]
  }
]

type Model = 'ltx25' | 'minimax'

type Job = {
  id: string
  promptId: string
  label: string
  prompt: string
  seconds?: number
  state: 'idle' | 'queued' | 'running' | 'done' | 'error'
  filename?: string
  subfolder?: string
  error?: string
  startedAt?: number
  createdAt?: number
  projectId?: string
}

type Character = {
  id: string
  name: string
  description: string
  imageFile?: string
  turnaroundImages?: string[]
  styleSheetNotes?: string
  voiceId?: string
  voiceSampleFile?: string
}

type Film = {
  id: string
  title: string
  state: string
  file?: string
  bytes?: number
  duration?: number
  createdAt: number
}

export default function VideoGenClient() {
  const { confirm: showConfirmModal, toast } = useToast()
  const [pods, setPods] = useState<{ ltx: PodData; minimax: PodData }>({ ltx: null, minimax: null })
  const [deploying, setDeploying] = useState<{ ltx25: boolean; minimax: boolean }>({ ltx25: false, minimax: false })
  const [deployingTier, setDeployingTier] = useState<'standard' | 'ultra_4k' | null>(null)
  const [deployError, setDeployError] = useState<{ ltx25: string | null; minimax: string | null }>({ ltx25: null, minimax: null })
  const [actionLoading, setActionLoading] = useState<{ ltx25: string | null; minimax: string | null }>({ ltx25: null, minimax: null })
  const [fleetModalTab, setFleetModalTab] = useState<'ltx25' | 'minimax'>('ltx25')
  const [deployLogs, setDeployLogs] = useState<{ level: string; text: string }[]>([])
  const logTerminalRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (logTerminalRef.current) {
      logTerminalRef.current.scrollTop = logTerminalRef.current.scrollHeight
    }
  }, [deployLogs])

  // Active Tab navigation: 'home' | 'singing' | 'generations' | 'canvas' | 'characters' | 'audio' | 'usage' | 'engines' | 'settings'
  const [activeTab, setActiveTab] = useState<'home' | 'singing' | 'generations' | 'canvas' | 'characters' | 'audio' | 'usage' | 'engines' | 'settings'>('home')

  // Projects state
  const [projects, setProjects] = useState<Project[]>([])
  const [activeProjectId, setActiveProjectId] = useState<string>('default-project')
  const [showNewProjectModal, setShowNewProjectModal] = useState(false)
  const [newProjectName, setNewProjectName] = useState('')

  // Custom generations state
  const [jobs, setJobs] = useState<Job[]>([])
  const [films, setFilms] = useState<Film[]>([])
  const [characters, setCharacters] = useState<Character[]>([])
  const [voices, setVoices] = useState<{ voiceId: string; name: string; category: string; previewUrl?: string }[]>([])
  const [genPrompt, setGenPrompt] = useState('')
  const [genSeconds, setGenSeconds] = useState(8)
  const [genRes, setGenRes] = useState(0)
  const [selectedCharacterId, setSelectedCharacterId] = useState<string>('')

  const handleLogout = async () => {
    await fetch('/api/logout', { method: 'POST' })
    window.location.href = '/login'
  }
  
  // Settings overrides
  const [cameraMotion, setCameraMotion] = useState('Auto')
  const [colorPalette, setColorPalette] = useState('Auto')
  const [lighting, setLighting] = useState('Auto')
  const [selectedModel, setSelectedModel] = useState<'ltx25' | 'minimax'>('ltx25')
  const [refImages, setRefImages] = useState<string[]>([])
  const [savedReferences, setSavedReferences] = useState<{ key: string; filename: string; url: string; createdAt: number }[]>([])
  const [showRefLibraryModal, setShowRefLibraryModal] = useState(false)
  const [refLoading, setRefLoading] = useState(false)
  const maxRefImages = selectedModel === 'minimax' ? 9 : 5
  const [aspectRatio, setAspectRatio] = useState(0)
  const [mode, setMode] = useState<'video' | 'image'>('video')

  const loadSavedReferences = async () => {
    setRefLoading(true)
    try {
      const res = await fetch(`/api/videogen/references?projectId=${activeProjectId}`)
      const data = await res.json()
      if (data.references) setSavedReferences(data.references)
    } catch (err) {
      console.error('Error loading references:', err)
    } finally {
      setRefLoading(false)
    }
  }

  const [submitting, setSubmitting] = useState(false)
  const [genError, setGenError] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const [failedVideos, setFailedVideos] = useState<Record<string, boolean>>({})
  const [initialLoading, setInitialLoading] = useState(true)

  // ── @ Mention Autocomplete State & Logic ──
  const promptTextareaRef = useRef<HTMLTextAreaElement>(null)
  const mentionMenuRef = useRef<HTMLDivElement>(null)
  const [showMentionMenu, setShowMentionMenu] = useState(false)
  const [mentionQuery, setMentionQuery] = useState('')
  const [mentionStartIndex, setMentionStartIndex] = useState<number>(-1)
  const [selectedMentionIdx, setSelectedMentionIdx] = useState<number>(0)

  // Compute all available mention options based on attached images and characters
  const mentionItems = useMemo(() => {
    const items: Array<{
      id: string
      tag: string
      label: string
      subtitle?: string
      image?: string
      icon?: string
      category: 'Attached Images' | 'Project Characters' | 'Media & Roles'
      character?: Character
    }> = []

    // 1. Attached references
    refImages.forEach((img, idx) => {
      items.push({
        id: `ref_${idx}`,
        tag: selectedModel === 'minimax' ? `@picture${idx + 1}` : `@image${idx + 1}`,
        label: `Attached Image #${idx + 1}`,
        subtitle: `Reference slot #${idx + 1}`,
        image: img,
        category: 'Attached Images',
      })
    })

    // 2. Characters
    characters.forEach((char) => {
      const cleanName = char.name.replace(/[^\w]/g, '')
      items.push({
        id: `char_${char.id}`,
        tag: `@${cleanName || char.name}`,
        label: char.name,
        subtitle: char.description?.slice(0, 50) || 'Character',
        image: char.imageFile ? `/api/videogen/characters?file=${encodeURIComponent(char.imageFile)}` : undefined,
        icon: '👤',
        category: 'Project Characters',
        character: char,
      })
    })

    // 3. Audio & Quick visual slots
    if (refImages.length === 0) {
      items.push({
        id: 'slot_pic1',
        tag: selectedModel === 'minimax' ? '@picture1' : '@image1',
        label: 'Image Reference 1',
        subtitle: 'Primary visual subject',
        icon: '🖼️',
        category: 'Media & Roles',
      })
    }

    items.push({
      id: 'slot_audio1',
      tag: '@audio1',
      label: 'Audio Reference Track',
      subtitle: 'Singing vocals & lip-sync',
      icon: '🎵',
      category: 'Media & Roles',
    })

    items.push({
      id: 'slot_performer',
      tag: '@performer',
      label: 'Lead Performer',
      subtitle: 'Main actor / singer',
      icon: '🎤',
      category: 'Media & Roles',
    })

    if (!mentionQuery.trim()) return items

    const q = mentionQuery.toLowerCase()
    return items.filter(
      (item) =>
        item.tag.toLowerCase().includes(q) ||
        item.label.toLowerCase().includes(q) ||
        (item.subtitle && item.subtitle.toLowerCase().includes(q))
    )
  }, [refImages, characters, selectedModel, mentionQuery])

  // Handle textarea text changes and detect @ triggers
  const handlePromptChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value
    const cursor = e.target.selectionStart || 0
    setGenPrompt(val)

    // Check if cursor is immediately following an @ or @query
    const textBeforeCursor = val.slice(0, cursor)
    const atMatch = textBeforeCursor.match(/@([\w-]*)$/)
    if (atMatch) {
      setMentionQuery(atMatch[1])
      setMentionStartIndex(cursor - atMatch[0].length)
      setShowMentionMenu(true)
      setSelectedMentionIdx(0)
    } else {
      setShowMentionMenu(false)
    }
  }

  // Insert selected mention tag into prompt
  const insertMention = (item: (typeof mentionItems)[0]) => {
    const textarea = promptTextareaRef.current
    const cursor = textarea?.selectionStart ?? genPrompt.length
    const startPos = mentionStartIndex >= 0 ? mentionStartIndex : cursor
    const textBefore = genPrompt.slice(0, startPos)
    const textAfter = genPrompt.slice(cursor)
    const newText = `${textBefore}${item.tag} ${textAfter}`
    setGenPrompt(newText)
    setShowMentionMenu(false)

    // If character was selected and has an image, auto-attach to references if not already there
    if (item.character?.imageFile && refImages.length < maxRefImages) {
      const charImgUrl = `/api/videogen/characters?file=${encodeURIComponent(item.character.imageFile)}`
      if (!refImages.includes(charImgUrl)) {
        setRefImages((prev) => [...prev, charImgUrl])
        toast.success(`Attached ${item.character.name}'s reference portrait to slot #${refImages.length + 1}`)
      }
    }

    // Set cursor position after the inserted tag
    setTimeout(() => {
      if (textarea) {
        const newCursorPos = (textBefore + item.tag + ' ').length
        textarea.focus()
        textarea.setSelectionRange(newCursorPos, newCursorPos)
      }
    }, 10)
  }

  // Handle keyboard navigation in mention menu
  const handlePromptKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!showMentionMenu || mentionItems.length === 0) return

    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedMentionIdx((prev) => (prev + 1) % mentionItems.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedMentionIdx((prev) => (prev - 1 + mentionItems.length) % mentionItems.length)
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault()
      const selected = mentionItems[selectedMentionIdx]
      if (selected) {
        insertMention(selected)
      }
    } else if (e.key === 'Escape') {
      setShowMentionMenu(false)
    }
  }

  // Close mention menu on outside click
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (
        mentionMenuRef.current &&
        !mentionMenuRef.current.contains(e.target as Node) &&
        promptTextareaRef.current &&
        !promptTextareaRef.current.contains(e.target as Node)
      ) {
        setShowMentionMenu(false)
      }
    }
    document.addEventListener('mousedown', handleOutsideClick)
    return () => document.removeEventListener('mousedown', handleOutsideClick)
  }, [])

  // Navigation & Drawer states
  const [leftNavCollapsed, setLeftNavCollapsed] = useState(false)
  const [showCharModal, setShowCharModal] = useState(false)
  const [showPodDrawer, setShowPodDrawer] = useState(false)
  const [showPodLogsModal, setShowPodLogsModal] = useState(false)
  const [inspectorPodId, setInspectorPodId] = useState<string | undefined>(undefined)
  const [showPromptBuilder, setShowPromptBuilder] = useState(false)
  const [show4kModal, setShow4kModal] = useState(false)
  const [selectedTier, setSelectedTier] = useState<'standard' | 'ultra_4k'>('standard')
  const [promptBuilderIsWide, setPromptBuilderIsWide] = useState(false)
  const [isSwitchingPod, setIsSwitchingPod] = useState(false)
  const [promptBuilderType, setPromptBuilderType] = useState<'scene' | 'character' | 'movie'>('scene')
  const [inspectProject, setInspectProject] = useState<typeof PUBLISHED_PROJECTS[0] | null>(null)

  // New character form state
  const [charName, setCharName] = useState('')
  const [charDesc, setCharDesc] = useState('')
  const [charNotes, setCharNotes] = useState('')
  const [charVoiceId, setCharVoiceId] = useState('')
  const [charRefFile, setCharRefFile] = useState<File | null>(null)
  const [charTurnaroundFiles, setCharTurnaroundFiles] = useState<File[]>([])
  const [charVoiceFile, setCharVoiceFile] = useState<File | null>(null)
  const [savingChar, setSavingChar] = useState(false)
  const [upscalingJobs, setUpscalingJobs] = useState<Record<string, boolean>>({})

  const handleUpscaleClip = async (jobId: string, filename: string) => {
    if (upscalingJobs[jobId]) return
    setUpscalingJobs((prev) => ({ ...prev, [jobId]: true }))
    toast.info('✨ Upscaling video to 4K Ultra HD (Real-ESRGAN / Lanczos)...')
    try {
      const res = await fetch('/api/videogen/upscale', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename, targetResolution: '4k' }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Upscaling failed')

      setJobs((prev) =>
        prev.map((j) => {
          if (j.id === jobId) {
            return { ...j, filename: data.filename, label: `${j.label || 'Shot'} (✨ 4K Ultra HD)` }
          }
          return j
        })
      )
      toast.success('🎉 4K Ultra HD Upscale Complete!')
    } catch (err: any) {
      toast.error(`Upscale failed: ${err.message}`)
    } finally {
      setUpscalingJobs((prev) => ({ ...prev, [jobId]: false }))
    }
  }

  // Fetch status & data
  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/videogen', { cache: 'no-store' })
      if (!res.ok) throw new Error('Status check failed')
      const data = await res.json()
      setPods({ ltx: data.ltx || null, minimax: data.minimax || null })
      setDeployError({ ltx25: null, minimax: null })
    } catch {
      // ignore
    }
  }, [])

  const loadProjects = useCallback(async () => {
    try {
      const res = await fetch('/api/videogen/projects', { cache: 'no-store' })
      if (res.ok) {
        const d = await res.json()
        setProjects(d.projects ?? [])
      }
    } catch {
      // ignore
    }
  }, [])

  const loadCharacters = useCallback(async () => {
    try {
      const res = await fetch('/api/videogen/characters', { cache: 'no-store' })
      if (res.ok) setCharacters((await res.json()).characters ?? [])
    } catch {
      // ignore
    }
  }, [])

  const loadFilms = useCallback(async () => {
    try {
      const res = await fetch('/api/videogen/assemble', { cache: 'no-store' })
      if (res.ok) setFilms((await res.json()).films ?? [])
    } catch {
      // ignore
    }
  }, [])

  const loadGenerations = useCallback(async (projId?: string) => {
    try {
      const targetProj = projId ?? activeProjectId
      const [gRes, fRes] = await Promise.all([
        fetch(`/api/videogen/generate?projectId=${encodeURIComponent(targetProj || 'all')}`, { cache: 'no-store' }),
        fetch('/api/videogen/assemble', { cache: 'no-store' }),
      ])
      if (gRes.ok) {
        const gData = await gRes.json()
        if (gData.jobs) setJobs(gData.jobs)
      }
      if (fRes.ok) {
        const fData = await fRes.json()
        if (fData.films) setFilms(fData.films)
      }
    } catch {
      // ignore
    }
  }, [activeProjectId])

  const loadVoices = useCallback(async () => {
    try {
      const res = await fetch('/api/videogen/voices', { cache: 'no-store' })
      if (res.ok) setVoices((await res.json()).voices ?? [])
    } catch {
      // ignore
    }
  }, [])

  useEffect(() => {
    ;(async () => {
      try {
        await Promise.all([fetchStatus(), loadProjects(), loadCharacters(), loadFilms(), loadVoices(), loadGenerations()])
      } catch {
        // ignore
      } finally {
        setInitialLoading(false)
      }
    })()

    // Auto-poll GPU pod status every 15s so node states stay in sync
    const interval = setInterval(fetchStatus, 15_000)
    return () => clearInterval(interval)
  }, [fetchStatus, loadProjects, loadCharacters, loadFilms, loadVoices, loadGenerations])

  // Re-fetch generations when activeTab becomes 'generations' or activeProjectId changes
  useEffect(() => {
    if (activeTab === 'generations') {
      loadGenerations()
    }
  }, [activeTab, activeProjectId, loadGenerations])

  const createProject = async () => {
    if (!newProjectName.trim()) return
    try {
      const res = await fetch('/api/videogen/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newProjectName.trim() })
      })
      if (res.ok) {
        const d = await res.json()
        setProjects(prev => [...prev, d.project])
        setActiveProjectId(d.project.id)
        setNewProjectName('')
        setShowNewProjectModal(false)
      }
    } catch {
      // ignore
    }
  }

  const saveCharacterHandler = async () => {
    if (!charName.trim()) return
    setSavingChar(true)
    try {
      const fd = new FormData()
      fd.append('name', charName.trim())
      fd.append('description', charDesc.trim())
      fd.append('styleSheetNotes', charNotes.trim())
      fd.append('voiceId', charVoiceId.trim())
      if (charRefFile) fd.append('image', charRefFile)
      for (const f of charTurnaroundFiles) {
        fd.append('turnaroundImages', f)
      }
      if (charVoiceFile) fd.append('voiceSample', charVoiceFile)

      const res = await fetch('/api/videogen/characters', { method: 'POST', body: fd })
      if (res.ok) {
        setCharName('')
        setCharDesc('')
        setCharNotes('')
        setCharVoiceId('')
        setCharRefFile(null)
        setCharTurnaroundFiles([])
        setCharVoiceFile(null)
        await loadCharacters()
      }
    } catch {
      // ignore
    } finally {
      setSavingChar(false)
    }
  }

  const deleteCharHandler = (id: string) => {
    showConfirmModal({
      title: 'Delete Character',
      message: 'Are you sure you want to delete this character and their reference style sheet?',
      confirmText: '🗑️ Delete Character',
      type: 'danger',
      onConfirm: async () => {
        await fetch(`/api/videogen/characters?id=${id}`, { method: 'DELETE' })
        await loadCharacters()
        toast.success('Character deleted.')
      },
    })
  }

  // Generation trigger
  const generate = useCallback(async (opts: { prompt: string; label: string; seconds: number }) => {
    setSubmitting(true)
    setGenError(null)
    const r = RESOLUTIONS[genRes] ?? RESOLUTIONS[0]
    
    try {
      const res = await fetch('/api/videogen/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: opts.prompt,
          seconds: opts.seconds,
          width: r.w,
          height: r.h,
          characterId: selectedCharacterId || undefined,
          cameraMotion: cameraMotion !== 'Auto' ? cameraMotion : undefined,
          colorPalette: colorPalette !== 'Auto' ? colorPalette : undefined,
          lighting: lighting !== 'Auto' ? lighting : undefined,
          model: selectedModel,
          projectId: activeProjectId,
          referenceImages: refImages.length > 0 ? refImages : undefined,
        }),
      })
      const text = await res.text()
      let data: any = {}
      try {
        data = JSON.parse(text)
      } catch {
        if (text.includes('<html') || text.includes('502') || text.includes('Bad Gateway') || res.status === 502) {
          throw new Error('GPU Pod is still initializing (booting ComfyUI & model weights). Please wait ~30-45 seconds and click Generate again.')
        }
        throw new Error(`Server returned error (${res.status}): ${text.slice(0, 120)}`)
      }
      if (!res.ok || data.error) throw new Error(data.error || 'Generation failed')

      setJobs(prev => [{
        id: `${data.promptId}`,
        promptId: data.promptId,
        label: opts.label,
        prompt: opts.prompt,
        seconds: opts.seconds,
        state: 'queued' as const,
        startedAt: Date.now(),
      }, ...prev])
    } catch (e) {
      const msg = (e as Error).message
      setGenError(msg)
      toast.error(msg)
    } finally {
      setSubmitting(false)
    }
  }, [genRes, selectedCharacterId, cameraMotion, colorPalette, lighting, selectedModel, activeProjectId, refImages])

  // Poll pending
  const pending = jobs.filter(j => j.state === 'queued' || j.state === 'running')
  const pendingKey = pending.map(j => j.promptId).join(',')

  useEffect(() => {
    if (!pendingKey) return
    let cancelled = false

    const tick = async () => {
      try {
        const res = await fetch(`/api/videogen/status?ids=${pendingKey}`, { cache: 'no-store' })
        if (!res.ok) return
        const data = await res.json()
        if (cancelled || !data.jobs) return
        setJobs(prev => prev.map(j => {
          const u = data.jobs[j.promptId]
          return u ? { ...j, ...u } : j
        }))
      } catch {
        // ignore
      }
    }

    tick()
    const iv = setInterval(tick, 4000)
    return () => { cancelled = true; clearInterval(iv) }
  }, [pendingKey])

  const [promptDeployConflict, setPromptDeployConflict] = useState<{
    targetTier: 'standard' | 'ultra_4k'
    existingPod: any
  } | null>(null)

  // Deploy / Actions handlers
  const deploy = async (model: Model, tier: 'standard' | 'ultra_4k' = selectedTier, terminatePodId?: string) => {
    const isLtx = model === 'ltx25'
    setDeploying(prev => ({ ...prev, [isLtx ? 'ltx25' : 'minimax']: true }))
    setDeployingTier(tier)
    setDeployError(prev => ({ ...prev, [isLtx ? 'ltx25' : 'minimax']: null }))
    const modelTitle = isLtx ? (tier === 'ultra_4k' ? 'LTX 2.5 Ultra 4K (48GB+)' : 'LTX 2.5 Standard (24GB)') : 'MiniMax Hailuo 3 (48GB+)'
    setDeployLogs([{ level: 'info', text: `Initiating ${modelTitle} deployment on RunPod...` }])
    try {
      const res = await fetch('/api/videogen/pod', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'up', tier, model, terminatePodId }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Deployment failed')
      }
      if (res.body) {
        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buf = ''
        for (;;) {
          const { value, done } = await reader.read()
          if (done) break
          buf += decoder.decode(value, { stream: true })
          const lines = buf.split('\n')
          buf = lines.pop() ?? ''
          for (const raw of lines) {
            if (!raw.trim()) continue
            try {
              const line = JSON.parse(raw)
              if (line.level === 'done') {
                toast.success(`${modelTitle} Node is ready!`)
                await fetchStatus()
              } else {
                setDeployLogs(prev => [...prev, line])
              }
            } catch {
              // ignore parse errors
            }
          }
        }
      }
      await fetchStatus()
    } catch (e) {
      setDeployError(prev => ({ ...prev, [isLtx ? 'ltx25' : 'minimax']: (e as Error).message }))
      setDeployLogs(prev => [...prev, { level: 'error', text: (e as Error).message }])
    } finally {
      setDeploying(prev => ({ ...prev, [isLtx ? 'ltx25' : 'minimax']: false }))
      setDeployingTier(null)
      setShow4kModal(false)
      setPromptDeployConflict(null)
      await fetchStatus()
    }
  }

  const handleTierDeployRequest = (tier: 'standard' | 'ultra_4k') => {
    if (ltxRunning && pods.ltx) {
      setPromptDeployConflict({ targetTier: tier, existingPod: pods.ltx })
      return
    }
    deploy('ltx25', tier)
  }

  const handleResolutionChange = (val: number) => {
    const chosen = RESOLUTIONS[val]
    if (chosen && chosen.w >= 3840) {
      const activePod = selectedModel === 'minimax' ? pods.minimax : pods.ltx
      const gpuName = getPodGpuName(activePod)
      const vram = getPodVram(activePod)
      const isUltra =
        vram >= 48 ||
        gpuName.includes('A100') ||
        gpuName.includes('A6000') ||
        gpuName.includes('A40') ||
        gpuName.includes('L40') ||
        Number(activePod?.costPerHr ?? 0) >= 0.50

      if (ltxRunning && !isUltra) {
        setShow4kModal(true)
        return
      }
    }
    setGenRes(val)
  }

  const podAction = async (model: Model, action: string) => {
    const isLtx = model === 'ltx25'
    setActionLoading(prev => ({ ...prev, [isLtx ? 'ltx25' : 'minimax']: action }))
    try {
      const res = await fetch('/api/videogen', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, action }),
      })
      if (!res.ok) throw new Error((await res.json()).error || 'Action failed')
      await fetchStatus()
    } catch (e) {
      setDeployError(prev => ({ ...prev, [isLtx ? 'ltx25' : 'minimax']: (e as Error).message }))
    } finally {
      setActionLoading(prev => ({ ...prev, [isLtx ? 'ltx25' : 'minimax']: null }))
    }
  }

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text)
    setCopied(id)
    setTimeout(() => setCopied(null), 2000)
  }

  const ltxRunning = pods.ltx?.desiredStatus === 'RUNNING' && !!pods.ltx.runtime
  const minimaxRunning = pods.minimax?.desiredStatus === 'RUNNING' && !!pods.minimax.runtime

  const activeProjectName = projects.find(p => p.id === activeProjectId)?.name ?? 'Default Project'

  return (
    <div style={{ display: 'flex', background: '#05080e', minHeight: '100vh', color: '#F2F5FA', fontFamily: 'var(--font-body)', position: 'relative' }}>
      {/* ── Left Sidebar Navigation (Collapsible & Expandable) ── */}
      <aside style={{
        width: leftNavCollapsed ? '68px' : '240px',
        background: '#070c14',
        borderRight: '1px solid #1a2840',
        padding: leftNavCollapsed ? '1.25rem 0.5rem' : '1.5rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '1.75rem',
        flexShrink: 0,
        transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
        overflow: 'hidden',
      }}>
        {/* Brand / Title & Collapse Toggle */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: leftNavCollapsed ? 'center' : 'space-between', gap: '0.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', overflow: 'hidden' }}>
            <span style={{ fontSize: '1.4rem', flexShrink: 0 }}>🌌</span>
            {!leftNavCollapsed && (
              <div style={{ whiteSpace: 'nowrap' }}>
                <h1 style={{ fontSize: '14px', fontWeight: 800, fontFamily: 'var(--font-display)', color: 'var(--gold)', letterSpacing: '0.04em', margin: 0 }}>
                  CINEMA STUDIO
                </h1>
                <p style={{ fontSize: '9px', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.08em', margin: 0 }}>
                  AI Movie Engine
                </p>
              </div>
            )}
          </div>
          <button
            onClick={() => setLeftNavCollapsed(!leftNavCollapsed)}
            title={leftNavCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            style={{
              background: 'rgba(255,255,255,0.05)',
              border: '1px solid #1a2840',
              borderRadius: '0.35rem',
              color: '#94a3b8',
              padding: '0.25rem 0.45rem',
              fontSize: '10px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            {leftNavCollapsed ? '▶' : '◀'}
          </button>
        </div>

        {/* Menu Links */}
        <nav style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
          {[
            { id: 'home', label: 'Home', icon: '🏠' },
            { id: 'singing', label: 'Singing & Music Studio', icon: '🎤' },
            { id: 'generations', label: 'My generations', icon: '🖼️' },
            { id: 'characters', label: 'Characters', icon: '👤' },
            { id: 'engines', label: 'AI Engines & Pods', icon: '⚡' },
            { id: 'usage', label: 'Usage & Costs', icon: '📊' },
          ].map(item => {
            const active = activeTab === item.id
            return (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id as typeof activeTab)}
                title={leftNavCollapsed ? item.label : undefined}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: leftNavCollapsed ? 'center' : 'flex-start',
                  gap: '0.85rem',
                  padding: leftNavCollapsed ? '0.65rem' : '0.65rem 0.85rem',
                  borderRadius: '0.5rem',
                  fontSize: '13px',
                  border: 'none',
                  textAlign: 'left',
                  cursor: 'pointer',
                  fontWeight: active ? 700 : 500,
                  background: active ? 'rgba(232, 185, 74, 0.1)' : 'transparent',
                  color: active ? 'var(--gold)' : '#96A3B6',
                  whiteSpace: 'nowrap',
                  transition: 'all 0.15s ease',
                }}
              >
                <span style={{ fontSize: '1.1rem' }}>{item.icon}</span>
                {!leftNavCollapsed && <span>{item.label}</span>}
              </button>
            )
          })}

          <Link
            href="/studio"
            title={leftNavCollapsed ? 'Movie Studio' : undefined}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: leftNavCollapsed ? 'center' : 'flex-start',
              gap: '0.85rem',
              padding: leftNavCollapsed ? '0.65rem' : '0.65rem 0.85rem',
              borderRadius: '0.5rem',
              fontSize: '13px',
              textDecoration: 'none',
              fontWeight: 600,
              color: 'var(--gold)',
              background: 'rgba(232, 185, 74, 0.05)',
              marginTop: '0.5rem',
              border: '1px solid rgba(232, 185, 74, 0.2)',
              whiteSpace: 'nowrap',
            }}
          >
            <span style={{ fontSize: '1.1rem' }}>🎥</span>
            {!leftNavCollapsed && <span>Movie Studio →</span>}
          </Link>
        </nav>
      </aside>

      {/* ── Main Panel Area ── */}
      {/* ── Main Content Area (Dynamically adjusts margin when right drawer opens to eliminate overlap) ── */}
      <main
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          overflowY: 'auto',
          minWidth: 0,
          marginRight: showPromptBuilder ? (promptBuilderIsWide ? 'min(620px, 92vw)' : 'min(440px, 92vw)') : 0,
          transition: 'margin-right 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
        }}
      >
        
        {/* Top Header Row */}
        <header style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '1rem 2rem', borderBottom: '1px solid #1a2840', background: '#05080e', flexWrap: 'wrap', gap: '0.75rem'
        }}>
          {/* Projects Selector in Top Header */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <span style={{ fontSize: '11px', color: '#64748b', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.08em' }}>Project:</span>
            <select value={activeProjectId} onChange={e => {
              if (e.target.value === '__new__') setShowNewProjectModal(true)
              else setActiveProjectId(e.target.value)
            }} style={{
              background: '#070c14', border: '1px solid #1a2840', borderRadius: '0.5rem',
              color: 'var(--gold)', fontWeight: 700, fontSize: '13px', padding: '0.45rem 0.85rem', outline: 'none', cursor: 'pointer'
            }}>
              {projects.map(p => (
                <option key={p.id} value={p.id} style={{ background: '#070c14' }}>📁 {p.name}</option>
              ))}
              <option value="__new__" style={{ background: '#070c14', color: 'var(--gold)' }}>+ Create New Project...</option>
            </select>
          </div>

          {/* Action Tools & Pod State Banner */}
          <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
            {/* Top Header Live GPU Indicator */}
            {(() => {
              const anyRunning = ltxRunning || minimaxRunning
              let label = 'GPU Pods: Inactive (Launch Node)'
              if (ltxRunning && minimaxRunning) {
                label = `● 2 Nodes Active: LTX & MiniMax ($${(Number(pods.ltx?.costPerHr || 0.54) + Number(pods.minimax?.costPerHr || 0.54)).toFixed(2)}/hr)`
              } else if (ltxRunning && pods.ltx) {
                label = `● LTX 2.5: ${getPodGpuName(pods.ltx)} (${getPodVram(pods.ltx)}GB · $${Number(pods.ltx.costPerHr || 0.54).toFixed(2)}/hr)`
              } else if (minimaxRunning && pods.minimax) {
                label = `● MiniMax H3: ${getPodGpuName(pods.minimax)} (${getPodVram(pods.minimax)}GB · $${Number(pods.minimax.costPerHr || 0.54).toFixed(2)}/hr)`
              }

              return (
                <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                  <button onClick={() => setShowPodDrawer(!showPodDrawer)} style={{
                    display: 'flex', alignItems: 'center', gap: '0.45rem', fontSize: '11px', fontWeight: 800,
                    padding: '0.42rem 0.85rem', borderRadius: '0.5rem',
                    border: `1px solid ${anyRunning ? 'rgba(74,222,128,0.4)' : 'rgba(232,185,74,0.35)'}`,
                    background: anyRunning ? 'rgba(74,222,128,0.1)' : '#070c14',
                    color: anyRunning ? '#4ade80' : 'var(--gold)', cursor: 'pointer',
                    boxShadow: anyRunning ? '0 0 12px rgba(74,222,128,0.15)' : 'none',
                    transition: 'all 0.2s ease',
                  }}
                  title="Click to manage GPU Compute Nodes"
                  >
                    <span style={{ fontSize: '9px', color: anyRunning ? '#4ade80' : '#64748b' }}>
                      {anyRunning ? '●' : '⚡'}
                    </span>
                    <span>{label}</span>
                  </button>

                  {anyRunning && (
                    <button
                      onClick={() => {
                        setInspectorPodId(pods.minimax?.id || pods.ltx?.id)
                        setShowPodLogsModal(true)
                      }}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.35rem',
                        fontSize: '11px',
                        fontWeight: 800,
                        padding: '0.42rem 0.75rem',
                        borderRadius: '0.5rem',
                        border: '1px solid rgba(59, 130, 246, 0.4)',
                        background: 'rgba(59, 130, 246, 0.12)',
                        color: '#93c5fd',
                        cursor: 'pointer',
                        transition: 'all 0.2s ease',
                      }}
                      title="Open Real-time GPU Pod Console & Logs"
                    >
                      <span>📟</span>
                      <span>Live Logs</span>
                    </button>
                  )}
                </div>
              )
            })()}

            <Link href="/movie" style={{
              fontSize: '11px', textDecoration: 'none', fontWeight: 700, color: 'var(--gold)',
              padding: '0.45rem 0.85rem', borderRadius: '0.5rem',
              border: '1px solid rgba(232,185,74,0.25)', background: 'rgba(232,185,74,0.06)',
            }}>
              🎬 Movie Studio →
            </Link>

            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <div style={{ width: '28px', height: '28px', borderRadius: '50%', background: 'var(--gold)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#05080e', fontWeight: 'bold', fontSize: '11px' }}>
                SR
              </div>
              <button
                onClick={handleLogout}
                style={{
                  background: 'none', border: '1px solid #1a2840', color: '#94a3b8',
                  borderRadius: '0.4rem', padding: '0.35rem 0.65rem', fontSize: '11px',
                  fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.3rem'
                }}
                title="Sign out of Cinema Studio"
              >
                <span>🚪</span> Sign Out
              </button>
            </div>
          </div>
        </header>

        {/* ── Main Content Body ── */}
        <div style={{ padding: '2.5rem', maxWidth: '64rem', margin: '0 auto', width: '100%' }}>

          {/* Tab 1: HOME GENERATION VIEW */}
          <div style={{ display: activeTab === 'home' ? 'block' : 'none' }}>
            <>
              <div style={{ textAlign: 'center', marginBottom: '2.5rem' }}>
                <h2 style={{
                  fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '1.85rem',
                  letterSpacing: '-0.02em', color: '#F2F5FA', textTransform: 'uppercase', marginBottom: '1.25rem'
                }}>
                  BRING YOUR STORIES TO LIFE
                </h2>
                <div style={{ display: 'flex', justifyContent: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                  {characters.length > 0 ? (
                    characters.slice(0, 5).map(c => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => {
                          const clean = c.name.replace(/[^\w]/g, '')
                          setGenPrompt(prev => prev ? `${prev.trim()} @${clean} ` : `@${clean} `)
                          toast.info(`Added @${clean} to prompt`)
                        }}
                        style={{
                          background: '#121F35',
                          border: '1px solid #1e3a5f',
                          color: '#93c5fd',
                          fontSize: '11px',
                          padding: '0.2rem 0.6rem',
                          borderRadius: '0.25rem',
                          cursor: 'pointer',
                          fontWeight: 600,
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '0.3rem',
                        }}
                      >
                        <span>👤 @{c.name}</span>
                      </button>
                    ))
                  ) : (
                    <>
                      <span style={{ fontSize: '11px', background: '#121F35', padding: '0.2rem 0.6rem', borderRadius: '0.25rem', color: '#94a3b8' }}>Zephyr</span>
                      <span style={{ fontSize: '11px', background: '#121F35', padding: '0.2rem 0.6rem', borderRadius: '0.25rem', color: '#94a3b8' }}>Cully Hill Boys</span>
                      <span style={{ fontSize: '11px', background: '#121F35', padding: '0.2rem 0.6rem', borderRadius: '0.25rem', color: '#94a3b8' }}>Hell Grind</span>
                    </>
                  )}
                </div>
              </div>

              {/* Generation Input Box */}
              <div style={{
                background: 'rgba(14,23,38,0.75)', border: '1px solid #1a2840', borderRadius: '1.25rem',
                padding: '1.5rem', boxShadow: '0 12px 32px rgba(0,0,0,0.5)', backdropFilter: 'blur(16px)',
                marginBottom: '2.5rem'
              }}>
                <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
                  {/* AI Engine Model Selector */}
                  <div style={{
                    flex: 1.15, minWidth: '135px', background: '#070c14',
                    border: `1px solid ${selectedModel === 'minimax' ? 'rgba(232,185,74,0.45)' : 'rgba(59,130,246,0.45)'}`,
                    borderRadius: '0.5rem', padding: '0.5rem 0.75rem', display: 'flex',
                    alignItems: 'center', gap: '0.5rem', justifyContent: 'space-between',
                    boxShadow: selectedModel === 'minimax' ? '0 0 10px rgba(232,185,74,0.1)' : '0 0 10px rgba(59,130,246,0.1)'
                  }}>
                    <div style={{ width: '100%' }}>
                      <p style={{ fontSize: '9px', color: selectedModel === 'minimax' ? 'var(--gold)' : '#93c5fd', textTransform: 'uppercase', margin: 0, fontWeight: 800 }}>
                        {selectedModel === 'minimax' ? '🌟 AI Model' : '⚡ AI Model'}
                      </p>
                      <select
                        value={selectedModel}
                        onChange={e => setSelectedModel(e.target.value as 'ltx25' | 'minimax')}
                        style={{
                          background: 'none', border: 'none', color: '#F2F5FA', fontSize: '11px', fontWeight: 700, outline: 'none', padding: 0, width: '100%', cursor: 'pointer'
                        }}
                      >
                        <option value="ltx25" style={{ background: '#070c14' }}>LTX-Video 2.5</option>
                        <option value="minimax" style={{ background: '#070c14' }}>MiniMax Hailuo 3</option>
                      </select>
                    </div>
                  </div>

                  {/* References Selector */}
                  <div onClick={() => setShowCharModal(true)} style={{
                    flex: 1, minWidth: '110px', background: '#070c14', border: '1px solid #1a2840',
                    borderRadius: '0.5rem', padding: '0.5rem 0.75rem', cursor: 'pointer', display: 'flex',
                    alignItems: 'center', gap: '0.5rem', justifyContent: 'space-between'
                  }}>
                    <div>
                      <p style={{ fontSize: '9px', color: '#64748b', textTransform: 'uppercase', margin: 0, fontWeight: 700 }}>Character</p>
                      <p style={{ fontSize: '11px', color: '#F2F5FA', margin: 0, fontWeight: 600 }}>
                        {selectedCharacterId ? characters.find(c => c.id === selectedCharacterId)?.name : 'None Linked'}
                      </p>
                    </div>
                    <span style={{ fontSize: '10px', color: '#64748b' }}>▼</span>
                  </div>

                  {/* Film setup */}
                  <div style={{
                    flex: 1, minWidth: '110px', background: '#070c14', border: '1px solid #1a2840',
                    borderRadius: '0.5rem', padding: '0.5rem 0.75rem', display: 'flex',
                    alignItems: 'center', gap: '0.5rem', justifyContent: 'space-between'
                  }}>
                    <div>
                      <p style={{ fontSize: '9px', color: '#64748b', textTransform: 'uppercase', margin: 0, fontWeight: 700 }}>Resolution</p>
                      <select value={genRes} onChange={e => handleResolutionChange(Number(e.target.value))} style={{
                        background: 'none', border: 'none', color: '#F2F5FA', fontSize: '11px', fontWeight: 600, outline: 'none', padding: 0
                      }}>
                        {RESOLUTIONS.map((r, i) => <option key={r.label} value={i} style={{ background: '#070c14' }}>{r.label.split('·')[0]}</option>)}
                      </select>
                    </div>
                  </div>

                  {/* Camera Motion */}
                  <div style={{
                    flex: 1, minWidth: '110px', background: '#070c14', border: '1px solid #1a2840',
                    borderRadius: '0.5rem', padding: '0.5rem 0.75rem', display: 'flex',
                    alignItems: 'center', gap: '0.5rem', justifyContent: 'space-between'
                  }}>
                    <div>
                      <p style={{ fontSize: '9px', color: '#64748b', textTransform: 'uppercase', margin: 0, fontWeight: 700 }}>Camera</p>
                      <select value={cameraMotion} onChange={e => setCameraMotion(e.target.value)} style={{
                        background: 'none', border: 'none', color: '#F2F5FA', fontSize: '11px', fontWeight: 600, outline: 'none', padding: 0
                      }}>
                        <option value="Auto" style={{ background: '#070c14' }}>Auto (Dynamic)</option>
                        <option value="dolly_in" style={{ background: '#070c14' }}>Slow Push In</option>
                        <option value="dolly_out" style={{ background: '#070c14' }}>Pull Back Reveal</option>
                        <option value="zoom_in" style={{ background: '#070c14' }}>Orbit</option>
                        <option value="crane" style={{ background: '#070c14' }}>Crane Down</option>
                      </select>
                    </div>
                  </div>

                  {/* Color Palette */}
                  <div style={{
                    flex: 1, minWidth: '110px', background: '#070c14', border: '1px solid #1a2840',
                    borderRadius: '0.5rem', padding: '0.5rem 0.75rem', display: 'flex',
                    alignItems: 'center', gap: '0.5rem', justifyContent: 'space-between'
                  }}>
                    <div>
                      <p style={{ fontSize: '9px', color: '#64748b', textTransform: 'uppercase', margin: 0, fontWeight: 700 }}>Grade</p>
                      <select value={colorPalette} onChange={e => setColorPalette(e.target.value)} style={{
                        background: 'none', border: 'none', color: '#F2F5FA', fontSize: '11px', fontWeight: 600, outline: 'none', padding: 0
                      }}>
                        <option value="Auto" style={{ background: '#070c14' }}>Auto</option>
                        <option value="Luxury Warm" style={{ background: '#070c14' }}>Luxury Gold</option>
                        <option value="Teal Orange" style={{ background: '#070c14' }}>Teal & Orange</option>
                        <option value="Noir" style={{ background: '#070c14' }}>Film Noir</option>
                      </select>
                    </div>
                  </div>
                </div>

                {/* Prompt toolbar & AI Generator */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
                  <label style={{ fontSize: '10px', color: '#64748b', textTransform: 'uppercase', fontWeight: 700, margin: 0 }}>
                    Scene Prompt
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      setPromptBuilderType('scene')
                      setShowPromptBuilder(true)
                    }}
                    style={{
                      background: 'rgba(232,185,74,0.12)',
                      border: '1px solid rgba(232,185,74,0.35)',
                      color: 'var(--gold)',
                      borderRadius: '0.4rem',
                      padding: '0.25rem 0.6rem',
                      fontSize: '10.5px',
                      fontWeight: 800,
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.35rem',
                    }}
                  >
                    <span>✨ AI Director Prompt</span>
                  </button>
                </div>

                {/* Prompt input */}
                <div style={{ display: 'flex', gap: '1rem', alignItems: 'stretch' }}>
                  <div style={{ flex: 1, position: 'relative' }}>
                    <textarea
                      ref={promptTextareaRef}
                      value={genPrompt}
                      onChange={handlePromptChange}
                      onKeyDown={handlePromptKeyDown}
                      placeholder="Describe your scene — type @ to reference attached images, characters, or audio..."
                      style={{
                        width: '100%', height: '90px', background: '#070c14', border: '1px solid #1a2840',
                        borderRadius: '0.75rem', padding: '0.85rem', color: '#F2F5FA', fontSize: '13px',
                        outline: 'none', resize: 'none', fontFamily: 'inherit'
                      }}
                    />

                    {/* @ Mention Autocomplete Popover */}
                    {showMentionMenu && mentionItems.length > 0 && (
                      <div
                        ref={mentionMenuRef}
                        style={{
                          position: 'absolute',
                          bottom: '100%',
                          left: 0,
                          marginBottom: '0.4rem',
                          width: 'min(440px, 100%)',
                          maxHeight: '260px',
                          overflowY: 'auto',
                          background: '#070d18',
                          border: '1px solid #223554',
                          borderRadius: '0.75rem',
                          boxShadow: '0 12px 30px rgba(0,0,0,0.8), 0 0 16px rgba(232,185,74,0.18)',
                          backdropFilter: 'blur(20px)',
                          zIndex: 60,
                          padding: '0.4rem',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '0.25rem',
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.35rem 0.5rem 0.25rem', borderBottom: '1px solid #142033' }}>
                          <span style={{ fontSize: '10px', color: 'var(--gold)', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                            ✨ Insert Reference Mention
                          </span>
                          <span style={{ fontSize: '9.5px', color: '#64748b' }}>
                            ↑↓ to navigate · ↵ / Tab to select
                          </span>
                        </div>

                        {mentionItems.map((item, idx) => {
                          const isSelected = idx === selectedMentionIdx
                          return (
                            <div
                              key={item.id}
                              onMouseDown={(e) => {
                                e.preventDefault()
                                insertMention(item)
                              }}
                              onMouseEnter={() => setSelectedMentionIdx(idx)}
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '0.65rem',
                                padding: '0.45rem 0.6rem',
                                borderRadius: '0.5rem',
                                background: isSelected ? 'rgba(232,185,74,0.14)' : 'transparent',
                                border: `1px solid ${isSelected ? 'rgba(232,185,74,0.35)' : 'transparent'}`,
                                cursor: 'pointer',
                                transition: 'all 0.15s ease',
                              }}
                            >
                              {/* Thumbnail / Icon */}
                              {item.image ? (
                                <div style={{ width: '32px', height: '32px', borderRadius: '0.35rem', overflow: 'hidden', border: '1px solid rgba(232,185,74,0.4)', flexShrink: 0, background: '#000' }}>
                                  <img src={item.image} alt={item.label} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                </div>
                              ) : (
                                <div style={{ width: '32px', height: '32px', borderRadius: '0.35rem', background: '#0e182e', border: '1px solid #1a2840', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '14px', flexShrink: 0 }}>
                                  {item.icon || '🏷️'}
                                </div>
                              )}

                              {/* Label & Details */}
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                                  <span style={{ fontSize: '12px', fontWeight: 800, color: isSelected ? 'var(--gold)' : '#F2F5FA' }}>
                                    {item.tag}
                                  </span>
                                  <span style={{ fontSize: '10px', color: '#94a3b8', fontWeight: 600 }}>
                                    · {item.label}
                                  </span>
                                </div>
                                {item.subtitle && (
                                  <p style={{ fontSize: '10px', color: '#64748b', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    {item.subtitle}
                                  </p>
                                )}
                              </div>

                              {/* Category Badge */}
                              <span style={{
                                fontSize: '9px',
                                background: item.category === 'Attached Images' ? 'rgba(232,185,74,0.18)' : item.category === 'Project Characters' ? 'rgba(59,130,246,0.18)' : 'rgba(255,255,255,0.06)',
                                color: item.category === 'Attached Images' ? 'var(--gold)' : item.category === 'Project Characters' ? '#93c5fd' : '#94a3b8',
                                padding: '0.15rem 0.4rem',
                                borderRadius: '0.25rem',
                                fontWeight: 700,
                                flexShrink: 0,
                              }}>
                                {item.category === 'Attached Images' ? 'ATTACHED' : item.category === 'Project Characters' ? 'CHARACTER' : 'TAG'}
                              </span>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>

                  <button
                    onClick={() => generate({ prompt: genPrompt, label: 'Custom Shot', seconds: genSeconds })}
                    disabled={submitting || !genPrompt.trim()}
                    style={{
                      width: '120px', background: 'var(--gold)', color: '#05080e', border: 'none',
                      borderRadius: '0.75rem', fontWeight: 800, fontSize: '13px', cursor: 'pointer',
                      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '0.2rem'
                    }}
                  >
                    <span>⚡ {submitting ? 'Generating...' : 'GENERATE'}</span>
                    <span style={{ fontSize: '10px', opacity: 0.7 }}>45 credits</span>
                  </button>
                </div>

                {/* ── Multi-Reference Image Attachment (Omni-Ref up to 9 for MiniMax, up to 5 for LTX) ── */}
                <div style={{ marginTop: '0.85rem', paddingTop: '0.75rem', borderTop: '1px solid #142033' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <span style={{ fontSize: '11px', fontWeight: 800, color: selectedModel === 'minimax' ? 'var(--gold)' : '#93c5fd', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                        {selectedModel === 'minimax' ? '🌟 Omni-Reference Multi-Images' : '⚡ Character & Scene References'}
                      </span>
                      <span style={{ fontSize: '10px', background: 'rgba(255,255,255,0.06)', padding: '0.15rem 0.45rem', borderRadius: '0.3rem', color: '#94a3b8', fontWeight: 700 }}>
                        {refImages.length} / {maxRefImages} max
                      </span>
                    </div>
                    <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                      <button
                        type="button"
                        onClick={() => {
                          loadSavedReferences()
                          setShowRefLibraryModal(true)
                        }}
                        style={{
                          background: 'rgba(232,185,74,0.12)',
                          border: '1px solid rgba(232,185,74,0.3)',
                          color: 'var(--gold)',
                          borderRadius: '0.35rem',
                          padding: '0.2rem 0.5rem',
                          fontSize: '10px',
                          fontWeight: 700,
                          cursor: 'pointer',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '0.25rem',
                        }}
                      >
                        <span>📂 R2 Media Gallery</span>
                      </button>
                      {refImages.length > 0 && (
                        <button
                          type="button"
                          onClick={() => setRefImages([])}
                          style={{ background: 'none', border: 'none', color: '#ef4444', fontSize: '10.5px', cursor: 'pointer', fontWeight: 600 }}
                        >
                          Clear All
                        </button>
                      )}
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', alignItems: 'center' }}>
                    {refImages.map((img, idx) => (
                      <div
                        key={idx}
                        onClick={() => {
                          const tag = selectedModel === 'minimax' ? `@picture${idx + 1}` : `@image${idx + 1}`
                          setGenPrompt(prev => prev ? `${prev.trim()} ${tag} ` : `${tag} `)
                          toast.info(`Added ${tag} to prompt`)
                        }}
                        style={{ position: 'relative', width: '56px', height: '56px', borderRadius: '0.5rem', overflow: 'hidden', border: '1px solid rgba(232,185,74,0.4)', background: '#030712', cursor: 'pointer' }}
                        title={`Click to insert ${selectedModel === 'minimax' ? `@picture${idx + 1}` : `@image${idx + 1}`} into prompt`}
                      >
                        <img src={img} alt={`ref-${idx}`} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        <span style={{ position: 'absolute', bottom: '2px', left: '2px', background: 'rgba(0,0,0,0.75)', fontSize: '8px', color: 'var(--gold)', padding: '0 3px', borderRadius: '2px', fontWeight: 800 }}>
                          {selectedModel === 'minimax' ? `@pic${idx + 1}` : `@img${idx + 1}`}
                        </span>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            setRefImages(prev => prev.filter((_, i) => i !== idx))
                          }}
                          style={{ position: 'absolute', top: '2px', right: '2px', width: '16px', height: '16px', borderRadius: '50%', background: 'rgba(239,68,68,0.85)', color: '#fff', border: 'none', fontSize: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', padding: 0 }}
                        >
                          ✕
                        </button>
                      </div>
                    ))}

                    {refImages.length < maxRefImages && (
                      <label style={{
                        width: '56px',
                        height: '56px',
                        borderRadius: '0.5rem',
                        border: '1.5px dashed rgba(232,185,74,0.35)',
                        background: 'rgba(232,185,74,0.04)',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        cursor: 'pointer',
                        transition: 'all 0.15s ease',
                      }}>
                        <input
                          type="file"
                          accept="image/*"
                          multiple
                          style={{ display: 'none' }}
                          onChange={(e) => {
                            const files = e.target.files
                            if (!files) return
                            const remaining = maxRefImages - refImages.length
                            const toAdd = Array.from(files).slice(0, remaining)
                            toAdd.forEach(file => {
                              const reader = new FileReader()
                              reader.onload = (ev) => {
                                if (ev.target?.result) {
                                  setRefImages(prev => prev.length < maxRefImages ? [...prev, ev.target!.result as string] : prev)
                                }
                              }
                              reader.readAsDataURL(file)
                            })
                            e.target.value = ''
                          }}
                        />
                        <span style={{ fontSize: '16px', lineHeight: 1 }}>📎</span>
                        <span style={{ fontSize: '8.5px', color: '#94a3b8', fontWeight: 700, marginTop: '2px' }}>+Add</span>
                      </label>
                    )}
                  </div>
                </div>

                {genError && (
                  <div style={{ marginTop: '0.75rem', padding: '0.65rem 0.9rem', background: 'rgba(239, 68, 68, 0.12)', border: '1px solid rgba(239, 68, 68, 0.3)', borderRadius: '0.5rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem' }}>
                    <span style={{ fontSize: '12px', color: '#fca5a5' }}>⚠️ {genError}</span>
                    <button
                      onClick={() => { setShowPodDrawer(true); setGenError(null) }}
                      style={{ background: 'var(--gold)', color: '#05080e', border: 'none', borderRadius: '0.35rem', padding: '0.3rem 0.7rem', fontSize: '11px', fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}
                    >
                      ⚡ Start GPU Pod →
                    </button>
                  </div>
                )}
              </div>

              {/* ── Inline generation progress ── */}
              {jobs.length > 0 && (
                <div style={{ marginBottom: '2rem' }}>
                  <style>{`
                    @keyframes vg-shimmer {
                      0%   { background-position: -400px 0; }
                      100% { background-position:  400px 0; }
                    }
                    @keyframes vg-pulse-ring {
                      0%   { box-shadow: 0 0 0 0   rgba(232,185,74,0.45); }
                      70%  { box-shadow: 0 0 0 10px rgba(232,185,74,0);    }
                      100% { box-shadow: 0 0 0 0   rgba(232,185,74,0);     }
                    }
                    .vg-generating { animation: vg-pulse-ring 1.6s ease-out infinite; }
                  `}</style>

                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      {jobs.some(j => j.state === 'queued' || j.state === 'running') && (
                        <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'var(--gold)', boxShadow: '0 0 10px var(--gold)', animation: 'spin 1.5s linear infinite' }} />
                      )}
                      <h3 style={{ fontSize: '11px', color: jobs.some(j => j.state === 'queued' || j.state === 'running') ? 'var(--gold)' : '#64748b', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 800, margin: 0 }}>
                        {jobs.some(j => j.state === 'queued' || j.state === 'running')
                          ? `⚡ Live GPU Generation (${jobs.filter(j => j.state === 'queued' || j.state === 'running').length} Active)`
                          : 'Recent Generations'}
                      </h3>
                    </div>
                    <button
                      onClick={() => setActiveTab('generations')}
                      style={{ fontSize: '10px', color: 'var(--gold)', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 700 }}
                    >
                      View all ({jobs.length}) →
                    </button>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '1rem' }}>
                    {jobs.map(j => (
                      <div
                        key={j.id}
                        className={j.state === 'queued' || j.state === 'running' ? 'vg-generating' : ''}
                        style={{
                          background: '#0e182e',
                          border: `1px solid ${j.state === 'error' ? '#f87171' : j.state === 'done' ? '#4ade8044' : 'rgba(232,185,74,0.35)'}`,
                          borderRadius: '0.75rem',
                          overflow: 'hidden',
                          display: 'flex',
                          flexDirection: 'column',
                        }}
                      >
                        {/* Thumbnail / video area */}
                        {j.state === 'done' && j.filename && !failedVideos[j.id] ? (
                          <video
                            src={`/api/videogen/video?filename=${encodeURIComponent(j.filename)}&subfolder=${encodeURIComponent(j.subfolder ?? 'gen')}`}
                            controls loop playsInline autoPlay muted preload="metadata"
                            onError={() => setFailedVideos(prev => ({ ...prev, [j.id]: true }))}
                            style={{ width: '100%', height: '160px', objectFit: 'cover', background: '#000' }}
                          />
                        ) : failedVideos[j.id] ? (
                          <div style={{ height: '160px', background: '#070c14', padding: '0.75rem', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '0.35rem', textAlign: 'center', borderBottom: '1px solid #1a2840' }}>
                            <span style={{ fontSize: '1.25rem' }}>⚠️</span>
                            <span style={{ fontSize: '11px', color: 'var(--gold)', fontWeight: 800 }}>Clip Expired (Previous Pod)</span>
                            <p style={{ fontSize: '9.5px', color: '#94a3b8', margin: 0, lineHeight: 1.25, maxWidth: '210px' }}>
                              Rendered on a previous pod before auto-caching.
                            </p>
                            <button
                              onClick={() => {
                                setGenPrompt(j.prompt)
                                generate({ prompt: j.prompt, label: j.label || 'Re-generated Shot', seconds: j.seconds || 6 })
                              }}
                              disabled={submitting}
                              style={{
                                marginTop: '0.2rem', background: 'var(--gold)', color: '#05080e', border: 'none',
                                borderRadius: '0.35rem', padding: '0.3rem 0.65rem', fontSize: '10px', fontWeight: 800, cursor: 'pointer'
                              }}
                            >
                              ⚡ Re-Generate Now
                            </button>
                          </div>
                        ) : j.state === 'error' ? (
                          <div style={{ height: '160px', background: 'rgba(248,113,113,0.06)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}>
                            <span style={{ fontSize: '1.5rem' }}>⚠️</span>
                            <span style={{ fontSize: '11px', color: '#f87171', fontWeight: 700 }}>Generation failed</span>
                            <span style={{ fontSize: '10px', color: '#64748b', maxWidth: '200px', textAlign: 'center' }}>{j.error}</span>
                          </div>
                        ) : (
                          /* Shimmer + status */
                          <div style={{
                            height: '160px', position: 'relative', overflow: 'hidden',
                            background: 'linear-gradient(90deg, #0e182e 0%, #121F35 50%, #0e182e 100%)',
                            backgroundSize: '800px 100%',
                            animation: 'vg-shimmer 2s infinite linear',
                            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '0.6rem',
                          }}>
                            <div style={{
                              width: '44px', height: '44px', borderRadius: '50%',
                              border: '3px solid rgba(232,185,74,0.2)',
                              borderTop: '3px solid var(--gold)',
                              animation: 'spin 1s linear infinite',
                            }} />
                            <span style={{ fontSize: '11px', color: 'var(--gold)', fontWeight: 700, letterSpacing: '0.06em' }}>
                              {j.state === 'queued' ? 'QUEUED' : 'RENDERING…'}
                            </span>
                            <span style={{ fontSize: '10px', color: '#64748b' }}>
                              {j.seconds || 4}s clip · {j.startedAt ? Math.round((Date.now() - j.startedAt) / 1000) : 0}s elapsed
                            </span>
                            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
                          </div>
                        )}

                        {/* Label + prompt */}
                        <div style={{ padding: '0.65rem 0.75rem', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <span style={{
                              fontSize: '9px', fontWeight: 800, padding: '0.15rem 0.45rem', borderRadius: '9999px',
                              background: j.state === 'done' ? '#4ade8022' : j.state === 'error' ? '#f8717122' : 'rgba(232,185,74,0.15)',
                              color: j.state === 'done' ? '#4ade80' : j.state === 'error' ? '#f87171' : 'var(--gold)',
                              textTransform: 'uppercase', letterSpacing: '0.06em',
                            }}>
                              {j.state}
                            </span>
                            <span style={{ fontSize: '11px', fontWeight: 700, color: '#F2F5FA', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {j.label}
                            </span>
                          </div>
                          <p style={{ fontSize: '10px', color: '#64748b', margin: 0, lineHeight: 1.4, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                            {j.prompt}
                          </p>
                        </div>

                        {/* Actions when done */}
                        {j.state === 'done' && j.filename && (
                          <div style={{ padding: '0 0.75rem 0.65rem', display: 'flex', gap: '0.4rem' }}>
                            <button
                              onClick={() => handleUpscaleClip(j.id, j.filename!)}
                              disabled={upscalingJobs[j.id]}
                              style={{
                                flex: 1,
                                background: j.filename.includes('_4k') ? '#059669' : 'linear-gradient(135deg, #8b5cf6, #d946ef)',
                                color: '#fff',
                                border: 'none',
                                fontWeight: 800,
                                borderRadius: '0.4rem',
                                padding: '0.35rem',
                                fontSize: '11px',
                                cursor: upscalingJobs[j.id] ? 'wait' : 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: '0.25rem',
                              }}
                            >
                              {upscalingJobs[j.id] ? '⏳ 4K Super-Res...' : j.filename.includes('_4k') ? '✓ 4K Master' : '✨ Upscale 4K'}
                            </button>
                            <a
                              href={`/api/videogen/video?filename=${encodeURIComponent(j.filename)}&subfolder=${encodeURIComponent(j.subfolder ?? 'gen')}&download=1`}
                              download
                              style={{
                                background: 'var(--gold)',
                                color: '#05080e',
                                textAlign: 'center',
                                textDecoration: 'none',
                                fontWeight: 800,
                                borderRadius: '0.4rem',
                                padding: '0.35rem 0.65rem',
                                fontSize: '11px',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                              }}
                            >
                              ⬇ MP4
                            </a>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Published Projects & Showcase (SS4 Replacement) */}
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
                  <div>
                    <h3 style={{ fontSize: '14px', fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#F2F5FA', margin: 0 }}>
                      PUBLISHED PROJECTS & SHOWCASE
                    </h3>
                    <p style={{ fontSize: '11px', color: '#64748b', margin: '0.2rem 0 0' }}>
                      Learn from community productions, examine prompts & settings, and remix them into your active project.
                    </p>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '1.5rem' }}>
                  {PUBLISHED_PROJECTS.map(proj => (
                    <div key={proj.id} style={{
                      background: '#0e182e', border: '1px solid #1a2840', borderRadius: '1rem', overflow: 'hidden',
                      display: 'flex', flexDirection: 'column', gap: '0.75rem'
                    }}>
                      <div style={{
                        height: '150px', background: 'linear-gradient(135deg, #070c14, #121F35)', display: 'flex', alignItems: 'center', justifyContent: 'center',
                        position: 'relative', borderBottom: '1px solid #1a2840'
                      }}>
                        <span style={{ fontSize: '2.5rem', opacity: 0.4 }}>🎬</span>
                        <span style={{
                          position: 'absolute', top: '0.75rem', left: '0.75rem', fontSize: '10px',
                          padding: '0.2rem 0.5rem', borderRadius: '0.25rem', background: 'var(--gold)', color: '#05080e', fontWeight: 800
                        }}>
                          {proj.tag}
                        </span>
                        <span style={{
                          position: 'absolute', bottom: '0.75rem', right: '0.75rem', fontSize: '10px',
                          color: '#96A3B6', background: 'rgba(0,0,0,0.6)', padding: '0.15rem 0.4rem', borderRadius: '0.2rem'
                        }}>
                          {proj.shotsCount} shots · {proj.duration}
                        </span>
                      </div>

                      <div style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                        <h4 style={{ fontWeight: 800, fontSize: '14px', margin: 0, color: 'var(--gold)' }}>{proj.title}</h4>
                        <p style={{ fontSize: '11px', color: '#96A3B6', lineHeight: 1.5, margin: 0, height: '40px', overflow: 'hidden' }}>
                          {proj.prompt}
                        </p>
                        
                        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
                          <button onClick={() => setInspectProject(proj)} style={{
                            flex: 1, background: '#070c14', border: '1px solid #1a2840', borderRadius: '0.4rem',
                            color: '#F2F5FA', fontSize: '11px', fontWeight: 700, padding: '0.45rem', cursor: 'pointer'
                          }}>
                            View Breakdown ↗
                          </button>
                          <button onClick={() => {
                            generate({ prompt: proj.prompt, label: proj.title, seconds: 6 })
                          }} style={{
                            flex: 1, background: 'rgba(232,185,74,0.15)', border: '1px solid rgba(232,185,74,0.3)', borderRadius: '0.4rem',
                            color: 'var(--gold)', fontSize: '11px', fontWeight: 700, padding: '0.45rem', cursor: 'pointer'
                          }}>
                            Remix / Use Template
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          </div>

          {/* Tab 2: MY GENERATIONS HISTORY */}
          <div style={{ display: activeTab === 'generations' ? 'block' : 'none' }}>
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '0.75rem' }}>
                <div>
                  <h2 style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--gold)', margin: 0 }}>
                    MY GENERATIONS & VIDEO HISTORY
                  </h2>
                  <p style={{ fontSize: '11px', color: '#94a3b8', margin: '0.2rem 0 0' }}>
                    Persistent library of all AI generated video shots and assembled movies.
                  </p>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <button
                    onClick={() => loadGenerations()}
                    style={{
                      background: '#0e182e', border: '1px solid #1a2840', color: '#cbd5e1',
                      borderRadius: '0.4rem', padding: '0.4rem 0.75rem', fontSize: '11px', fontWeight: 700,
                      cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.35rem'
                    }}
                  >
                    <span>🔄</span> Refresh Library
                  </button>
                </div>
              </div>
              
              {jobs.length === 0 && films.length === 0 ? (
                <div style={{ background: '#0e182e', border: '1px dashed #1a2840', borderRadius: '1rem', padding: '3rem', textAlign: 'center', color: '#64748b' }}>
                  <p style={{ fontSize: '1.75rem', margin: 0 }}>🎥</p>
                  <p style={{ fontSize: '13px', fontWeight: 700, marginTop: '0.5rem', color: '#cbd5e1' }}>No video generations recorded yet.</p>
                  <p style={{ fontSize: '11px', color: '#64748b', margin: '0.2rem 0 0' }}>Generate a video prompt from the home tab or use the 1-Click Storyboard engine.</p>
                  <button onClick={() => setActiveTab('home')} style={{
                    background: 'var(--gold)', color: '#05080e', border: 'none', borderRadius: '0.5rem',
                    padding: '0.55rem 1.25rem', fontWeight: 800, fontSize: '12px', cursor: 'pointer', marginTop: '1rem'
                  }}>
                    ✨ Generate Your First Video Shot
                  </button>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
                  {/* Generated Clips */}
                  {jobs.length > 0 && (
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                        <h3 style={{ fontSize: '12px', color: 'var(--gold)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 800, margin: 0 }}>
                          Generated Video Clips ({jobs.length})
                        </h3>
                      </div>

                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(290px, 1fr))', gap: '1rem' }}>
                        {jobs.map(j => (
                          <div key={j.id} style={{ background: '#0e182e', border: '1px solid #1a2840', borderRadius: '0.75rem', padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                            {j.state === 'done' && j.filename && !failedVideos[j.id] ? (
                              <video
                                src={`/api/videogen/video?filename=${encodeURIComponent(j.filename)}&subfolder=${encodeURIComponent(j.subfolder ?? 'gen')}`}
                                controls loop playsInline preload="metadata"
                                onError={() => setFailedVideos(prev => ({ ...prev, [j.id]: true }))}
                                style={{ width: '100%', height: '160px', objectFit: 'cover', borderRadius: '0.5rem', background: '#000' }}
                              />
                            ) : failedVideos[j.id] ? (
                              <div style={{ height: '160px', background: '#070c14', borderRadius: '0.5rem', padding: '1rem', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '0.35rem', textAlign: 'center', border: '1px dashed rgba(232,185,74,0.3)' }}>
                                <span style={{ fontSize: '1.25rem' }}>⚠️</span>
                                <span style={{ fontSize: '11px', color: 'var(--gold)', fontWeight: 800 }}>Clip Expired (Previous Pod)</span>
                                <p style={{ fontSize: '9.5px', color: '#94a3b8', margin: 0, lineHeight: 1.3 }}>
                                  Generated on a previous pod before auto-caching.
                                </p>
                                <button
                                  onClick={() => {
                                    setGenPrompt(j.prompt)
                                    setActiveTab('home')
                                    generate({ prompt: j.prompt, label: j.label || 'Re-generated Shot', seconds: j.seconds || 6 })
                                  }}
                                  disabled={submitting}
                                  style={{
                                    marginTop: '0.3rem', background: 'var(--gold)', color: '#05080e', border: 'none',
                                    borderRadius: '0.35rem', padding: '0.35rem 0.75rem', fontSize: '10.5px', fontWeight: 800, cursor: 'pointer'
                                  }}
                                >
                                  ⚡ Re-Generate Scene
                                </button>
                              </div>
                            ) : (
                              <div style={{ height: '160px', background: '#070c14', borderRadius: '0.5rem', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: j.state === 'error' ? '#f87171' : 'var(--gold)', fontWeight: 700, fontSize: '12px', gap: '0.4rem', border: '1px dashed #1a2840' }}>
                                <span>{j.state === 'error' ? '⚠️' : '⏳'}</span>
                                <span>{j.state.toUpperCase()}…</span>
                                {j.error && <span style={{ fontSize: '10px', color: '#f87171', maxWidth: '85%', textAlign: 'center' }}>{j.error}</span>}
                              </div>
                            )}

                            <div>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <p style={{ fontWeight: 800, fontSize: '12.5px', color: '#F2F5FA', margin: 0 }}>{j.label}</p>
                                <span style={{ fontSize: '9.5px', color: '#64748b' }}>{new Date(j.createdAt || j.startedAt || Date.now()).toLocaleDateString()}</span>
                              </div>
                              <p style={{ fontSize: '11px', color: '#96A3B6', lineHeight: 1.4, margin: '0.35rem 0 0', maxHeight: '55px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                {j.prompt}
                              </p>
                            </div>

                            <div style={{ display: 'flex', gap: '0.4rem', marginTop: 'auto' }}>
                              <button
                                onClick={() => copyToClipboard(j.prompt, j.id)}
                                style={{ flex: 1, background: '#070c14', border: '1px solid #1a2840', color: '#96A3B6', borderRadius: '0.35rem', padding: '0.35rem', fontSize: '10.5px', fontWeight: 600, cursor: 'pointer' }}
                              >
                                {copied === j.id ? '✓ Copied!' : '📋 Copy'}
                              </button>
                              {j.filename && (
                                <a
                                  href={`/api/videogen/video?filename=${encodeURIComponent(j.filename)}&subfolder=${encodeURIComponent(j.subfolder ?? 'gen')}`}
                                  download
                                  style={{ flex: 1, background: 'var(--gold)', color: '#05080e', textAlign: 'center', textDecoration: 'none', fontWeight: 800, borderRadius: '0.35rem', padding: '0.35rem', fontSize: '10.5px' }}
                                >
                                  ⬇️ MP4
                                </a>
                              )}
                              <button
                                onClick={() => {
                                  showConfirmModal({
                                    title: 'Delete Generation Record',
                                    message: 'Delete this video generation record and remove it from your history?',
                                    confirmText: '🗑️ Delete Record',
                                    type: 'danger',
                                    onConfirm: async () => {
                                      const res = await fetch(`/api/videogen/generate?id=${encodeURIComponent(j.id)}`, { method: 'DELETE' })
                                      if (!res.ok) {
                                        const d = await res.json().catch(() => ({}))
                                        throw new Error(d.error || 'Failed to delete')
                                      }
                                      setJobs(prev => prev.filter(x => x.id !== j.id && x.promptId !== j.promptId))
                                      toast.success('Generation record deleted.')
                                    },
                                  })
                                }}
                                style={{ background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.25)', color: '#f87171', borderRadius: '0.35rem', padding: '0.35rem 0.55rem', fontSize: '10.5px', cursor: 'pointer' }}
                                title="Delete clip from history"
                              >
                                🗑️
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Assembled Stitched Movies */}
                  {films.length > 0 && (
                    <div>
                      <h3 style={{ fontSize: '12px', color: 'var(--gold)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 800, marginBottom: '0.75rem' }}>
                        Rendered Full Movies ({films.length})
                      </h3>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(290px, 1fr))', gap: '1rem' }}>
                        {films.map(f => (
                          <div key={f.id} style={{ background: '#0e182e', border: '1px solid #1a2840', borderRadius: '0.75rem', padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                            {f.file ? (
                              <video src={`/api/videogen/assemble?file=${encodeURIComponent(f.file)}`} controls loop playsInline style={{ width: '100%', height: '160px', objectFit: 'cover', borderRadius: '0.5rem', background: '#000' }} />
                            ) : (
                              <div style={{ height: '160px', background: '#070c14', borderRadius: '0.5rem', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8', fontSize: '12px' }}>
                                Processing Film...
                              </div>
                            )}
                            <div>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <p style={{ fontWeight: 800, fontSize: '13px', margin: 0, color: 'var(--gold)' }}>{f.title}</p>
                                <span style={{ fontSize: '10px', color: '#64748b' }}>{f.duration}s</span>
                              </div>
                              {f.bytes && <p style={{ fontSize: '10px', color: '#64748b', margin: '0.2rem 0 0' }}>Size: {(f.bytes / 1024 / 1024).toFixed(1)} MB</p>}
                            </div>

                            {f.file && (
                              <div style={{ display: 'flex', gap: '0.5rem' }}>
                                <a
                                  href={`/api/videogen/assemble?file=${encodeURIComponent(f.file)}&download=1`}
                                  download
                                  style={{ flex: 1, background: 'var(--gold)', color: '#05080e', textAlign: 'center', textDecoration: 'none', fontWeight: 800, borderRadius: '0.35rem', padding: '0.4rem', fontSize: '11px' }}
                                >
                                  ⬇️ Download Master Movie MP4
                                </a>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Saved R2 Reference Media Library */}
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                      <div>
                        <h3 style={{ fontSize: '12px', color: 'var(--gold)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 800, margin: 0 }}>
                          Saved Reference Images & Style Boards in R2 ({savedReferences.length})
                        </h3>
                        <p style={{ fontSize: '10.5px', color: '#94a3b8', margin: '0.15rem 0 0' }}>
                          Permanent Cloudflare R2 reference media library — select any asset to attach directly to your prompt.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          loadSavedReferences()
                          setShowRefLibraryModal(true)
                        }}
                        style={{
                          background: 'rgba(232,185,74,0.12)',
                          border: '1px solid rgba(232,185,74,0.3)',
                          color: 'var(--gold)',
                          borderRadius: '0.35rem',
                          padding: '0.3rem 0.65rem',
                          fontSize: '11px',
                          fontWeight: 700,
                          cursor: 'pointer',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '0.3rem',
                        }}
                      >
                        <span>📂 Open R2 Library</span>
                      </button>
                    </div>

                    {savedReferences.length === 0 ? (
                      <div style={{ background: '#0e182e', border: '1px dashed #1a2840', borderRadius: '0.6rem', padding: '1.5rem', textAlign: 'center', color: '#64748b' }}>
                        <p style={{ margin: 0, fontSize: '11px' }}>No reference images saved yet. Images uploaded via the prompt reference uploader are automatically saved here.</p>
                      </div>
                    ) : (
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: '0.75rem' }}>
                        {savedReferences.map(ref => (
                          <div key={ref.key} style={{ background: '#0e182e', border: '1px solid #1a2840', borderRadius: '0.5rem', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                            <div style={{ height: '90px', width: '100%', position: 'relative', background: '#030712' }}>
                              <img src={ref.url} alt={ref.filename} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                            </div>
                            <div style={{ padding: '0.4rem', display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                              <p style={{ margin: 0, fontSize: '9.5px', color: '#cbd5e1', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {ref.filename}
                              </p>
                              <button
                                type="button"
                                onClick={() => {
                                  if (!refImages.includes(ref.url)) {
                                    if (refImages.length >= maxRefImages) {
                                      toast.error(`Maximum ${maxRefImages} reference images allowed`)
                                      return
                                    }
                                    setRefImages(prev => [...prev, ref.url])
                                  }
                                  setActiveTab('home')
                                  toast.success('Attached reference image to prompt!')
                                }}
                                style={{
                                  background: 'var(--gold)',
                                  color: '#05080e',
                                  border: 'none',
                                  borderRadius: '0.25rem',
                                  padding: '0.25rem',
                                  fontSize: '9.5px',
                                  fontWeight: 800,
                                  cursor: 'pointer',
                                }}
                              >
                                + Attach to Prompt
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Tab 3: CHARACTERS & STYLE SHEET MANAGER */}
          <div style={{ display: activeTab === 'characters' ? 'block' : 'none' }}>
            <div>
              <h2 style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--gold)', marginBottom: '1rem' }}>
                CHARACTER STYLE SHEETS & VOICE MAPPING
              </h2>
              <p style={{ fontSize: '12px', color: '#64748b', marginBottom: '1.5rem' }}>
                Add reference turnaround style sheet images and map voice settings for consistent AI character presence across films.
              </p>

              {/* Add Character Form */}
              <div style={{ background: '#0e182e', border: '1px solid #1a2840', borderRadius: '0.75rem', padding: '1.25rem', marginBottom: '2rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <h3 style={{ fontSize: '13px', fontWeight: 700, margin: 0, color: '#F2F5FA' }}>+ Add New Character</h3>
                  <button
                    type="button"
                    onClick={() => {
                      setPromptBuilderType('character')
                      setShowPromptBuilder(true)
                    }}
                    style={{
                      background: 'rgba(232,185,74,0.12)',
                      border: '1px solid rgba(232,185,74,0.35)',
                      color: 'var(--gold)',
                      borderRadius: '0.4rem',
                      padding: '0.3rem 0.65rem',
                      fontSize: '11px',
                      fontWeight: 800,
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.35rem',
                    }}
                  >
                    <span>✨ AI Character Generator</span>
                  </button>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                  <div>
                    <label style={{ fontSize: '10px', color: '#64748b', textTransform: 'uppercase', fontWeight: 700, display: 'block', marginBottom: '0.3rem' }}>Character Name</label>
                    <input type="text" value={charName} onChange={e => setCharName(e.target.value)} placeholder="e.g. Meera" style={{ width: '100%', padding: '0.5rem', borderRadius: '0.4rem', background: '#070c14', border: '1px solid #1a2840', color: '#fff', fontSize: '12px' }} />
                  </div>
                  <div>
                    <label style={{ fontSize: '10px', color: '#64748b', textTransform: 'uppercase', fontWeight: 700, display: 'block', marginBottom: '0.3rem' }}>
                      Mapped Character Voice (ElevenLabs Presets & Custom)
                    </label>
                    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                      <select
                        value={charVoiceId}
                        onChange={e => setCharVoiceId(e.target.value)}
                        style={{ flex: 1, padding: '0.5rem', borderRadius: '0.4rem', background: '#070c14', border: '1px solid #1a2840', color: '#fff', fontSize: '12px', outline: 'none' }}
                      >
                        <option value="">-- Select Voice Preset --</option>
                        {voices.map(v => (
                          <option key={v.voiceId} value={v.voiceId}>
                            🎙️ {v.name} ({v.category})
                          </option>
                        ))}
                      </select>
                      {charVoiceId && (
                        <button
                          type="button"
                          onClick={() => {
                            const v = voices.find(x => x.voiceId === charVoiceId)
                            if (v?.previewUrl) {
                              const audio = new Audio(v.previewUrl)
                              audio.play()
                            } else {
                              toast.info(`Custom Voice ID: ${charVoiceId}`)
                            }
                          }}
                          style={{
                            padding: '0.5rem 0.75rem', borderRadius: '0.4rem', border: '1px solid var(--gold)',
                            background: 'rgba(232,185,74,0.15)', color: 'var(--gold)', fontSize: '11px',
                            fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap'
                          }}
                          title="Click to listen to sample audio preview"
                        >
                          ▶ Preview Sample
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                <div>
                  <label style={{ fontSize: '10px', color: '#64748b', textTransform: 'uppercase', fontWeight: 700, display: 'block', marginBottom: '0.3rem' }}>Appearance Description</label>
                  <input type="text" value={charDesc} onChange={e => setCharDesc(e.target.value)} placeholder="e.g. Indian woman in her late 20s, long dark hair, warm smile, emerald saree" style={{ width: '100%', padding: '0.5rem', borderRadius: '0.4rem', background: '#070c14', border: '1px solid #1a2840', color: '#fff', fontSize: '12px' }} />
                </div>

                <div>
                  <label style={{ fontSize: '10px', color: '#64748b', textTransform: 'uppercase', fontWeight: 700, display: 'block', marginBottom: '0.3rem' }}>Character Style Sheet Guidelines (Turnaround / Costume / Expression Rules)</label>
                  <textarea value={charNotes} onChange={e => setCharNotes(e.target.value)} placeholder="e.g. Costume: Silver spacesuit with neon blue LED trim. Lighting: High contrast rim light." style={{ width: '100%', height: '60px', padding: '0.5rem', borderRadius: '0.4rem', background: '#070c14', border: '1px solid #1a2840', color: '#fff', fontSize: '12px', resize: 'none' }} />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem' }}>
                  <div>
                    <label style={{ fontSize: '10px', color: '#64748b', textTransform: 'uppercase', fontWeight: 700, display: 'block', marginBottom: '0.3rem' }}>Main Reference Image</label>
                    <input type="file" onChange={e => setCharRefFile(e.target.files?.[0] ?? null)} style={{ fontSize: '11px', color: '#96A3B6' }} />
                  </div>
                  <div>
                    <label style={{ fontSize: '10px', color: '#64748b', textTransform: 'uppercase', fontWeight: 700, display: 'block', marginBottom: '0.3rem' }}>Turnaround Images (Multi-angle)</label>
                    <input type="file" multiple onChange={e => setCharTurnaroundFiles(Array.from(e.target.files ?? []))} style={{ fontSize: '11px', color: '#96A3B6' }} />
                  </div>
                  <div>
                    <label style={{ fontSize: '10px', color: '#64748b', textTransform: 'uppercase', fontWeight: 700, display: 'block', marginBottom: '0.3rem' }}>Voice Audio Reference Sample</label>
                    <input type="file" accept="audio/*" onChange={e => setCharVoiceFile(e.target.files?.[0] ?? null)} style={{ fontSize: '11px', color: '#96A3B6' }} />
                  </div>
                </div>

                <button onClick={saveCharacterHandler} disabled={savingChar || !charName.trim()} style={{ background: 'var(--gold)', color: '#05080e', border: 'none', borderRadius: '0.4rem', padding: '0.55rem', fontWeight: 800, fontSize: '12px', cursor: 'pointer', marginTop: '0.5rem' }}>
                  {savingChar ? 'Saving Character...' : 'Save Character & Style Sheet'}
                </button>
              </div>

              {/* Character List */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '1rem' }}>
                {characters.map(c => (
                  <div key={c.id} style={{ background: '#0e182e', border: '1px solid #1a2840', borderRadius: '0.75rem', overflow: 'hidden' }}>
                    {c.imageFile ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={`/api/videogen/characters?image=${encodeURIComponent(c.imageFile)}`} alt={c.name} style={{ width: '100%', height: '140px', objectFit: 'cover' }} />
                    ) : (
                      <div style={{ height: '140px', background: '#070c14', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#64748b', fontSize: '11px' }}>
                        Prompt-only character
                      </div>
                    )}
                    <div style={{ padding: '0.85rem' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <p style={{ fontWeight: 800, fontSize: '13px', margin: 0, color: 'var(--gold)' }}>{c.name}</p>
                        <button onClick={() => deleteCharHandler(c.id)} style={{ background: 'none', border: 'none', color: '#ef4444', fontSize: '11px', cursor: 'pointer' }}>Delete</button>
                      </div>
                      <p style={{ fontSize: '11px', color: '#96A3B6', margin: '0.3rem 0 0', lineHeight: 1.4 }}>{c.description}</p>
                      {c.styleSheetNotes && (
                        <p style={{ fontSize: '10px', color: '#64748b', marginTop: '0.4rem', borderTop: '1px dashed #1a2840', paddingTop: '0.4rem' }}>
                          Style Guidelines: {c.styleSheetNotes}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* TAB: SINGING & MUSIC VIDEO STUDIO */}
          <div style={{ display: activeTab === 'singing' ? 'block' : 'none' }}>
            <SingingStudio
              projectId={activeProjectId}
              characters={characters.map(c => ({ id: c.id, name: c.name, imageUrl: c.imageFile ? `/api/videogen/characters?file=${encodeURIComponent(c.imageFile)}` : undefined }))}
              savedReferences={savedReferences}
              onOpenRefLibrary={() => {
                loadSavedReferences()
                setShowRefLibraryModal(true)
              }}
              onNavigateToEngines={() => setActiveTab('engines')}
            />
          </div>

          {/* TAB 4: USAGE & COST MONITOR */}
          <div style={{ display: activeTab === 'usage' ? 'block' : 'none' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', width: '100%', padding: '0.5rem 0' }}>
              <UsageDashboard />
            </div>
          </div>

          {/* TAB 5: AI ENGINES & COMPUTE HUB */}
          <div style={{ display: activeTab === 'engines' ? 'block' : 'none' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', width: '100%', padding: '0.5rem 0' }}>
              <EnginesHub onNavigateToGen={() => setActiveTab('home')} />
            </div>
          </div>
        </div>
      </main>

      {/* Modal 1: Create Project Modal */}
      {showNewProjectModal && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(5, 8, 14, 0.75)',
          backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100
        }}>
          <div style={{ background: '#0e182e', border: '1px solid #1a2840', borderRadius: '1rem', padding: '1.5rem', width: '360px', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <p style={{ fontWeight: 800, fontSize: '14px', margin: 0, color: 'var(--gold)' }}>Create New Project</p>
              <button onClick={() => setShowNewProjectModal(false)} style={{ background: 'none', border: 'none', color: '#96A3B6', fontSize: '14px', cursor: 'pointer' }}>×</button>
            </div>
            <input type="text" value={newProjectName} onChange={e => setNewProjectName(e.target.value)} placeholder="Project Name (e.g. Jungle Chronicles)" style={{ padding: '0.6rem', borderRadius: '0.4rem', background: '#070c14', border: '1px solid #1a2840', color: '#fff', fontSize: '12px' }} />
            <button onClick={createProject} disabled={!newProjectName.trim()} style={{ background: 'var(--gold)', color: '#05080e', border: 'none', borderRadius: '0.4rem', padding: '0.5rem', fontWeight: 800, fontSize: '12px', cursor: 'pointer' }}>
              Create Project
            </button>
          </div>
        </div>
      )}

      {/* Modal 2: Character Selector Modal */}
      {showCharModal && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(5, 8, 14, 0.75)',
          backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100
        }}>
          <div style={{ background: '#0e182e', border: '1px solid #1a2840', borderRadius: '1rem', padding: '1.5rem', width: '420px', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <p style={{ fontWeight: 800, fontSize: '14px', margin: 0, color: 'var(--gold)' }}>Select Character Reference</p>
              <button onClick={() => setShowCharModal(false)} style={{ background: 'none', border: 'none', color: '#96A3B6', fontSize: '14px', cursor: 'pointer' }}>×</button>
            </div>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxHeight: '280px', overflowY: 'auto' }}>
              <div onClick={() => { setSelectedCharacterId(''); setShowCharModal(false) }} style={{ padding: '0.65rem 0.85rem', borderRadius: '0.5rem', background: !selectedCharacterId ? 'rgba(232,185,74,0.08)' : '#070c14', border: '1px solid #1a2840', cursor: 'pointer', fontSize: '12px' }}>
                🚫 No character reference (Prompt only)
              </div>

              {characters.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '1.25rem 1rem', background: '#070c14', borderRadius: '0.5rem', border: '1px dashed #1a2840' }}>
                  <p style={{ fontSize: '12px', fontWeight: 700, color: '#94a3b8', margin: '0 0 0.3rem' }}>No characters available yet</p>
                  <p style={{ fontSize: '10px', color: '#64748b', margin: 0, lineHeight: 1.4 }}>Create character turnaround style sheets & voice profiles for visual consistency.</p>
                </div>
              ) : (
                characters.map(char => (
                  <div key={char.id} onClick={() => { setSelectedCharacterId(char.id); setShowCharModal(false) }} style={{ padding: '0.65rem 0.85rem', borderRadius: '0.5rem', background: selectedCharacterId === char.id ? 'rgba(232,185,74,0.08)' : '#070c14', border: '1px solid #1a2840', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    {char.imageFile ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={`/api/videogen/characters?image=${encodeURIComponent(char.imageFile)}`} alt={char.name} style={{ width: '32px', height: '32px', borderRadius: '50%', objectFit: 'cover' }} />
                    ) : (
                      <span style={{ fontSize: '1.2rem' }}>👤</span>
                    )}
                    <div>
                      <p style={{ fontWeight: 700, fontSize: '12px', margin: 0, color: '#F2F5FA' }}>{char.name}</p>
                      <p style={{ fontSize: '10px', color: '#64748b', margin: 0 }}>{char.description.slice(0, 45)}…</p>
                    </div>
                  </div>
                ))
              )}
            </div>

            <button
              onClick={() => {
                setShowCharModal(false)
                setActiveTab('characters')
              }}
              style={{
                width: '100%', background: 'rgba(232, 185, 74, 0.1)', border: '1px dashed rgba(232, 185, 74, 0.4)',
                color: 'var(--gold)', borderRadius: '0.5rem', padding: '0.65rem', fontWeight: 800,
                fontSize: '12px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem'
              }}
            >
              <span>👤 + Create New Character & Style Sheet</span>
            </button>
          </div>
        </div>
      )}

      {/* Modal 3: Inspect Published Project Breakdown */}
      {inspectProject && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(5, 8, 14, 0.75)',
          backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100
        }}>
          <div style={{ background: '#0e182e', border: '1px solid #1a2840', borderRadius: '1rem', padding: '1.5rem', width: '520px', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <p style={{ fontWeight: 800, fontSize: '15px', margin: 0, color: 'var(--gold)' }}>{inspectProject.title}</p>
                <p style={{ fontSize: '11px', color: '#64748b', margin: '0.15rem 0 0' }}>{inspectProject.tag} · {inspectProject.shotsCount} Scenes</p>
              </div>
              <button onClick={() => setInspectProject(null)} style={{ background: 'none', border: 'none', color: '#96A3B6', fontSize: '14px', cursor: 'pointer' }}>×</button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', maxHeight: '280px', overflowY: 'auto' }}>
              {inspectProject.scenes.map(sc => (
                <div key={sc.order} style={{ background: '#070c14', border: '1px solid #1a2840', borderRadius: '0.5rem', padding: '0.75rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', fontWeight: 700, color: 'var(--gold)', marginBottom: '0.3rem' }}>
                    <span>Scene {sc.order}: {sc.title}</span>
                    <span style={{ color: '#64748b' }}>{sc.look} · {sc.grade}</span>
                  </div>
                  <p style={{ fontSize: '11px', color: '#96A3B6', margin: 0, lineHeight: 1.4 }}>{sc.prompt}</p>
                </div>
              ))}
            </div>

            <button onClick={() => {
              generate({ prompt: inspectProject.prompt, label: inspectProject.title, seconds: 6 })
              setInspectProject(null)
            }} style={{ background: 'var(--gold)', color: '#05080e', border: 'none', borderRadius: '0.5rem', padding: '0.65rem', fontWeight: 800, fontSize: '12px', cursor: 'pointer', marginTop: '0.5rem' }}>
              Remix Full Production into Active Project
            </button>
          </div>
        </div>
      )}

      {/* Modal 4: GPU Pod Control Drawer */}
      {showPodDrawer && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(5, 8, 14, 0.78)',
          backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100
        }}>
          <div style={{ background: '#0e182e', border: '1px solid #1a2840', borderRadius: '1rem', padding: '1.5rem', width: '540px', maxWidth: '94vw', display: 'flex', flexDirection: 'column', gap: '1.25rem', boxShadow: '0 20px 60px rgba(0,0,0,0.8)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <p style={{ fontWeight: 800, fontSize: '15px', margin: 0, color: 'var(--gold)' }}>⚡ RunPod GPU Compute Fleet</p>
              <button onClick={() => { setShowPodDrawer(false); setPromptDeployConflict(null); }} style={{ background: 'none', border: 'none', color: '#96A3B6', fontSize: '16px', cursor: 'pointer' }}>×</button>
            </div>

            {/* Engine Tabs: Clear Separation for LTX 2.5 & MiniMax H3 */}
            <div style={{ display: 'flex', gap: '0.5rem', background: '#070c14', padding: '0.3rem', borderRadius: '0.5rem', border: '1px solid #1a2840' }}>
              <button
                onClick={() => setFleetModalTab('ltx25')}
                style={{
                  flex: 1, padding: '0.5rem', borderRadius: '0.4rem',
                  background: fleetModalTab === 'ltx25' ? 'linear-gradient(135deg, #1e3a8a, #0e182e)' : 'transparent',
                  color: fleetModalTab === 'ltx25' ? '#93c5fd' : '#94a3b8',
                  border: fleetModalTab === 'ltx25' ? '1px solid #3b82f6' : '1px solid transparent',
                  fontWeight: 800, fontSize: '11.5px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem'
                }}
              >
                <span>⚡ LTX-Video 2.5</span>
                {ltxRunning && <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: '#4ade80' }} />}
              </button>

              <button
                onClick={() => setFleetModalTab('minimax')}
                style={{
                  flex: 1, padding: '0.5rem', borderRadius: '0.4rem',
                  background: fleetModalTab === 'minimax' ? 'linear-gradient(135deg, #E8B94A, #d97706)' : 'transparent',
                  color: fleetModalTab === 'minimax' ? '#05080e' : '#94a3b8',
                  border: fleetModalTab === 'minimax' ? '1px solid var(--gold)' : '1px solid transparent',
                  fontWeight: 800, fontSize: '11.5px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem'
                }}
              >
                <span>🌟 MiniMax Hailuo 3 (48GB+)</span>
                {minimaxRunning && <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: '#4ade80' }} />}
              </button>
            </div>

            {/* Live Terminal & Streaming Provisioning Log */}
            {deployLogs.length > 0 && (
              <div style={{ background: '#05080e', border: '1px solid #1a2840', borderRadius: '0.6rem', padding: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #1a2840', paddingBottom: '0.35rem' }}>
                  <span style={{ fontSize: '10px', fontWeight: 800, color: 'var(--gold)', letterSpacing: '0.05em', textTransform: 'uppercase' }}>
                    📟 Live Deployment & Boot Logs
                  </span>
                  {(deploying.ltx25 || deploying.minimax) ? (
                    <span style={{ fontSize: '9.5px', color: '#4ade80', fontWeight: 700 }}>
                      ● STREAMING RUNPOD LOGS...
                    </span>
                  ) : (
                    <button
                      onClick={() => setDeployLogs([])}
                      style={{ background: 'none', border: 'none', color: '#64748b', fontSize: '9.5px', cursor: 'pointer' }}
                    >
                      Clear Log
                    </button>
                  )}
                </div>
                <div
                  ref={logTerminalRef}
                  style={{
                    maxHeight: '140px', overflowY: 'auto', fontFamily: 'monospace', fontSize: '10px', lineHeight: 1.4,
                    display: 'flex', flexDirection: 'column', gap: '0.2rem', padding: '0.2rem 0'
                  }}
                >
                  {deployLogs.map((l, i) => (
                    <div
                      key={i}
                      style={{
                        color: l.level === 'ok' ? '#4ade80' : l.level === 'warn' ? '#fbbf24' : l.level === 'error' ? '#f87171' : '#93c5fd'
                      }}
                    >
                      {l.level === 'ok' ? '✓ ' : l.level === 'warn' ? '⚠ ' : l.level === 'error' ? '✖ ' : '▶ '}
                      {l.text}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* In-UI Conflict Resolution Dialog */}
            {promptDeployConflict ? (
              <div style={{ background: '#121F35', border: '1px solid var(--gold)', borderRadius: '0.75rem', padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span style={{ fontSize: '1.4rem' }}>⚠️</span>
                  <div>
                    <h4 style={{ margin: 0, fontSize: '13px', fontWeight: 800, color: 'var(--gold)' }}>
                      Active Node Detected
                    </h4>
                    <p style={{ margin: '0.15rem 0 0', fontSize: '11px', color: '#cbd5e1' }}>
                      A GPU node ({getPodGpuName(promptDeployConflict.existingPod) || 'NVIDIA GPU'} · {getPodVram(promptDeployConflict.existingPod)}GB VRAM) is currently <strong>RUNNING</strong>.
                    </p>
                  </div>
                </div>

                <p style={{ margin: 0, fontSize: '11px', color: '#94a3b8' }}>
                  Would you like to terminate the existing running node to prevent paying for two, or deploy alongside?
                </p>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  <button
                    onClick={() => deploy('ltx25', promptDeployConflict.targetTier, promptDeployConflict.existingPod?.id)}
                    style={{
                      background: 'linear-gradient(135deg, #ef4444, #dc2626)',
                      color: '#fff', border: 'none', borderRadius: '0.4rem', padding: '0.65rem',
                      fontWeight: 800, fontSize: '11.5px', cursor: 'pointer'
                    }}
                  >
                    🛑 Terminate Running Pod & Deploy {promptDeployConflict.targetTier === 'ultra_4k' ? 'Ultra 4K' : 'Standard'}
                  </button>

                  <button
                    onClick={() => deploy('ltx25', promptDeployConflict.targetTier)}
                    style={{
                      background: 'var(--gold)',
                      color: '#05080e', border: 'none', borderRadius: '0.4rem', padding: '0.65rem',
                      fontWeight: 800, fontSize: '11.5px', cursor: 'pointer'
                    }}
                  >
                    ⚡ Keep Running Pod & Deploy Alongside
                  </button>

                  <button
                    onClick={() => setPromptDeployConflict(null)}
                    style={{
                      background: '#070c14', color: '#94a3b8', border: '1px solid #1a2840',
                      borderRadius: '0.4rem', padding: '0.5rem', fontSize: '11px', fontWeight: 700, cursor: 'pointer'
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : fleetModalTab === 'ltx25' ? (
              <>
                {/* Active LTX Pod Status Banner */}
                {ltxRunning && (
                  <div style={{ background: '#070c14', border: '1px solid rgba(74,222,128,0.4)', borderRadius: '0.75rem', padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <span style={{ fontSize: '9.5px', fontWeight: 800, color: '#4ade80', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                          ● ACTIVE LTX COMPUTE NODE (RUNNING)
                        </span>
                        <h4 style={{ margin: '0.2rem 0 0', fontSize: '13px', fontWeight: 800, color: '#F2F5FA' }}>
                          {getPodGpuName(pods.ltx) || 'NVIDIA GPU'} ({getPodVram(pods.ltx)}GB VRAM)
                        </h4>
                      </div>
                      <span style={{ fontSize: '11px', fontWeight: 800, color: 'var(--gold)', background: '#0e182e', padding: '0.25rem 0.5rem', borderRadius: '0.3rem', border: '1px solid #1a2840' }}>
                        ${Number(pods.ltx?.costPerHr || 0.54).toFixed(2)}/hr
                      </span>
                    </div>

                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                      <button
                        onClick={() => podAction('ltx25', 'stop')}
                        disabled={!!actionLoading.ltx25}
                        style={{
                          flex: 1, padding: '0.55rem', border: '1px solid rgba(248,113,113,0.4)', borderRadius: '0.4rem',
                          background: 'rgba(248,113,113,0.15)', color: '#f87171', fontWeight: 800, fontSize: '11px', cursor: 'pointer'
                        }}
                      >
                        {actionLoading.ltx25 === 'stop' ? '⏳ Stopping...' : '⏸️ Stop Node'}
                      </button>

                      <button
                        onClick={() => podAction('ltx25', 'terminate')}
                        disabled={!!actionLoading.ltx25}
                        style={{
                          flex: 1, padding: '0.55rem', border: 'none', borderRadius: '0.4rem',
                          background: '#ef4444', color: '#fff', fontWeight: 800, fontSize: '11px', cursor: 'pointer'
                        }}
                      >
                        {actionLoading.ltx25 === 'terminate' ? '⏳ Terminating...' : '🛑 Terminate & Stop Billing'}
                      </button>

                      {pods.ltx?.id && (
                        <a
                          href={`https://${pods.ltx.id}-8188.proxy.runpod.net`}
                          target="_blank"
                          rel="noreferrer"
                          style={{
                            padding: '0.55rem 0.75rem', background: '#0e182e', border: '1px solid #1a2840',
                            color: '#cbd5e1', textDecoration: 'none', borderRadius: '0.4rem', fontSize: '11px', fontWeight: 700, display: 'flex', alignItems: 'center'
                          }}
                        >
                          🌐 ComfyUI
                        </a>
                      )}
                    </div>
                  </div>
                )}

                {deployError.ltx25 && (
                  <div style={{ padding: '0.6rem', background: 'rgba(248,113,113,0.1)', border: '1px solid #f87171', borderRadius: '0.4rem', color: '#f87171', fontSize: '11px' }}>
                    ⚠️ {deployError.ltx25}
                  </div>
                )}

                {/* LTX GPU Tier Selection Cards */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '0.75rem' }}>
                  {/* Card 1: Standard 24GB */}
                  <div style={{ background: '#070c14', border: '1px solid #1a2840', borderRadius: '0.75rem', padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    <span style={{ fontSize: '10px', fontWeight: 800, color: '#38bdf8', textTransform: 'uppercase' }}>
                      ⚡ Standard Tier
                    </span>
                    <h4 style={{ margin: 0, fontSize: '13px', fontWeight: 800, color: '#F2F5FA' }}>
                      24GB VRAM
                    </h4>
                    <p style={{ margin: 0, fontSize: '10.5px', color: '#94a3b8', lineHeight: 1.4 }}>
                      RTX 3090 / 4090 (~$0.22-$0.34/hr). Optimal for 720p & 1080p rendering.
                    </p>
                    <button
                      onClick={() => handleTierDeployRequest('standard')}
                      disabled={deploying.ltx25}
                      style={{
                        marginTop: 'auto', padding: '0.55rem', borderRadius: '0.4rem',
                        background: 'linear-gradient(135deg, #1e3a8a, #0e182e)', border: '1px solid #3b82f6',
                        color: '#93c5fd', fontWeight: 800, fontSize: '11px', cursor: deploying.ltx25 ? 'not-allowed' : 'pointer'
                      }}
                    >
                      {deployingTier === 'standard' ? '⏳ Deploying Standard (24GB)...' : '🚀 Deploy Standard (24GB)'}
                    </button>
                  </div>

                  {/* Card 2: Ultra 4K 48GB/80GB */}
                  <div style={{ background: '#070c14', border: '1px solid rgba(232,185,74,0.3)', borderRadius: '0.75rem', padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    <span style={{ fontSize: '10px', fontWeight: 800, color: 'var(--gold)', textTransform: 'uppercase' }}>
                      🔥 Ultra 4K Tier
                    </span>
                    <h4 style={{ margin: 0, fontSize: '13px', fontWeight: 800, color: 'var(--gold)' }}>
                      48GB / 80GB VRAM
                    </h4>
                    <p style={{ margin: 0, fontSize: '10.5px', color: '#94a3b8', lineHeight: 1.4 }}>
                      A100 80GB / A6000 (~$0.79-$1.64/hr). Required for raw 4K direct diffusion.
                    </p>
                    <button
                      onClick={() => handleTierDeployRequest('ultra_4k')}
                      disabled={deploying.ltx25}
                      style={{
                        marginTop: 'auto', padding: '0.55rem', borderRadius: '0.4rem',
                        background: 'linear-gradient(135deg, #E8B94A, #d97706)', border: 'none',
                        color: '#05080e', fontWeight: 900, fontSize: '11px', cursor: deploying.ltx25 ? 'not-allowed' : 'pointer'
                      }}
                    >
                      {deployingTier === 'ultra_4k' ? '⏳ Deploying Ultra 4K (48GB+)...' : '🔥 Deploy Ultra 4K (48GB+)'}
                    </button>
                  </div>
                </div>
              </>
            ) : (
              /* MiniMax H3 Dedicated Fleet Tab */
              <>
                {/* Active MiniMax Pod Status Banner */}
                {minimaxRunning && (
                  <div style={{ background: '#070c14', border: '1px solid rgba(232,185,74,0.4)', borderRadius: '0.75rem', padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <span style={{ fontSize: '9.5px', fontWeight: 800, color: 'var(--gold)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                          ● ACTIVE MINIMAX H3 COMPUTE NODE
                        </span>
                        <h4 style={{ margin: '0.2rem 0 0', fontSize: '13px', fontWeight: 800, color: '#F2F5FA' }}>
                          {getPodGpuName(pods.minimax) || 'NVIDIA GPU'} ({getPodVram(pods.minimax)}GB VRAM)
                        </h4>
                      </div>
                      <span style={{ fontSize: '11px', fontWeight: 800, color: 'var(--gold)', background: '#0e182e', padding: '0.25rem 0.5rem', borderRadius: '0.3rem', border: '1px solid #1a2840' }}>
                        ${Number(pods.minimax?.costPerHr || 0.54).toFixed(2)}/hr
                      </span>
                    </div>

                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                      <button
                        onClick={() => podAction('minimax', 'stop')}
                        disabled={!!actionLoading.minimax}
                        style={{
                          flex: 1, padding: '0.55rem', border: '1px solid rgba(248,113,113,0.4)', borderRadius: '0.4rem',
                          background: 'rgba(248,113,113,0.15)', color: '#f87171', fontWeight: 800, fontSize: '11px', cursor: 'pointer'
                        }}
                      >
                        {actionLoading.minimax === 'stop' ? '⏳ Stopping...' : '⏸️ Stop Node'}
                      </button>

                      <button
                        onClick={() => podAction('minimax', 'terminate')}
                        disabled={!!actionLoading.minimax}
                        style={{
                          flex: 1, padding: '0.55rem', border: 'none', borderRadius: '0.4rem',
                          background: '#ef4444', color: '#fff', fontWeight: 800, fontSize: '11px', cursor: 'pointer'
                        }}
                      >
                        {actionLoading.minimax === 'terminate' ? '⏳ Terminating...' : '🛑 Terminate & Stop Billing'}
                      </button>

                      {pods.minimax?.id && (
                        <a
                          href={`https://${pods.minimax.id}-8188.proxy.runpod.net`}
                          target="_blank"
                          rel="noreferrer"
                          style={{
                            padding: '0.55rem 0.75rem', background: '#0e182e', border: '1px solid #1a2840',
                            color: '#cbd5e1', textDecoration: 'none', borderRadius: '0.4rem', fontSize: '11px', fontWeight: 700, display: 'flex', alignItems: 'center'
                          }}
                        >
                          🌐 ComfyUI
                        </a>
                      )}
                    </div>
                  </div>
                )}

                {deployError.minimax && (
                  <div style={{ padding: '0.6rem', background: 'rgba(248,113,113,0.1)', border: '1px solid #f87171', borderRadius: '0.4rem', color: '#f87171', fontSize: '11px' }}>
                    ⚠️ {deployError.minimax}
                  </div>
                )}

                {/* MiniMax 48GB+ Deployment Card */}
                <div style={{ background: '#070c14', border: '1px solid rgba(232,185,74,0.35)', borderRadius: '0.75rem', padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div>
                      <span style={{ fontSize: '10px', fontWeight: 800, color: 'var(--gold)', textTransform: 'uppercase' }}>
                        🌟 MiniMax Hailuo 3 Engine
                      </span>
                      <h4 style={{ margin: '0.2rem 0 0', fontSize: '14px', fontWeight: 800, color: '#F2F5FA' }}>
                        Ultra High-Motion Cinema (48GB+ VRAM)
                      </h4>
                    </div>
                    <span style={{ fontSize: '11px', fontWeight: 800, color: '#38bdf8', background: '#0e182e', padding: '0.25rem 0.5rem', borderRadius: '0.3rem', border: '1px solid #1a2840' }}>
                      From ~$0.33/hr
                    </span>
                  </div>
                  <p style={{ margin: 0, fontSize: '11px', color: '#94a3b8', lineHeight: 1.45 }}>
                    MiniMax H3 uses an INT8 transformer requiring 48GB+ VRAM. It automatically provisions the lowest-cost available 48GB GPU (NVIDIA RTX A6000 / A40 at ~$0.33-$0.54/hr).
                  </p>
                  <button
                    onClick={() => deploy('minimax', 'ultra_4k')}
                    disabled={deploying.minimax}
                    style={{
                      marginTop: '0.5rem', padding: '0.65rem', borderRadius: '0.45rem',
                      background: 'linear-gradient(135deg, #E8B94A, #d97706)', border: 'none',
                      color: '#05080e', fontWeight: 900, fontSize: '11.5px', cursor: deploying.minimax ? 'not-allowed' : 'pointer'
                    }}
                  >
                    {deploying.minimax ? '⏳ Deploying MiniMax Node (48GB+)...' : '🚀 Deploy MiniMax H3 Node (48GB+)'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Live Pod Inspector & Terminal Modal */}
      <PodLogsModal
        isOpen={showPodLogsModal}
        podId={inspectorPodId}
        onClose={() => setShowPodLogsModal(false)}
        onTerminate={async () => {
          await podAction(fleetModalTab, 'terminate')
          setShowPodLogsModal(false)
        }}
      />

      {/* Modal: 4K Ultra HD GPU Pod Warning & Switcher */}
      {show4kModal && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(5, 8, 14, 0.82)',
          backdropFilter: 'blur(10px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 110
        }}>
          <div style={{ background: '#0a101d', border: '1px solid rgba(232, 185, 74, 0.4)', borderRadius: '1rem', padding: '1.75rem', width: '520px', maxWidth: '92vw', display: 'flex', flexDirection: 'column', gap: '1.25rem', boxShadow: '0 20px 60px rgba(0,0,0,0.8)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                <span style={{ fontSize: '1.5rem' }}>⚠️</span>
                <p style={{ fontWeight: 800, fontSize: '15px', margin: 0, color: 'var(--gold)' }}>4K Ultra HD Hardware Warning</p>
              </div>
              <button onClick={() => setShow4kModal(false)} style={{ background: 'none', border: 'none', color: '#96A3B6', fontSize: '15px', cursor: 'pointer' }}>×</button>
            </div>

            <div style={{ background: '#070c14', border: '1px solid #1a2840', borderRadius: '0.6rem', padding: '1rem', fontSize: '11.5px', color: '#cbd5e1', lineHeight: 1.6 }}>
              <p style={{ margin: '0 0 0.5rem' }}>
                Generating <strong>4K (3840×2160)</strong> raw video requires an <strong>Ultra 4K GPU with 48GB or 80GB VRAM</strong> (NVIDIA RTX A6000, A40, L40S, or A100).
              </p>
              <p style={{ margin: 0, color: '#f87171' }}>
                Your currently active GPU ({getPodGpuName(pods.ltx) || 'Standard Node'}) has <strong>{getPodVram(pods.ltx)}GB VRAM</strong>, which is lower than the 48GB required for raw 4K direct diffusion.
              </p>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
              <button
                onClick={() => deploy('ltx25', 'ultra_4k', pods.ltx?.id)}
                disabled={deploying.ltx25}
                style={{
                  padding: '0.75rem', borderRadius: '0.5rem', background: 'linear-gradient(135deg, #ef4444, #dc2626)',
                  color: '#fff', fontWeight: 800, fontSize: '12px', border: 'none', cursor: deploying.ltx25 ? 'not-allowed' : 'pointer'
                }}
              >
                {deploying.ltx25 ? '⏳ Deploying Ultra 4K Node...' : '🛑 Terminate 24GB & Deploy Ultra 4K (48GB/80GB)'}
              </button>

              <button
                onClick={() => deploy('ltx25', 'ultra_4k')}
                disabled={deploying.ltx25}
                style={{
                  padding: '0.7rem', borderRadius: '0.5rem', background: 'var(--gold)',
                  color: '#05080e', fontWeight: 800, fontSize: '11.5px', border: 'none', cursor: deploying.ltx25 ? 'not-allowed' : 'pointer'
                }}
              >
                ⚡ Keep 24GB & Deploy Ultra 4K Alongside
              </button>

              <button
                onClick={() => {
                  setGenRes(1) // 1080P Full HD
                  setShow4kModal(false)
                }}
                style={{
                  padding: '0.65rem', borderRadius: '0.5rem', background: '#0e182e',
                  color: '#cbd5e1', fontWeight: 700, fontSize: '11.5px', border: '1px solid #1a2840', cursor: 'pointer'
                }}
              >
                Stay on 1080P Full HD (Recommended for 24GB GPU)
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Right Drawer: AI Cinematic Prompt Generator */}
      <PromptBuilderDrawer
        isOpen={showPromptBuilder}
        onToggle={() => setShowPromptBuilder(!showPromptBuilder)}
        onWideToggle={setPromptBuilderIsWide}
        initialType={promptBuilderType}
        selectedModel={selectedModel}
        refImages={refImages}
        resolution={genRes}
        onApplyScene={(data) => {
          setGenPrompt(data.prompt)
          if (data.cameraMotion) setCameraMotion(data.cameraMotion)
          if (data.lighting) setLighting(data.lighting)
          if (data.colorPalette) setColorPalette(data.colorPalette)
        }}
        onApplyCharacter={(data) => {
          setCharName(data.name)
          setCharDesc(data.description)
          setCharNotes(data.turnaroundPrompt)
          setActiveTab('characters')
        }}
        onShotsQueued={(shots) => {
          const newJobs: Job[] = shots.map((s, idx) => ({
            id: s.id,
            promptId: s.promptId || '',
            label: s.title || `Shot #${idx + 1}`,
            prompt: s.prompt,
            seconds: s.seconds || 6,
            state: (s.state === 'running' || s.state === 'done' || s.state === 'error') ? (s.state as Job['state']) : 'queued',
            startedAt: Date.now(),
            createdAt: Date.now(),
            projectId: activeProjectId,
          }))
          setJobs(prev => [
            ...newJobs,
            ...prev.filter(p => !newJobs.some(n => n.id === p.id || (n.promptId && n.promptId === p.promptId)))
          ])
          // Switch to home tab if not on generations
          if (activeTab !== 'home' && activeTab !== 'generations') {
            setActiveTab('home')
          }
        }}
        onShotsUpdated={(shots) => {
          setJobs(prev => prev.map(job => {
            const match = shots.find(s => s.id === job.id || (s.promptId && s.promptId === job.promptId) || (s.title && s.title === job.label))
            if (match) {
              return {
                ...job,
                state: match.state as Job['state'],
                filename: match.filename ?? job.filename,
                subfolder: match.subfolder ?? job.subfolder,
                error: match.error ?? job.error,
              }
            }
            return job
          }))
        }}
        onFilmCompleted={async () => {
          await loadFilms()
          await loadGenerations()
          toast.success('🎬 Master Movie fully assembled and ready!')
        }}
      />

      {/* ── Modal: Cloudflare R2 Reference Media Gallery ── */}
      {showRefLibraryModal && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(5, 8, 14, 0.85)',
          backdropFilter: 'blur(10px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 120
        }}>
          <div style={{ background: '#0a101d', border: '1px solid rgba(232, 185, 74, 0.4)', borderRadius: '1rem', padding: '1.5rem', width: '640px', maxWidth: '94vw', maxHeight: '85vh', display: 'flex', flexDirection: 'column', gap: '1rem', boxShadow: '0 20px 60px rgba(0,0,0,0.8)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 800, color: 'var(--gold)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span>📂</span> R2 Cloud Reference Media Library
                </h3>
                <p style={{ margin: '0.2rem 0 0', fontSize: '11px', color: '#94a3b8' }}>
                  Permanent Cloudflare R2 storage for character identities, scene boards, and style references.
                </p>
              </div>
              <button onClick={() => setShowRefLibraryModal(false)} style={{ background: 'none', border: 'none', color: '#96A3B6', fontSize: '18px', cursor: 'pointer' }}>×</button>
            </div>

            <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.75rem', paddingRight: '0.25rem', minHeight: '200px' }}>
              {refLoading ? (
                <div style={{ padding: '2rem', textAlign: 'center', color: '#94a3b8', fontSize: '12px' }}>Loading R2 assets...</div>
              ) : savedReferences.length === 0 ? (
                <div style={{ padding: '3rem 1rem', textAlign: 'center', border: '1px dashed #1a2840', borderRadius: '0.75rem', color: '#64748b' }}>
                  <p style={{ fontSize: '1.75rem', margin: 0 }}>🖼️</p>
                  <p style={{ fontSize: '12px', fontWeight: 700, margin: '0.5rem 0 0', color: '#cbd5e1' }}>No reference images saved in R2 yet</p>
                  <p style={{ fontSize: '11px', color: '#64748b', margin: '0.2rem 0 0' }}>Any reference images uploaded during generation or attached to prompts will automatically appear here permanently.</p>
                </div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))', gap: '0.75rem' }}>
                  {savedReferences.map((ref) => {
                    const isSelected = refImages.includes(ref.url)
                    return (
                      <div
                        key={ref.key}
                        style={{
                          position: 'relative',
                          aspectRatio: '1',
                          borderRadius: '0.5rem',
                          overflow: 'hidden',
                          border: isSelected ? '2px solid var(--gold)' : '1px solid #1a2840',
                          background: '#030712',
                          cursor: 'pointer',
                          transition: 'all 0.15s ease',
                        }}
                        onClick={() => {
                          if (isSelected) {
                            setRefImages(prev => prev.filter(u => u !== ref.url))
                          } else {
                            if (refImages.length >= maxRefImages) {
                              toast.error(`Maximum ${maxRefImages} reference images allowed`)
                              return
                            }
                            setRefImages(prev => [...prev, ref.url])
                          }
                        }}
                      >
                        <img src={ref.url} alt={ref.filename} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, background: 'rgba(0,0,0,0.75)', padding: '2px 4px', fontSize: '8.5px', color: '#e2e8f0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {ref.filename}
                        </div>
                        {isSelected && (
                          <span style={{ position: 'absolute', top: '4px', left: '4px', background: 'var(--gold)', color: '#05080e', borderRadius: '50%', width: '18px', height: '18px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', fontWeight: 900 }}>
                            ✓
                          </span>
                        )}
                        <button
                          type="button"
                          onClick={async (e) => {
                            e.stopPropagation()
                            await fetch(`/api/videogen/references?key=${encodeURIComponent(ref.key)}`, { method: 'DELETE' })
                            setSavedReferences(prev => prev.filter(r => r.key !== ref.key))
                            setRefImages(prev => prev.filter(u => u !== ref.url))
                            toast.success('Deleted reference from R2')
                          }}
                          style={{ position: 'absolute', top: '4px', right: '4px', width: '18px', height: '18px', borderRadius: '50%', background: 'rgba(239,68,68,0.85)', color: '#fff', border: 'none', fontSize: '9px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', padding: 0 }}
                        >
                          ✕
                        </button>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: '0.75rem', borderTop: '1px solid #142033' }}>
              <span style={{ fontSize: '11px', color: '#94a3b8' }}>
                Selected: <strong style={{ color: 'var(--gold)' }}>{refImages.length} / {maxRefImages}</strong> images
              </span>
              <button
                onClick={() => setShowRefLibraryModal(false)}
                style={{ background: 'var(--gold)', color: '#05080e', border: 'none', borderRadius: '0.45rem', padding: '0.45rem 1rem', fontWeight: 800, fontSize: '11.5px', cursor: 'pointer' }}
              >
                Attach Selected & Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
