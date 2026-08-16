'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import Link from 'next/link'
import { RESOLUTIONS } from '@/lib/resolutions'
import PromptBuilderDrawer from './components/PromptBuilderDrawer'
import UsageDashboard from './components/UsageDashboard'

type PodData = {
  id: string
  name: string
  desiredStatus: string
  runtime: Record<string, unknown> | null
  machine?: { gpuDisplayName: string }
  gpuTypeId: string
  costPerHr: number
} | null

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
  const [pods, setPods] = useState<{ ltx: PodData; minimax: PodData }>({ ltx: null, minimax: null })
  const [deploying, setDeploying] = useState<{ ltx25: boolean; minimax: boolean }>({ ltx25: false, minimax: false })
  const [deployError, setDeployError] = useState<{ ltx25: string | null; minimax: string | null }>({ ltx25: null, minimax: null })
  const [actionLoading, setActionLoading] = useState<{ ltx25: string | null; minimax: string | null }>({ ltx25: null, minimax: null })

  // Active Tab navigation: 'home' | 'generations' | 'characters' | 'usage'
  const [activeTab, setActiveTab] = useState<'home' | 'generations' | 'characters' | 'usage'>('home')

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
  const [aspectRatio, setAspectRatio] = useState(0)
  const [mode, setMode] = useState<'video' | 'image'>('video')

  const [submitting, setSubmitting] = useState(false)
  const [genError, setGenError] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const [initialLoading, setInitialLoading] = useState(true)

  // Navigation & Drawer states
  const [leftNavCollapsed, setLeftNavCollapsed] = useState(false)
  const [showCharModal, setShowCharModal] = useState(false)
  const [showPodDrawer, setShowPodDrawer] = useState(false)
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

  const deleteCharHandler = async (id: string) => {
    if (!confirm('Delete character and style sheet?')) return
    await fetch(`/api/videogen/characters?id=${id}`, { method: 'DELETE' })
    await loadCharacters()
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
        }),
      })
      const data = await res.json()
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
      setGenError((e as Error).message)
    } finally {
      setSubmitting(false)
    }
  }, [genRes, selectedCharacterId, cameraMotion, colorPalette, lighting, selectedModel, activeProjectId])

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

  // Deploy / Actions handlers
  const deploy = async (model: Model, tier: 'standard' | 'ultra_4k' = selectedTier) => {
    const isLtx = model === 'ltx25'
    setDeploying(prev => ({ ...prev, [isLtx ? 'ltx25' : 'minimax']: true }))
    setDeployError(prev => ({ ...prev, [isLtx ? 'ltx25' : 'minimax']: null }))
    try {
      const res = await fetch('/api/videogen', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, tier }),
      })
      const data = await res.json()
      if (!res.ok || data.error) throw new Error(data.error || 'Deployment failed')
      await fetchStatus()
    } catch (e) {
      setDeployError(prev => ({ ...prev, [isLtx ? 'ltx25' : 'minimax']: (e as Error).message }))
    } finally {
      setDeploying(prev => ({ ...prev, [isLtx ? 'ltx25' : 'minimax']: false }))
    }
  }

  const switchPodTier = async (newTier: 'standard' | 'ultra_4k') => {
    setIsSwitchingPod(true)
    setSelectedTier(newTier)
    try {
      // 1. Terminate existing pod to avoid paying for two
      await fetch('/api/videogen', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'ltx25', action: 'terminate' }),
      })
      // 2. Deploy new tier
      await deploy('ltx25', newTier)
      setShow4kModal(false)
    } catch (e) {
      setDeployError(prev => ({ ...prev, ltx25: (e as Error).message }))
    } finally {
      setIsSwitchingPod(false)
    }
  }

  const handleResolutionChange = (val: number) => {
    const chosen = RESOLUTIONS[val]
    if (chosen && chosen.w >= 3840) {
      const gpuName = (pods.ltx?.machine?.gpuDisplayName || (pods.ltx as Record<string, unknown>)?.gpuTypeId as string || '')
      const isUltra = gpuName.includes('A100') || gpuName.includes('A6000') || gpuName.includes('A40') || gpuName.includes('L40S')
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
            { id: 'generations', label: 'My generations', icon: '🖼️' },
            { id: 'characters', label: 'Characters', icon: '👤' },
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
            <button onClick={() => setShowPodDrawer(!showPodDrawer)} style={{
              display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '11px', fontWeight: 700,
              padding: '0.45rem 0.85rem', borderRadius: '0.5rem', border: '1px solid #1a2840',
              background: ltxRunning ? 'rgba(74,222,128,0.08)' : '#070c14',
              color: ltxRunning ? '#4ade80' : '#96A3B6', cursor: 'pointer'
            }}>
              <span>⚡</span>
              GPU Pods: {ltxRunning ? 'Active' : 'Inactive'} (Configure)
            </button>

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
          {activeTab === 'home' && (
            <>
              <div style={{ textAlign: 'center', marginBottom: '2.5rem' }}>
                <h2 style={{
                  fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '1.85rem',
                  letterSpacing: '-0.02em', color: '#F2F5FA', textTransform: 'uppercase', marginBottom: '1.25rem'
                }}>
                  BRING YOUR STORIES TO LIFE
                </h2>
                <div style={{ display: 'flex', justifyContent: 'center', gap: '0.5rem', opacity: 0.6 }}>
                  <span style={{ fontSize: '11px', background: '#121F35', padding: '0.2rem 0.6rem', borderRadius: '0.25rem' }}>Zephyr</span>
                  <span style={{ fontSize: '11px', background: '#121F35', padding: '0.2rem 0.6rem', borderRadius: '0.25rem' }}>Cully Hill Boys</span>
                  <span style={{ fontSize: '11px', background: '#121F35', padding: '0.2rem 0.6rem', borderRadius: '0.25rem' }}>Hell Grind</span>
                </div>
              </div>

              {/* Generation Input Box */}
              <div style={{
                background: 'rgba(14,23,38,0.75)', border: '1px solid #1a2840', borderRadius: '1.25rem',
                padding: '1.5rem', boxShadow: '0 12px 32px rgba(0,0,0,0.5)', backdropFilter: 'blur(16px)',
                marginBottom: '2.5rem'
              }}>
                <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
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
                  <textarea
                    value={genPrompt}
                    onChange={e => setGenPrompt(e.target.value)}
                    placeholder="Describe your scene — use @ to add characters & locations..."
                    style={{
                      flex: 1, height: '90px', background: '#070c14', border: '1px solid #1a2840',
                      borderRadius: '0.75rem', padding: '0.85rem', color: '#F2F5FA', fontSize: '13px',
                      outline: 'none', resize: 'none', fontFamily: 'inherit'
                    }}
                  />
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
                    <h3 style={{ fontSize: '11px', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700, margin: 0 }}>
                      Generating
                    </h3>
                    <button
                      onClick={() => setActiveTab('generations')}
                      style={{ fontSize: '10px', color: 'var(--gold)', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 700 }}
                    >
                      View all →
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
                        {j.state === 'done' && j.filename ? (
                          <video
                            src={`/api/videogen/video?filename=${encodeURIComponent(j.filename)}&subfolder=${encodeURIComponent(j.subfolder ?? 'gen')}`}
                            controls loop playsInline autoPlay muted
                            style={{ width: '100%', height: '160px', objectFit: 'cover', background: '#000' }}
                          />
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

                        {/* Download when done */}
                        {j.state === 'done' && j.filename && (
                          <div style={{ padding: '0 0.75rem 0.65rem', display: 'flex', gap: '0.5rem' }}>
                            <a
                              href={`/api/videogen/video?filename=${encodeURIComponent(j.filename)}&subfolder=${encodeURIComponent(j.subfolder ?? 'gen')}`}
                              download
                              style={{ flex: 1, background: 'var(--gold)', color: '#05080e', textAlign: 'center', textDecoration: 'none', fontWeight: 800, borderRadius: '0.4rem', padding: '0.35rem', fontSize: '11px' }}
                            >
                              ⬇ Download MP4
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
          )}

          {/* Tab 2: MY GENERATIONS HISTORY */}
          {activeTab === 'generations' && (
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
                            {j.state === 'done' && j.filename ? (
                              <video
                                src={`/api/videogen/video?filename=${encodeURIComponent(j.filename)}&subfolder=${encodeURIComponent(j.subfolder ?? 'gen')}`}
                                controls loop playsInline
                                style={{ width: '100%', height: '160px', objectFit: 'cover', borderRadius: '0.5rem', background: '#000' }}
                              />
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
                                onClick={async () => {
                                  if (!confirm('Delete this video generation record?')) return
                                  try {
                                    await fetch(`/api/videogen/generate?id=${encodeURIComponent(j.id)}`, { method: 'DELETE' })
                                    setJobs(prev => prev.filter(x => x.id !== j.id && x.promptId !== j.promptId))
                                  } catch (err) {
                                    alert((err as Error).message)
                                  }
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
                </div>
              )}
            </div>
          )}

          {/* Tab 3: CHARACTERS & STYLE SHEET MANAGER */}
          {activeTab === 'characters' && (
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
                              alert(`Custom Voice ID: ${charVoiceId}`)
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
          )}

          {/* TAB 4: USAGE & COST MONITOR */}
          {activeTab === 'usage' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', width: '100%', padding: '0.5rem 0' }}>
              <UsageDashboard />
            </div>
          )}
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
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(5, 8, 14, 0.75)',
          backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100
        }}>
          <div style={{ background: '#0e182e', border: '1px solid #1a2840', borderRadius: '1rem', padding: '1.5rem', width: '480px', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <p style={{ fontWeight: 800, fontSize: '14px', margin: 0, color: 'var(--gold)' }}>⚡ Compute Nodes (RunPod GPU Control)</p>
              <button onClick={() => setShowPodDrawer(false)} style={{ background: 'none', border: 'none', color: '#96A3B6', fontSize: '14px', cursor: 'pointer' }}>×</button>
            </div>

            <div style={{ background: '#070c14', border: '1px solid #1a2840', borderRadius: '0.75rem', padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <div>
                <p style={{ fontWeight: 800, fontSize: '13px', margin: 0 }}>LTX 2.5 Compute Node</p>
                <p style={{ fontSize: '10px', color: '#64748b', margin: '0.15rem 0 0' }}>
                  {pods.ltx?.machine?.gpuDisplayName || 'Dynamic GPU Tier Allocation'}
                </p>
              </div>

              {/* Tier Selection Radio */}
              {!ltxRunning && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', padding: '0.5rem', background: '#0e182e', borderRadius: '0.5rem', border: '1px solid #1a2840' }}>
                  <span style={{ fontSize: '9.5px', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase' }}>Select GPU Hardware Tier:</span>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '11px', cursor: 'pointer', color: selectedTier === 'standard' ? 'var(--gold)' : '#cbd5e1' }}>
                    <input
                      type="radio"
                      name="gpuTier"
                      checked={selectedTier === 'standard'}
                      onChange={() => setSelectedTier('standard')}
                    />
                    <span><strong>Standard (24GB VRAM)</strong> · RTX 3090/4090 (~$0.22-$0.34/hr) — Best for 720p/1080p</span>
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '11px', cursor: 'pointer', color: selectedTier === 'ultra_4k' ? 'var(--gold)' : '#cbd5e1' }}>
                    <input
                      type="radio"
                      name="gpuTier"
                      checked={selectedTier === 'ultra_4k'}
                      onChange={() => setSelectedTier('ultra_4k')}
                    />
                    <span><strong>Ultra 4K (48GB/80GB VRAM)</strong> · A6000/A40/L40S/A100 (~$0.35-$1.19/hr) — Required for 4K</span>
                  </label>
                </div>
              )}

              <div style={{ fontSize: '11px', color: ltxRunning ? '#4ade80' : '#f87171', fontWeight: 700 }}>
                Status: {ltxRunning ? 'RUNNING (Online)' : 'OFFLINE (Stopped)'}
              </div>

              {deployError.ltx25 && (
                <div style={{ padding: '0.5rem', background: 'rgba(248,113,113,0.1)', border: '1px solid #f87171', borderRadius: '0.35rem', color: '#f87171', fontSize: '10.5px' }}>
                  ⚠️ {deployError.ltx25}
                </div>
              )}

              {!ltxRunning ? (
                <button
                  onClick={() => deploy('ltx25', selectedTier)}
                  disabled={deploying.ltx25}
                  style={{
                    width: '100%', padding: '0.6rem', border: 'none', borderRadius: '0.4rem',
                    background: deploying.ltx25 ? '#1a2840' : 'var(--gold)',
                    color: deploying.ltx25 ? '#64748b' : '#05080e',
                    fontWeight: 800, fontSize: '11.5px', cursor: deploying.ltx25 ? 'not-allowed' : 'pointer'
                  }}
                >
                  {deploying.ltx25 ? '⚡ Deploying GPU Node...' : `🚀 Deploy ${selectedTier === 'ultra_4k' ? 'Ultra 4K (48GB+)' : 'Standard (24GB)'} Node`}
                </button>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <button
                      onClick={() => podAction('ltx25', 'stop')}
                      disabled={!!actionLoading.ltx25}
                      style={{
                        flex: 1, padding: '0.6rem', border: '1px solid rgba(248,113,113,0.4)', borderRadius: '0.4rem',
                        background: actionLoading.ltx25 === 'stop' ? '#1a2840' : 'rgba(248,113,113,0.15)',
                        color: actionLoading.ltx25 === 'stop' ? '#94a3b8' : '#f87171',
                        fontWeight: 800, fontSize: '11px', cursor: actionLoading.ltx25 ? 'not-allowed' : 'pointer'
                      }}
                    >
                      {actionLoading.ltx25 === 'stop' ? '⏳ Stopping Node...' : '⏸️ Stop Node'}
                    </button>
                    <button
                      onClick={() => {
                        if (confirm('Terminate GPU pod? This destroys the pod and halts all hourly billing.')) {
                          podAction('ltx25', 'terminate')
                        }
                      }}
                      disabled={!!actionLoading.ltx25}
                      style={{
                        flex: 1, padding: '0.6rem', border: 'none', borderRadius: '0.4rem',
                        background: actionLoading.ltx25 === 'terminate' ? '#1a2840' : '#ef4444',
                        color: '#ffffff', fontWeight: 800, fontSize: '11px', cursor: actionLoading.ltx25 ? 'not-allowed' : 'pointer'
                      }}
                    >
                      {actionLoading.ltx25 === 'terminate' ? '⏳ Terminating...' : '🛑 Terminate & Stop Billing'}
                    </button>
                  </div>

                  {/* Quick Switch Tier Button */}
                  <button
                    onClick={() => {
                      const newTier = selectedTier === 'standard' ? 'ultra_4k' : 'standard'
                      if (confirm(`Switch pod to ${newTier === 'ultra_4k' ? 'Ultra 4K (48GB/80GB)' : 'Standard (24GB)'}? This will terminate the current node and start the new tier.`)) {
                        switchPodTier(newTier)
                      }
                    }}
                    disabled={isSwitchingPod}
                    style={{
                      width: '100%', padding: '0.5rem', background: '#0e182e', border: '1px solid #1a2840',
                      color: 'var(--gold)', borderRadius: '0.4rem', fontSize: '10.5px', fontWeight: 700, cursor: 'pointer'
                    }}
                  >
                    {isSwitchingPod ? '⏳ Switching Node Tier...' : '🔄 Switch to Different GPU Tier'}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

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
                Your currently active GPU has <strong>24GB VRAM</strong>, which will run out of CUDA memory during 4K diffusion.
              </p>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
              <button
                onClick={() => switchPodTier('ultra_4k')}
                disabled={isSwitchingPod}
                style={{
                  padding: '0.75rem', borderRadius: '0.5rem', background: 'var(--gold)',
                  color: '#05080e', fontWeight: 800, fontSize: '12px', border: 'none', cursor: isSwitchingPod ? 'not-allowed' : 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem'
                }}
              >
                {isSwitchingPod ? '⏳ Terminating 24GB & Starting 48GB/80GB Pod...' : '🚀 Switch to Ultra 4K (48GB/80GB) Pod & Set 4K'}
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
      />
    </div>
  )
}
