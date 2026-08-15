'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import Link from 'next/link'
import { RESOLUTIONS } from '@/lib/resolutions'

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
  seconds: number
  state: 'queued' | 'running' | 'done' | 'error'
  filename?: string
  subfolder?: string
  error?: string
  startedAt: number
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

  // Active Tab navigation: 'home' | 'generations' | 'characters'
  const [activeTab, setActiveTab] = useState<'home' | 'generations' | 'characters'>('home')

  // Projects state
  const [projects, setProjects] = useState<Project[]>([])
  const [activeProjectId, setActiveProjectId] = useState<string>('default-project')
  const [showNewProjectModal, setShowNewProjectModal] = useState(false)
  const [newProjectName, setNewProjectName] = useState('')

  // Custom generations state
  const [jobs, setJobs] = useState<Job[]>([])
  const [films, setFilms] = useState<Film[]>([])
  const [characters, setCharacters] = useState<Character[]>([])
  const [genPrompt, setGenPrompt] = useState('')
  const [genSeconds, setGenSeconds] = useState(8)
  const [genRes, setGenRes] = useState(0)
  const [selectedCharacterId, setSelectedCharacterId] = useState<string>('')
  
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

  // Modals / dropdown flags
  const [showCharModal, setShowCharModal] = useState(false)
  const [showPodDrawer, setShowPodDrawer] = useState(false)
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
      const res = await fetch('/api/admin/videogen', { cache: 'no-store' })
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
      const res = await fetch('/api/admin/videogen/projects', { cache: 'no-store' })
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
      const res = await fetch('/api/admin/videogen/characters', { cache: 'no-store' })
      if (res.ok) setCharacters((await res.json()).characters ?? [])
    } catch {
      // ignore
    }
  }, [])

  const loadFilms = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/videogen/assemble', { cache: 'no-store' })
      if (res.ok) setFilms((await res.json()).films ?? [])
    } catch {
      // ignore
    }
  }, [])

  useEffect(() => {
    ;(async () => {
      try {
        await Promise.all([fetchStatus(), loadProjects(), loadCharacters(), loadFilms()])
      } catch {
        // ignore
      } finally {
        setInitialLoading(false)
      }
    })()
  }, [fetchStatus, loadProjects, loadCharacters, loadFilms])

  const createProject = async () => {
    if (!newProjectName.trim()) return
    try {
      const res = await fetch('/api/admin/videogen/projects', {
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

      const res = await fetch('/api/admin/videogen/characters', { method: 'POST', body: fd })
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
    await fetch(`/api/admin/videogen/characters?id=${id}`, { method: 'DELETE' })
    await loadCharacters()
  }

  // Generation trigger
  const generate = useCallback(async (opts: { prompt: string; label: string; seconds: number }) => {
    setSubmitting(true)
    setGenError(null)
    const r = RESOLUTIONS[aspectRatio]
    
    try {
      const res = await fetch('/api/admin/videogen/generate', {
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
  }, [aspectRatio, selectedCharacterId, cameraMotion, colorPalette, lighting, selectedModel, activeProjectId])

  // Poll pending
  const pending = jobs.filter(j => j.state === 'queued' || j.state === 'running')
  const pendingKey = pending.map(j => j.promptId).join(',')

  useEffect(() => {
    if (!pendingKey) return
    let cancelled = false

    const tick = async () => {
      try {
        const res = await fetch(`/api/admin/videogen/status?ids=${pendingKey}`, { cache: 'no-store' })
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
  const deploy = async (model: Model) => {
    const isLtx = model === 'ltx25'
    setDeploying(prev => ({ ...prev, [isLtx ? 'ltx25' : 'minimax']: true }))
    try {
      const res = await fetch('/api/admin/videogen', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model }),
      })
      if (!res.ok) throw new Error((await res.json()).error || 'Deployment failed')
      await fetchStatus()
    } catch (e) {
      setDeployError(prev => ({ ...prev, [isLtx ? 'ltx25' : 'minimax']: (e as Error).message }))
    } finally {
      setDeploying(prev => ({ ...prev, [isLtx ? 'ltx25' : 'minimax']: false }))
    }
  }

  const podAction = async (model: Model, action: string) => {
    const isLtx = model === 'ltx25'
    setActionLoading(prev => ({ ...prev, [isLtx ? 'ltx25' : 'minimax']: action }))
    try {
      const res = await fetch('/api/admin/videogen', {
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
    <div style={{ display: 'flex', background: '#05080e', minHeight: '100vh', color: '#F2F5FA', fontFamily: 'var(--font-body)' }}>
      {/* ── Left Sidebar Navigation ── */}
      <aside style={{
        width: '240px', background: '#070c14', borderRight: '1px solid #1a2840',
        padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '2rem', flexShrink: 0,
      }}>
        {/* Brand/App Title */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <span style={{ fontSize: '1.5rem' }}>🌌</span>
          <div>
            <h1 style={{ fontSize: '15px', fontWeight: 800, fontFamily: 'var(--font-display)', color: 'var(--gold)', letterSpacing: '0.04em', margin: 0 }}>
              CINEMA STUDIO
            </h1>
            <p style={{ fontSize: '9px', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.08em', margin: 0 }}>
              AI Movie Engine
            </p>
          </div>
        </div>

        {/* Menu Links */}
        <nav style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
          {[
            { id: 'home', label: 'Home', icon: '🏠' },
            { id: 'generations', label: 'My generations', icon: '🖼️' },
            { id: 'characters', label: 'Characters', icon: '👤' },
          ].map(item => {
            const active = activeTab === item.id
            return (
              <button key={item.id} onClick={() => setActiveTab(item.id as typeof activeTab)} style={{
                display: 'flex', alignItems: 'center', gap: '0.85rem', padding: '0.65rem 0.85rem',
                borderRadius: '0.5rem', fontSize: '13px', border: 'none', textAlign: 'left', cursor: 'pointer',
                fontWeight: active ? 700 : 500,
                background: active ? 'rgba(232, 185, 74, 0.1)' : 'transparent',
                color: active ? 'var(--gold)' : '#96A3B6',
              }}>
                <span>{item.icon}</span>
                {item.label}
              </button>
            )
          })}

          <Link href="/admin/videogen/studio" style={{
            display: 'flex', alignItems: 'center', gap: '0.85rem', padding: '0.65rem 0.85rem',
            borderRadius: '0.5rem', fontSize: '13px', textDecoration: 'none', fontWeight: 600,
            color: 'var(--gold)', background: 'rgba(232, 185, 74, 0.05)', marginTop: '0.5rem',
            border: '1px solid rgba(232, 185, 74, 0.2)'
          }}>
            <span>🎥</span> Movie Studio →
          </Link>
        </nav>

        {/* Active Project Card */}
        <div style={{
          background: '#0e182e', border: '1px solid #1a2840', borderRadius: '0.75rem', padding: '1rem',
          marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: '0.5rem'
        }}>
          <p style={{ fontSize: '10px', color: '#64748b', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', margin: 0 }}>
            Active Project
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '13px', fontWeight: 700, color: 'var(--gold)' }}>
            <span>📁</span> {activeProjectName}
          </div>
          <button onClick={() => setShowNewProjectModal(true)} style={{
            background: 'none', border: '1px dashed #1a2840', color: '#96A3B6', borderRadius: '0.35rem',
            padding: '0.35rem', fontSize: '11px', cursor: 'pointer', marginTop: '0.25rem'
          }}>
            + Create New Project
          </button>
        </div>
      </aside>

      {/* ── Main Panel Area ── */}
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>
        
        {/* Top Header Row */}
        <header style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '1rem 2.5rem', borderBottom: '1px solid #1a2840', background: '#05080e',
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

            <Link href="/admin/videogen/movie" style={{
              fontSize: '11px', textDecoration: 'none', fontWeight: 700, color: 'var(--gold)',
              padding: '0.45rem 0.85rem', borderRadius: '0.5rem',
              border: '1px solid rgba(232,185,74,0.25)', background: 'rgba(232,185,74,0.06)',
            }}>
              🎬 Movie Studio →
            </Link>

            <div style={{ width: '28px', height: '28px', borderRadius: '50%', background: 'var(--gold)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#05080e', fontWeight: 'bold', fontSize: '11px' }}>
              SR
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
                      <select value={genRes} onChange={e => setGenRes(Number(e.target.value))} style={{
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
              <h2 style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--gold)', marginBottom: '1rem' }}>
                MY GENERATIONS & VIDEO HISTORY
              </h2>
              
              {jobs.length === 0 && films.length === 0 ? (
                <div style={{ background: '#0e182e', border: '1px dashed #1a2840', borderRadius: '1rem', padding: '3rem', textAlign: 'center', color: '#64748b' }}>
                  <p style={{ fontSize: '1.5rem', margin: 0 }}>🎥</p>
                  <p style={{ fontSize: '13px', fontWeight: 600, marginTop: '0.5rem' }}>No video generations yet for this project.</p>
                  <button onClick={() => setActiveTab('home')} style={{
                    background: 'var(--gold)', color: '#05080e', border: 'none', borderRadius: '0.5rem',
                    padding: '0.5rem 1rem', fontWeight: 800, fontSize: '12px', cursor: 'pointer', marginTop: '1rem'
                  }}>
                    Create Your First Generation
                  </button>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                  {/* Generated Clips */}
                  <div>
                    <h3 style={{ fontSize: '12px', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700, marginBottom: '0.75rem' }}>
                      Generated Clips
                    </h3>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '1rem' }}>
                      {jobs.map(j => (
                        <div key={j.id} style={{ background: '#0e182e', border: '1px solid #1a2840', borderRadius: '0.75rem', padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                          {j.state === 'done' && j.filename ? (
                            <video src={`/api/admin/videogen/video?filename=${encodeURIComponent(j.filename)}&subfolder=${encodeURIComponent(j.subfolder ?? 'gen')}`}
                              controls loop playsInline style={{ width: '100%', height: '150px', objectFit: 'cover', borderRadius: '0.5rem', background: '#000' }} />
                          ) : (
                            <div style={{ height: '150px', background: '#070c14', borderRadius: '0.5rem', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--gold)', fontWeight: 700, fontSize: '12px' }}>
                              {j.state.toUpperCase()}…
                            </div>
                          )}
                          <div>
                            <p style={{ fontWeight: 700, fontSize: '13px', margin: 0 }}>{j.label}</p>
                            <p style={{ fontSize: '11px', color: '#96A3B6', lineHeight: 1.4, margin: '0.3rem 0 0' }}>{j.prompt}</p>
                          </div>
                          <div style={{ display: 'flex', gap: '0.5rem' }}>
                            <button onClick={() => copyToClipboard(j.prompt, j.id)} style={{ flex: 1, background: '#070c14', border: '1px solid #1a2840', color: '#96A3B6', borderRadius: '0.35rem', padding: '0.3rem', fontSize: '10px', cursor: 'pointer' }}>
                              {copied === j.id ? 'Copied!' : 'Copy Prompt'}
                            </button>
                            {j.filename && (
                              <a href={`/api/admin/videogen/video?filename=${encodeURIComponent(j.filename)}&subfolder=${encodeURIComponent(j.subfolder ?? 'gen')}`} download style={{ flex: 1, background: 'var(--gold)', color: '#05080e', textAlign: 'center', textDecoration: 'none', fontWeight: 700, borderRadius: '0.35rem', padding: '0.3rem', fontSize: '10px' }}>
                                Download MP4
                              </a>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Assembled Stitched Movies */}
                  {films.length > 0 && (
                    <div>
                      <h3 style={{ fontSize: '12px', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700, marginBottom: '0.75rem' }}>
                        Rendered Movies
                      </h3>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '1rem' }}>
                        {films.map(f => (
                          <div key={f.id} style={{ background: '#0e182e', border: '1px solid #1a2840', borderRadius: '0.75rem', padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                            {f.file ? (
                              <video src={`/api/admin/videogen/assemble?file=${encodeURIComponent(f.file)}`} controls loop playsInline style={{ width: '100%', height: '150px', objectFit: 'cover', borderRadius: '0.5rem', background: '#000' }} />
                            ) : (
                              <div style={{ height: '150px', background: '#070c14', borderRadius: '0.5rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                Processing Film...
                              </div>
                            )}
                            <div>
                              <p style={{ fontWeight: 700, fontSize: '13px', margin: 0, color: 'var(--gold)' }}>{f.title}</p>
                              <p style={{ fontSize: '10px', color: '#64748b', margin: '0.2rem 0 0' }}>Duration: {f.duration}s</p>
                            </div>
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
                <h3 style={{ fontSize: '13px', fontWeight: 700, margin: 0, color: '#F2F5FA' }}>+ Add New Character</h3>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                  <div>
                    <label style={{ fontSize: '10px', color: '#64748b', textTransform: 'uppercase', fontWeight: 700, display: 'block', marginBottom: '0.3rem' }}>Character Name</label>
                    <input type="text" value={charName} onChange={e => setCharName(e.target.value)} placeholder="e.g. Meera" style={{ width: '100%', padding: '0.5rem', borderRadius: '0.4rem', background: '#070c14', border: '1px solid #1a2840', color: '#fff', fontSize: '12px' }} />
                  </div>
                  <div>
                    <label style={{ fontSize: '10px', color: '#64748b', textTransform: 'uppercase', fontWeight: 700, display: 'block', marginBottom: '0.3rem' }}>Mapped Voice ID (ElevenLabs)</label>
                    <input type="text" value={charVoiceId} onChange={e => setCharVoiceId(e.target.value)} placeholder="e.g. 21m00Tcm4TlvDq8ikWAM" style={{ width: '100%', padding: '0.5rem', borderRadius: '0.4rem', background: '#070c14', border: '1px solid #1a2840', color: '#fff', fontSize: '12px' }} />
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
                      <img src={`/api/admin/videogen/characters?image=${encodeURIComponent(c.imageFile)}`} alt={c.name} style={{ width: '100%', height: '140px', objectFit: 'cover' }} />
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
          <div style={{ background: '#0e182e', border: '1px solid #1a2840', borderRadius: '1rem', padding: '1.5rem', width: '380px', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <p style={{ fontWeight: 800, fontSize: '14px', margin: 0, color: 'var(--gold)' }}>Select Character Reference</p>
              <button onClick={() => setShowCharModal(false)} style={{ background: 'none', border: 'none', color: '#96A3B6', fontSize: '14px', cursor: 'pointer' }}>×</button>
            </div>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxHeight: '240px', overflowY: 'auto' }}>
              <div onClick={() => { setSelectedCharacterId(''); setShowCharModal(false) }} style={{ padding: '0.65rem 0.85rem', borderRadius: '0.5rem', background: !selectedCharacterId ? 'rgba(232,185,74,0.08)' : '#070c14', border: '1px solid #1a2840', cursor: 'pointer', fontSize: '12px' }}>
                🚫 No character reference
              </div>
              {characters.map(char => (
                <div key={char.id} onClick={() => { setSelectedCharacterId(char.id); setShowCharModal(false) }} style={{ padding: '0.65rem 0.85rem', borderRadius: '0.5rem', background: selectedCharacterId === char.id ? 'rgba(232,185,74,0.08)' : '#070c14', border: '1px solid #1a2840', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                  {char.imageFile ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={`/api/admin/videogen/characters?image=${encodeURIComponent(char.imageFile)}`} alt={char.name} style={{ width: '28px', height: '28px', borderRadius: '50%', objectFit: 'cover' }} />
                  ) : (
                    <span style={{ fontSize: '1rem' }}>👤</span>
                  )}
                  <div>
                    <p style={{ fontWeight: 700, fontSize: '12px', margin: 0 }}>{char.name}</p>
                    <p style={{ fontSize: '10px', color: '#64748b', margin: 0 }}>{char.description.slice(0, 40)}…</p>
                  </div>
                </div>
              ))}
            </div>
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
                <p style={{ fontWeight: 800, fontSize: '13px', margin: 0 }}>LTX 2.5 Node</p>
                <p style={{ fontSize: '10px', color: '#64748b', margin: '0.15rem 0 0' }}>RTX L40S GPU</p>
              </div>
              <div style={{ fontSize: '11px', color: ltxRunning ? '#4ade80' : '#f87171', fontWeight: 700 }}>
                Status: {ltxRunning ? 'RUNNING' : 'OFFLINE'}
              </div>
              {!ltxRunning ? (
                <button onClick={() => deploy('ltx25')} disabled={deploying.ltx25} style={{ width: '100%', padding: '0.5rem', border: 'none', borderRadius: '0.3rem', background: 'var(--gold)', color: '#05080e', fontWeight: 800, fontSize: '11px', cursor: 'pointer' }}>
                  {deploying.ltx25 ? 'Deploying...' : 'Deploy Node'}
                </button>
              ) : (
                <button onClick={() => podAction('ltx25', 'stop')} disabled={actionLoading.ltx25 === 'stop'} style={{ width: '100%', padding: '0.5rem', border: 'none', borderRadius: '0.3rem', background: '#ef4444', color: '#ffffff', fontWeight: 800, fontSize: '11px', cursor: 'pointer' }}>
                  {actionLoading.ltx25 === 'stop' ? 'Stopping...' : 'Stop Node'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
