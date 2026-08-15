'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import Link from 'next/link'
import { RESOLUTIONS, DEFAULT_RESOLUTION } from '@/lib/resolutions'

type Character = {
  id: string
  name: string
  description: string
  imageFile?: string
  createdAt: number
}

type Scene = {
  id: string
  order: number
  title: string
  prompt: string
  seconds: number
  characterId?: string
  narration?: string
  promptId?: string
  filename?: string
  subfolder?: string
  state?: 'idle' | 'queued' | 'running' | 'done' | 'error'
  error?: string
  audioMode?: string
}

type Storyboard = {
  id: string
  title: string
  resolution: number
  audioMode: string
  voiceId?: string
  scenes: Scene[]
  createdAt: number
  updatedAt: number
}

type Voice = { voiceId: string; name: string; category: string; previewUrl?: string }

type CaptionStyle = {
  enabled: boolean
  font: string
  fontSize: number
  color: string
  outlineColor: string
  outlineWidth: number
  position: string
  boxed: boolean
  uppercase: boolean
}

type Film = {
  id: string
  title: string
  state: 'building' | 'done' | 'error'
  file?: string
  bytes?: number
  duration?: number
  error?: string
  createdAt: number
}

const DEFAULT_CAPTIONS: CaptionStyle = {
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

const fmtBytes = (n: number) =>
  n > 1e9 ? `${(n / 1e9).toFixed(2)} GB` : n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${(n / 1e3).toFixed(0)} KB`

const AUDIO_MODES = [
  { key: 'native', label: 'Model Audio (Ambience & FX)', hint: "LTX 2.5's native atmospheric sound design." },
  { key: 'elevenlabs', label: 'ElevenLabs Voiceover', hint: 'AI scripted narration with character voice mapping.' },
  { key: 'both', label: 'Both (Layered FX + Voice)', hint: 'Background ambience layered under narrator voice.' },
  { key: 'none', label: 'Silent (No Audio)', hint: 'Pure video export without sound.' },
]

const uid = () => Math.random().toString(36).slice(2, 10)

const emptyScene = (order: number): Scene => ({
  id: uid(),
  order,
  title: `Scene ${order + 1}`,
  prompt: '',
  seconds: 8,
  state: 'idle',
})

function totalDuration(scenes: Scene[]) {
  const raw = scenes.reduce((n, s) => n + s.seconds, 0)
  return Math.max(0, raw - Math.max(0, scenes.length - 1))
}

export default function StudioClient() {
  const [characters, setCharacters] = useState<Character[]>([])
  const [board, setBoard] = useState<Storyboard | null>(null)
  const [boards, setBoards] = useState<Storyboard[]>([])
  const [voices, setVoices] = useState<Voice[]>([])
  const [podRunning, setPodRunning] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  // Sidebar Tab state ('settings' | 'cast' | 'captions')
  const [sidebarTab, setSidebarTab] = useState<'settings' | 'cast' | 'captions'>('settings')

  // New character inline form state
  const [newCharName, setNewCharName] = useState('')
  const [newCharDesc, setNewCharDesc] = useState('')
  const [newCharFile, setNewCharFile] = useState<File | null>(null)
  const [savingChar, setSavingChar] = useState(false)

  // Assembly state
  const [captions, setCaptions] = useState<CaptionStyle>(DEFAULT_CAPTIONS)
  const [fonts, setFonts] = useState<string[]>([])
  const [positions, setPositions] = useState<{ key: string; label: string }[]>([])
  const [films, setFilms] = useState<Film[]>([])
  const [diskBytes, setDiskBytes] = useState(0)
  const [assembling, setAssembling] = useState(false)

  // Voiceover generator loading state per scene
  const [voLoadingId, setVoLoadingId] = useState<string | null>(null)
  const [voAudioUrls, setVoAudioUrls] = useState<Record<string, string>>({})

  const loadFilms = useCallback(async () => {
    try {
      const r = await fetch('/api/videogen/assemble', { cache: 'no-store' })
      if (!r.ok) return
      const d = await r.json()
      setFilms(d.films ?? [])
      setDiskBytes(d.diskBytes ?? 0)
      if (d.fonts?.length) setFonts(d.fonts)
      if (d.positions?.length) setPositions(d.positions)
    } catch {
      // ignore
    }
  }, [])

  const loadCharacters = useCallback(async () => {
    try {
      const r = await fetch('/api/videogen/characters', { cache: 'no-store' })
      if (r.ok) setCharacters((await r.json()).characters ?? [])
    } catch {
      // ignore
    }
  }, [])

  useEffect(() => {
    ;(async () => {
      try {
        const [c, sb, v, pods] = await Promise.all([
          fetch('/api/videogen/characters', { cache: 'no-store' }).then(r => r.ok ? r.json() : { characters: [] }),
          fetch('/api/videogen/storyboard', { cache: 'no-store' }).then(r => r.ok ? r.json() : { storyboards: [] }),
          fetch('/api/videogen/voices', { cache: 'no-store' }).then(r => r.ok ? r.json() : { voices: [] }),
          fetch('/api/videogen', { cache: 'no-store' }).then(r => r.ok ? r.json() : null),
        ])
        setCharacters(c.characters ?? [])
        const initialBoards = sb.storyboards?.length ? sb.storyboards : [{
          id: uid(), title: 'Untitled Movie', resolution: DEFAULT_RESOLUTION,
          audioMode: 'native', voiceId: v.voices?.[0]?.voiceId,
          scenes: [emptyScene(0)], createdAt: Date.now(), updatedAt: Date.now(),
        }]
        setBoards(initialBoards)
        setVoices(v.voices ?? [])
        setPodRunning(pods?.ltx?.desiredStatus === 'RUNNING')
        setBoard(initialBoards[0])
        await loadFilms()
      } catch (e) {
        setErr((e as Error).message)
      } finally {
        setLoading(false)
      }
    })()
  }, [loadFilms])

  const building = films.some(f => f.state === 'building')
  useEffect(() => {
    if (!building) return
    const iv = setInterval(loadFilms, 4000)
    return () => clearInterval(iv)
  }, [building, loadFilms])

  const persist = useCallback(async (b: Storyboard) => {
    setSaving(true)
    try {
      const res = await fetch('/api/videogen/storyboard', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(b),
      })
      const data = await res.json()
      if (data.storyboard) {
        setBoards(prev => {
          const rest = prev.filter(x => x.id !== data.storyboard.id)
          return [data.storyboard, ...rest]
        })
      }
    } catch {
      // ignore
    } finally {
      setSaving(false)
    }
  }, [])

  const update = (patch: Partial<Storyboard>) => {
    setBoard(b => {
      if (!b) return b
      const next = { ...b, ...patch }
      persist(next)
      return next
    })
  }

  const updateScene = (s: Scene) => {
    setBoard(b => {
      if (!b) return b
      const scenes = b.scenes.map(x => x.id === s.id ? s : x)
      const next = { ...b, scenes }
      persist(next)
      return next
    })
  }

  const moveScene = (index: number, direction: 'up' | 'down') => {
    if (!board) return
    const newIndex = direction === 'up' ? index - 1 : index + 1
    if (newIndex < 0 || newIndex >= board.scenes.length) return
    const newScenes = [...board.scenes]
    const temp = newScenes[index]
    newScenes[index] = newScenes[newIndex]
    newScenes[newIndex] = temp
    const updatedScenes = newScenes.map((s, idx) => ({ ...s, order: idx }))
    const updatedBoard = { ...board, scenes: updatedScenes }
    setBoard(updatedBoard)
    persist(updatedBoard)
  }

  const createNewStoryboard = async () => {
    const newSb: Storyboard = {
      id: uid(),
      title: `New Movie ${boards.length + 1}`,
      resolution: DEFAULT_RESOLUTION,
      audioMode: 'native',
      voiceId: voices[0]?.voiceId,
      scenes: [emptyScene(0)],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    await persist(newSb)
    setBoard(newSb)
  }

  const deleteCurrentStoryboard = async () => {
    if (!board) return
    if (!confirm(`Delete "${board.title}"?`)) return
    try {
      const res = await fetch(`/api/videogen/storyboard?id=${board.id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Delete failed')
      const remaining = boards.filter(b => b.id !== board.id)
      setBoards(remaining)
      if (remaining.length > 0) setBoard(remaining[0])
      else createNewStoryboard()
    } catch (e) {
      setErr((e as Error).message)
    }
  }

  const generateScene = async (sceneId: string) => {
    if (!board) return
    setErr(null)
    await persist(board)
    try {
      const res = await fetch('/api/videogen/storyboard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: board.id, sceneIds: [sceneId] }),
      })
      const data = await res.json()
      if (!res.ok || data.error) throw new Error(data.error || 'Generation failed')
      if (data.storyboard) setBoard(data.storyboard)
    } catch (e) {
      setErr((e as Error).message)
    }
  }

  const generateAllScenes = async () => {
    if (!board) return
    setErr(null)
    await persist(board)
    try {
      const res = await fetch('/api/videogen/storyboard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: board.id }),
      })
      const data = await res.json()
      if (!res.ok || data.error) throw new Error(data.error || 'Generation failed')
      if (data.storyboard) setBoard(data.storyboard)
    } catch (e) {
      setErr((e as Error).message)
    }
  }

  const assembleMovie = async () => {
    if (!board) return
    setErr(null)
    setAssembling(true)
    try {
      await persist(board)
      const res = await fetch('/api/videogen/assemble', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storyboardId: board.id, captions }),
      })
      const data = await res.json()
      if (!res.ok || data.error) throw new Error(data.error || 'Assembly failed')
      await loadFilms()
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setAssembling(false)
    }
  }

  const removeFilm = async (id: string) => {
    if (!confirm('Delete this assembled movie?')) return
    await fetch(`/api/videogen/assemble?id=${id}`, { method: 'DELETE' })
    await loadFilms()
  }

  const addCharacterHandler = async () => {
    if (!newCharName.trim()) return
    setSavingChar(true)
    try {
      const fd = new FormData()
      fd.append('name', newCharName.trim())
      fd.append('description', newCharDesc.trim())
      if (newCharFile) fd.append('image', newCharFile)
      const res = await fetch('/api/videogen/characters', { method: 'POST', body: fd })
      const data = await res.json()
      if (!res.ok || data.error) throw new Error(data.error || 'Add character failed')
      setNewCharName('')
      setNewCharDesc('')
      setNewCharFile(null)
      await loadCharacters()
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setSavingChar(false)
    }
  }

  const deleteCharacterHandler = async (id: string) => {
    if (!confirm('Delete character?')) return
    await fetch(`/api/videogen/characters?id=${id}`, { method: 'DELETE' })
    await loadCharacters()
  }

  const generateVoiceoverHandler = async (scene: Scene) => {
    if (!scene.narration?.trim()) return
    setVoLoadingId(scene.id)
    try {
      const res = await fetch('/api/videogen/voiceover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: scene.narration, voiceId: board?.voiceId }),
      })
      if (!res.ok) throw new Error('Voiceover request failed')
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      setVoAudioUrls(prev => ({ ...prev, [scene.id]: url }))
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setVoLoadingId(null)
    }
  }

  const handleLogout = async () => {
    await fetch('/api/logout', { method: 'POST' })
    window.location.href = '/login'
  }

  // Poll status of queued/running scene prompts
  const pendingIds = (board?.scenes ?? [])
    .filter(s => s.promptId && (s.state === 'queued' || s.state === 'running'))
    .map(s => s.promptId!)
    .join(',')

  useEffect(() => {
    if (!pendingIds) return
    let stop = false
    const tick = async () => {
      try {
        const r = await fetch(`/api/videogen/status?ids=${pendingIds}`, { cache: 'no-store' })
        if (!r.ok) return
        const data = await r.json()
        if (stop || !data.jobs) return
        setBoard(b => {
          if (!b) return b
          let changed = false
          const scenes = b.scenes.map(s => {
            const u = s.promptId ? data.jobs[s.promptId] : null
            if (!u || u.state === s.state) return s
            changed = true
            return { ...s, ...u }
          })
          return changed ? { ...b, scenes } : b
        })
      } catch {
        // ignore
      }
    }
    tick()
    const iv = setInterval(tick, 4000)
    return () => { stop = true; clearInterval(iv) }
  }, [pendingIds])

  if (loading || !board) {
    return (
      <main style={{ background: '#05080e', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <p style={{ color: 'var(--gold)', fontSize: '14px', fontWeight: 700 }}>🎥 Loading Movie Studio Workspace...</p>
      </main>
    )
  }

  const done = board.scenes.filter(s => s.state === 'done').length
  const total = board.scenes.length
  const totalSec = totalDuration(board.scenes)
  const selectedRes = RESOLUTIONS[board.resolution] ?? RESOLUTIONS[0]

  return (
    <main style={{ background: '#05080e', minHeight: '100vh', display: 'flex', flexDirection: 'column', color: '#F2F5FA', fontFamily: 'var(--font-body)' }}>
      {/* ── Persistent Top Studio Bar ── */}
      <header style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0.85rem 2rem', borderBottom: '1px solid #1a2840', background: '#070c14',
        zIndex: 30, position: 'sticky', top: 0
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem' }}>
          <Link href="/" style={{ color: 'var(--gold)', fontSize: '12px', textDecoration: 'none', fontWeight: 800 }}>
            ← Home
          </Link>
          <span style={{ color: '#1a2840' }}>|</span>
          <Link href="/movie" style={{ color: '#94a3b8', fontSize: '12px', textDecoration: 'none', fontWeight: 600 }}>
            🎬 Quick Gen
          </Link>
          <Link href="/canvas" style={{ color: '#94a3b8', fontSize: '12px', textDecoration: 'none', fontWeight: 600 }}>
            🌌 Canvas
          </Link>
          <span style={{ color: '#1a2840' }}>|</span>

          {/* Active Storyboard Selector */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span style={{ fontSize: '12px', fontWeight: 800, color: 'var(--gold)' }}>🎥 Movie Studio:</span>
            <select
              value={board.id}
              onChange={e => {
                const b = boards.find(x => x.id === e.target.value)
                if (b) setBoard(b)
              }}
              style={{
                background: '#0e182e', border: '1px solid #1a2840', borderRadius: '0.4rem',
                color: '#fff', fontSize: '12px', fontWeight: 700, padding: '0.35rem 0.65rem', outline: 'none'
              }}
            >
              {boards.map(b => (
                <option key={b.id} value={b.id}>📁 {b.title}</option>
              ))}
            </select>
            <button onClick={createNewStoryboard} style={{ background: 'none', border: '1px dashed var(--gold)', color: 'var(--gold)', borderRadius: '0.4rem', padding: '0.35rem 0.65rem', fontSize: '11px', fontWeight: 700, cursor: 'pointer' }}>
              + New Movie
            </button>
            {boards.length > 1 && (
              <button onClick={deleteCurrentStoryboard} style={{ background: 'none', border: '1px solid #ef4444', color: '#ef4444', borderRadius: '0.4rem', padding: '0.35rem 0.5rem', fontSize: '11px', cursor: 'pointer' }}>
                Delete
              </button>
            )}
          </div>
        </div>

        {/* Header Right Quick Status & Sign Out */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          {saving && <span style={{ fontSize: '10px', color: '#64748b' }}>Saving...</span>}
          <div style={{
            fontSize: '11px', fontWeight: 700, padding: '0.35rem 0.75rem', borderRadius: '2rem',
            background: podRunning ? 'rgba(74,222,128,0.1)' : 'rgba(251,191,36,0.1)',
            border: `1px solid ${podRunning ? '#4ade80' : '#fbbf24'}`,
            color: podRunning ? '#4ade80' : '#fbbf24'
          }}>
            ⚡ GPU Pods: {podRunning ? 'Active' : 'Inactive'}
          </div>

          <button
            onClick={handleLogout}
            style={{
              background: 'none', border: '1px solid #1a2840', color: '#94a3b8',
              borderRadius: '0.4rem', padding: '0.35rem 0.65rem', fontSize: '11px',
              fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.3rem'
            }}
          >
            <span>🚪</span> Sign Out
          </button>
        </div>
      </header>

      {/* Error notification banner */}
      {err && (
        <div style={{ background: 'rgba(239,68,68,0.15)', borderBottom: '1px solid #ef4444', color: '#ef4444', padding: '0.6rem 2rem', fontSize: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>⚠️ {err}</span>
          <button onClick={() => setErr(null)} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontWeight: 700 }}>✕</button>
        </div>
      )}

      {/* ── Main Production Workplace (2-Column Split) ── */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        
        {/* LEFT COLUMN: Inspector Sidebar (Settings, Cast, Captions) */}
        <aside style={{
          width: '340px', background: '#070c14', borderRight: '1px solid #1a2840',
          display: 'flex', flexDirection: 'column', flexShrink: 0
        }}>
          {/* Inspector Tab Buttons */}
          <div style={{ display: 'flex', borderBottom: '1px solid #1a2840', background: '#05080e' }}>
            <button
              onClick={() => setSidebarTab('settings')}
              style={{
                flex: 1, padding: '0.75rem 0.5rem', background: sidebarTab === 'settings' ? '#070c14' : 'transparent',
                border: 'none', borderBottom: sidebarTab === 'settings' ? '2px solid var(--gold)' : 'none',
                color: sidebarTab === 'settings' ? 'var(--gold)' : '#64748b', fontSize: '11px', fontWeight: 800, cursor: 'pointer'
              }}
            >
              ⚙️ Movie Settings
            </button>
            <button
              onClick={() => setSidebarTab('cast')}
              style={{
                flex: 1, padding: '0.75rem 0.5rem', background: sidebarTab === 'cast' ? '#070c14' : 'transparent',
                border: 'none', borderBottom: sidebarTab === 'cast' ? '2px solid var(--gold)' : 'none',
                color: sidebarTab === 'cast' ? 'var(--gold)' : '#64748b', fontSize: '11px', fontWeight: 800, cursor: 'pointer'
              }}
            >
              👤 Cast ({characters.length})
            </button>
            <button
              onClick={() => setSidebarTab('captions')}
              style={{
                flex: 1, padding: '0.75rem 0.5rem', background: sidebarTab === 'captions' ? '#070c14' : 'transparent',
                border: 'none', borderBottom: sidebarTab === 'captions' ? '2px solid var(--gold)' : 'none',
                color: sidebarTab === 'captions' ? 'var(--gold)' : '#64748b', fontSize: '11px', fontWeight: 800, cursor: 'pointer'
              }}
            >
              💬 Captions
            </button>
          </div>

          {/* Sidebar Tab Content */}
          <div style={{ flex: 1, padding: '1.25rem', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            
            {/* TAB 1: MOVIE SETTINGS */}
            {sidebarTab === 'settings' && (
              <>
                <div>
                  <label style={{ fontSize: '10px', color: '#64748b', textTransform: 'uppercase', fontWeight: 700, display: 'block', marginBottom: '0.35rem' }}>
                    Movie Title
                  </label>
                  <input
                    type="text"
                    value={board.title}
                    onChange={e => update({ title: e.target.value })}
                    style={{ width: '100%', padding: '0.55rem', borderRadius: '0.4rem', background: '#0e182e', border: '1px solid #1a2840', color: '#fff', fontSize: '13px', fontWeight: 700 }}
                  />
                </div>

                <div>
                  <label style={{ fontSize: '10px', color: '#64748b', textTransform: 'uppercase', fontWeight: 700, display: 'block', marginBottom: '0.35rem' }}>
                    Target Resolution
                  </label>
                  <select
                    value={board.resolution}
                    onChange={e => update({ resolution: Number(e.target.value) })}
                    style={{ width: '100%', padding: '0.55rem', borderRadius: '0.4rem', background: '#0e182e', border: '1px solid #1a2840', color: '#fff', fontSize: '12px', fontWeight: 600 }}
                  >
                    {RESOLUTIONS.map((r, i) => (
                      <option key={r.label} value={i}>📺 {r.label}</option>
                    ))}
                  </select>
                  <p style={{ fontSize: '10px', color: '#64748b', marginTop: '0.3rem' }}>
                    Current preset: {selectedRes.w}×{selectedRes.h}
                  </p>
                </div>

                <div>
                  <label style={{ fontSize: '10px', color: '#64748b', textTransform: 'uppercase', fontWeight: 700, display: 'block', marginBottom: '0.35rem' }}>
                    Global Audio Mode
                  </label>
                  <select
                    value={board.audioMode}
                    onChange={e => update({ audioMode: e.target.value })}
                    style={{ width: '100%', padding: '0.55rem', borderRadius: '0.4rem', background: '#0e182e', border: '1px solid #1a2840', color: '#fff', fontSize: '12px', fontWeight: 600 }}
                  >
                    {AUDIO_MODES.map(m => (
                      <option key={m.key} value={m.key}>{m.label}</option>
                    ))}
                  </select>
                  <p style={{ fontSize: '10px', color: '#64748b', marginTop: '0.3rem', lineHeight: 1.4 }}>
                    {AUDIO_MODES.find(m => m.key === board.audioMode)?.hint}
                  </p>
                </div>

                {(board.audioMode === 'elevenlabs' || board.audioMode === 'both') && (
                  <div>
                    <label style={{ fontSize: '10px', color: '#64748b', textTransform: 'uppercase', fontWeight: 700, display: 'block', marginBottom: '0.35rem' }}>
                      Default Movie Narrator Voice
                    </label>
                    <select
                      value={board.voiceId ?? ''}
                      onChange={e => update({ voiceId: e.target.value })}
                      style={{ width: '100%', padding: '0.55rem', borderRadius: '0.4rem', background: '#0e182e', border: '1px solid #1a2840', color: '#fff', fontSize: '12px' }}
                    >
                      {voices.map(v => (
                        <option key={v.voiceId} value={v.voiceId}>
                          🎙️ {v.name} ({v.category})
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </>
            )}

            {/* TAB 2: CAST & CHARACTERS */}
            {sidebarTab === 'cast' && (
              <>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  <h4 style={{ fontSize: '11px', textTransform: 'uppercase', fontWeight: 800, color: 'var(--gold)', margin: 0 }}>
                    Active Cast Roster
                  </h4>
                  {characters.length === 0 ? (
                    <p style={{ fontSize: '11px', color: '#64748b', margin: 0 }}>No characters added yet.</p>
                  ) : (
                    characters.map(c => (
                      <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', background: '#0e182e', border: '1px solid #1a2840', padding: '0.5rem 0.75rem', borderRadius: '0.5rem' }}>
                        {c.imageFile ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={`/api/videogen/characters?image=${encodeURIComponent(c.imageFile)}`} alt={c.name} style={{ width: '36px', height: '36px', borderRadius: '50%', objectFit: 'cover' }} />
                        ) : (
                          <div style={{ width: '36px', height: '36px', borderRadius: '50%', background: '#1a2840', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', color: '#94a3b8' }}>
                            👤
                          </div>
                        )}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <p style={{ fontSize: '12px', fontWeight: 700, margin: 0, color: '#fff' }}>{c.name}</p>
                          <p style={{ fontSize: '10px', color: '#64748b', margin: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.description}</p>
                        </div>
                        <button onClick={() => deleteCharacterHandler(c.id)} style={{ background: 'none', border: 'none', color: '#ef4444', fontSize: '11px', cursor: 'pointer' }}>Delete</button>
                      </div>
                    ))
                  )}
                </div>

                {/* Inline Character Addition */}
                <div style={{ borderTop: '1px solid #1a2840', paddingTop: '1rem', display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
                  <h4 style={{ fontSize: '11px', textTransform: 'uppercase', fontWeight: 800, color: '#fff', margin: 0 }}>+ Add Character to Movie</h4>
                  <input
                    type="text"
                    placeholder="Character Name (e.g. Meera)"
                    value={newCharName}
                    onChange={e => setNewCharName(e.target.value)}
                    style={{ width: '100%', padding: '0.45rem 0.6rem', borderRadius: '0.4rem', background: '#0e182e', border: '1px solid #1a2840', color: '#fff', fontSize: '11px' }}
                  />
                  <input
                    type="text"
                    placeholder="Appearance (e.g. Cyberpunk detective)"
                    value={newCharDesc}
                    onChange={e => setNewCharDesc(e.target.value)}
                    style={{ width: '100%', padding: '0.45rem 0.6rem', borderRadius: '0.4rem', background: '#0e182e', border: '1px solid #1a2840', color: '#fff', fontSize: '11px' }}
                  />
                  <div>
                    <label style={{ fontSize: '9px', color: '#64748b', textTransform: 'uppercase', display: 'block', marginBottom: '0.2rem' }}>Reference Image</label>
                    <input type="file" onChange={e => setNewCharFile(e.target.files?.[0] ?? null)} style={{ fontSize: '10px', color: '#94a3b8' }} />
                  </div>
                  <button
                    onClick={addCharacterHandler}
                    disabled={savingChar || !newCharName.trim()}
                    style={{
                      background: 'var(--gold)', color: '#05080e', border: 'none', borderRadius: '0.4rem',
                      padding: '0.45rem', fontSize: '11px', fontWeight: 800, cursor: savingChar || !newCharName.trim() ? 'not-allowed' : 'pointer', marginTop: '0.25rem'
                    }}
                  >
                    {savingChar ? 'Saving...' : 'Add to Movie Cast'}
                  </button>
                </div>
              </>
            )}

            {/* TAB 3: BURN-IN CAPTIONS */}
            {sidebarTab === 'captions' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={captions.enabled}
                    onChange={e => setCaptions(c => ({ ...c, enabled: e.target.checked }))}
                    style={{ accentColor: 'var(--gold)' }}
                  />
                  <span style={{ fontSize: '12px', fontWeight: 700, color: '#fff' }}>Enable Burn-in Captions</span>
                </label>

                {captions.enabled && (
                  <>
                    <div>
                      <label style={{ fontSize: '10px', color: '#64748b', textTransform: 'uppercase', display: 'block', marginBottom: '0.25rem' }}>Subtitle Font</label>
                      <select
                        value={captions.font}
                        onChange={e => setCaptions(c => ({ ...c, font: e.target.value }))}
                        style={{ width: '100%', padding: '0.45rem', borderRadius: '0.4rem', background: '#0e182e', border: '1px solid #1a2840', color: '#fff', fontSize: '11px' }}
                      >
                        {fonts.map(f => <option key={f} value={f}>{f}</option>)}
                      </select>
                    </div>

                    <div>
                      <label style={{ fontSize: '10px', color: '#64748b', textTransform: 'uppercase', display: 'block', marginBottom: '0.25rem' }}>Font Size ({captions.fontSize}px)</label>
                      <input
                        type="range" min={12} max={48} value={captions.fontSize}
                        onChange={e => setCaptions(c => ({ ...c, fontSize: Number(e.target.value) }))}
                        style={{ width: '100%', accentColor: 'var(--gold)' }}
                      />
                    </div>

                    <div>
                      <label style={{ fontSize: '10px', color: '#64748b', textTransform: 'uppercase', display: 'block', marginBottom: '0.25rem' }}>Text Color</label>
                      <input
                        type="color" value={captions.color}
                        onChange={e => setCaptions(c => ({ ...c, color: e.target.value }))}
                        style={{ width: '100%', height: '32px', border: '1px solid #1a2840', background: '#0e182e', borderRadius: '0.4rem', cursor: 'pointer' }}
                      />
                    </div>
                  </>
                )}
              </div>
            )}

          </div>
        </aside>

        {/* RIGHT COLUMN: Timeline & Scene Editor Workspace */}
        <main style={{ flex: 1, padding: '1.5rem 2rem', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          
          {/* Storyboard Header & Actions */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#070c14', padding: '1rem 1.5rem', borderRadius: '0.75rem', border: '1px solid #1a2840' }}>
            <div>
              <h2 style={{ fontSize: '1.15rem', fontWeight: 800, margin: 0, color: 'var(--gold)' }}>
                STORYBOARD TIMELINE
              </h2>
              <p style={{ fontSize: '11px', color: '#64748b', margin: '0.2rem 0 0' }}>
                {total} Scenes · ~{totalSec}s Estimated Runtime · {done} Scenes Generated
              </p>
            </div>

            <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
              <button
                onClick={() => {
                  const nextScenes = [...board.scenes, emptyScene(board.scenes.length)]
                  update({ scenes: nextScenes })
                }}
                style={{
                  background: '#0e182e', border: '1px dashed var(--gold)', color: 'var(--gold)',
                  borderRadius: '0.5rem', padding: '0.55rem 1rem', fontSize: '12px', fontWeight: 700, cursor: 'pointer'
                }}
              >
                + Add Scene
              </button>

              <button
                onClick={generateAllScenes}
                disabled={!podRunning || total === 0}
                style={{
                  background: podRunning ? 'var(--gold)' : '#1a2840',
                  color: podRunning ? '#05080e' : '#64748b',
                  border: 'none', borderRadius: '0.5rem', padding: '0.55rem 1.25rem',
                  fontSize: '12px', fontWeight: 800, cursor: podRunning ? 'pointer' : 'not-allowed'
                }}
              >
                ⚡ Render All Scenes
              </button>
            </div>
          </div>

          {/* Scene Cards Stack */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            {board.scenes.map((scene, idx) => {
              const videoUrl = scene.filename
                ? `/api/videogen/video?filename=${encodeURIComponent(scene.filename)}&subfolder=${encodeURIComponent(scene.subfolder ?? 'gen')}`
                : null
              const stateColor =
                scene.state === 'done' ? '#4ade80'
                : scene.state === 'error' ? '#ef4444'
                : scene.state === 'queued' || scene.state === 'running' ? '#fbbf24'
                : '#475569'

              return (
                <div
                  key={scene.id}
                  style={{
                    background: '#070c14', border: '1px solid #1a2840', borderRadius: '0.75rem',
                    padding: '1.25rem', display: 'grid', gridTemplateColumns: '320px 1fr', gap: '1.25rem'
                  }}
                >
                  {/* Left Column: Video Preview / Status Player */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
                    {videoUrl ? (
                      <>
                        <video src={videoUrl} controls loop playsInline style={{ width: '100%', height: '180px', objectFit: 'cover', borderRadius: '0.5rem', background: '#000', border: '1px solid #1a2840' }} />
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ fontSize: '10px', color: '#4ade80', fontWeight: 700 }}>✓ Rendered Video</span>
                          <a href={`${videoUrl}&download=1`} download style={{ fontSize: '11px', color: 'var(--gold)', fontWeight: 700, textDecoration: 'none' }}>
                            💾 Download MP4
                          </a>
                        </div>
                      </>
                    ) : (
                      <div style={{
                        width: '100%', height: '180px', borderRadius: '0.5rem', background: '#0e182e',
                        border: '1px dashed #1a2840', display: 'flex', flexDirection: 'column',
                        alignItems: 'center', justifyContent: 'center', gap: '0.5rem', color: '#64748b'
                      }}>
                        {scene.state === 'running' ? (
                          <>
                            <span style={{ fontSize: '20px' }}>⚡</span>
                            <span style={{ fontSize: '11px', color: '#fbbf24', fontWeight: 700 }}>Generating Video...</span>
                          </>
                        ) : scene.state === 'queued' ? (
                          <>
                            <span style={{ fontSize: '18px' }}>⏳</span>
                            <span style={{ fontSize: '11px', color: '#fbbf24' }}>Queued in GPU pipeline</span>
                          </>
                        ) : scene.state === 'error' ? (
                          <>
                            <span style={{ fontSize: '18px' }}>⚠️</span>
                            <span style={{ fontSize: '11px', color: '#ef4444' }}>Generation Failed</span>
                          </>
                        ) : (
                          <>
                            <span style={{ fontSize: '20px' }}>🎬</span>
                            <span style={{ fontSize: '11px' }}>Not generated yet</span>
                          </>
                        )}
                      </div>
                    )}

                    <button
                      onClick={() => generateScene(scene.id)}
                      disabled={!podRunning || !scene.prompt.trim()}
                      style={{
                        width: '100%', padding: '0.55rem', borderRadius: '0.4rem', border: 'none',
                        background: podRunning && scene.prompt.trim() ? 'rgba(232,185,74,0.15)' : '#1a2840',
                        color: podRunning && scene.prompt.trim() ? 'var(--gold)' : '#64748b',
                        fontSize: '11px', fontWeight: 800, cursor: podRunning && scene.prompt.trim() ? 'pointer' : 'not-allowed'
                      }}
                    >
                      {videoUrl ? '🔄 Regenerate Shot' : '⚡ Render Scene'}
                    </button>
                  </div>

                  {/* Right Column: Shot Parameters & Text Prompts */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
                    {/* Scene Row Header */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: stateColor }} />
                        <span style={{ fontSize: '12px', fontWeight: 800, color: 'var(--gold)' }}>Shot {idx + 1}</span>
                        <input
                          type="text"
                          value={scene.title}
                          onChange={e => updateScene({ ...scene, title: e.target.value })}
                          style={{ background: '#0e182e', border: '1px solid #1a2840', borderRadius: '0.3rem', color: '#fff', fontSize: '11px', padding: '0.2rem 0.5rem', fontWeight: 600 }}
                        />
                      </div>

                      <div style={{ display: 'flex', gap: '0.35rem', alignItems: 'center' }}>
                        <button onClick={() => moveScene(idx, 'up')} disabled={idx === 0} style={{ background: '#0e182e', border: '1px solid #1a2840', color: '#94a3b8', borderRadius: '0.25rem', padding: '0.15rem 0.4rem', fontSize: '10px', cursor: idx === 0 ? 'not-allowed' : 'pointer' }}>▲</button>
                        <button onClick={() => moveScene(idx, 'down')} disabled={idx === total - 1} style={{ background: '#0e182e', border: '1px solid #1a2840', color: '#94a3b8', borderRadius: '0.25rem', padding: '0.15rem 0.4rem', fontSize: '10px', cursor: idx === total - 1 ? 'not-allowed' : 'pointer' }}>▼</button>
                        <button
                          onClick={() => {
                            if (!confirm('Remove this shot?')) return
                            const nextScenes = board.scenes.filter(x => x.id !== scene.id)
                            update({ scenes: nextScenes })
                          }}
                          style={{ background: 'none', border: 'none', color: '#ef4444', fontSize: '11px', cursor: 'pointer', marginLeft: '0.5rem' }}
                        >
                          Remove Shot
                        </button>
                      </div>
                    </div>

                    {/* Prompt Box */}
                    <div>
                      <label style={{ fontSize: '10px', color: '#64748b', textTransform: 'uppercase', fontWeight: 700, display: 'block', marginBottom: '0.25rem' }}>
                        Shot Visual Prompt & Action
                      </label>
                      <textarea
                        value={scene.prompt}
                        onChange={e => updateScene({ ...scene, prompt: e.target.value })}
                        placeholder="Describe visual scene... tag characters like @Meera to lock style."
                        style={{ width: '100%', height: '65px', padding: '0.55rem', borderRadius: '0.4rem', background: '#0e182e', border: '1px solid #1a2840', color: '#fff', fontSize: '12px', lineHeight: 1.5, resize: 'none' }}
                      />
                    </div>

                    {/* Controls Grid */}
                    <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr 1fr', gap: '0.75rem' }}>
                      <div>
                        <label style={{ fontSize: '10px', color: '#64748b', textTransform: 'uppercase', fontWeight: 700, display: 'block', marginBottom: '0.25rem' }}>Shot Duration</label>
                        <select
                          value={scene.seconds}
                          onChange={e => updateScene({ ...scene, seconds: Number(e.target.value) })}
                          style={{ width: '100%', padding: '0.45rem', borderRadius: '0.4rem', background: '#0e182e', border: '1px solid #1a2840', color: '#fff', fontSize: '11px' }}
                        >
                          {[2, 4, 6, 8, 10, 12].map(s => <option key={s} value={s}>{s} seconds</option>)}
                        </select>
                      </div>

                      <div>
                        <label style={{ fontSize: '10px', color: '#64748b', textTransform: 'uppercase', fontWeight: 700, display: 'block', marginBottom: '0.25rem' }}>Featured Character</label>
                        <select
                          value={scene.characterId ?? ''}
                          onChange={e => updateScene({ ...scene, characterId: e.target.value || undefined })}
                          style={{ width: '100%', padding: '0.45rem', borderRadius: '0.4rem', background: '#0e182e', border: '1px solid #1a2840', color: '#fff', fontSize: '11px' }}
                        >
                          <option value="">-- No Character Tag --</option>
                          {characters.map(c => <option key={c.id} value={c.id}>👤 {c.name}</option>)}
                        </select>
                      </div>

                      <div>
                        <label style={{ fontSize: '10px', color: '#64748b', textTransform: 'uppercase', fontWeight: 700, display: 'block', marginBottom: '0.25rem' }}>Audio Override</label>
                        <select
                          value={scene.audioMode ?? ''}
                          onChange={e => updateScene({ ...scene, audioMode: e.target.value || undefined })}
                          style={{ width: '100%', padding: '0.45rem', borderRadius: '0.4rem', background: '#0e182e', border: '1px solid #1a2840', color: '#fff', fontSize: '11px' }}
                        >
                          <option value="">Global Default</option>
                          {AUDIO_MODES.map(m => <option key={m.key} value={m.key}>{m.label}</option>)}
                        </select>
                      </div>
                    </div>

                    {/* Dialogue / Voiceover Narration Input */}
                    {(board.audioMode === 'elevenlabs' || board.audioMode === 'both' || scene.audioMode === 'elevenlabs' || scene.audioMode === 'both') && (
                      <div style={{ background: '#0e182e', padding: '0.65rem', borderRadius: '0.5rem', border: '1px dashed #1a2840', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                        <label style={{ fontSize: '10px', color: 'var(--gold)', textTransform: 'uppercase', fontWeight: 700, display: 'block' }}>
                          🎙️ Shot Dialogue / Narration Script
                        </label>
                        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                          <input
                            type="text"
                            value={scene.narration ?? ''}
                            onChange={e => updateScene({ ...scene, narration: e.target.value })}
                            placeholder="Type script narration for this shot..."
                            style={{ flex: 1, padding: '0.45rem', borderRadius: '0.35rem', background: '#070c14', border: '1px solid #1a2840', color: '#fff', fontSize: '11px' }}
                          />
                          <button
                            type="button"
                            onClick={() => generateVoiceoverHandler(scene)}
                            disabled={voLoadingId === scene.id || !scene.narration?.trim()}
                            style={{ padding: '0.45rem 0.75rem', background: 'rgba(232,185,74,0.15)', border: '1px solid var(--gold)', color: 'var(--gold)', borderRadius: '0.35rem', fontSize: '10px', fontWeight: 700, cursor: 'pointer' }}
                          >
                            {voLoadingId === scene.id ? 'Synthesizing...' : '▶ Synthesize Voice'}
                          </button>
                        </div>
                        {voAudioUrls[scene.id] && (
                          <audio src={voAudioUrls[scene.id]} controls style={{ width: '100%', height: '28px', marginTop: '0.2rem' }} />
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>

          {/* Assembled Full Movies Section */}
          {films.length > 0 && (
            <div style={{ background: '#070c14', border: '1px solid #1a2840', borderRadius: '0.75rem', padding: '1.25rem', marginTop: '1.5rem' }}>
              <h3 style={{ fontSize: '13px', fontWeight: 800, color: 'var(--gold)', margin: '0 0 1rem' }}>
                🎞️ ASSEMBLED FULL MOVIES ({films.length})
              </h3>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '1rem' }}>
                {films.map(f => (
                  <div key={f.id} style={{ background: '#0e182e', border: '1px solid #1a2840', borderRadius: '0.5rem', padding: '0.85rem' }}>
                    <p style={{ fontWeight: 800, fontSize: '12px', margin: '0 0 0.4rem', color: '#fff' }}>{f.title}</p>
                    {f.state === 'building' ? (
                      <p style={{ fontSize: '11px', color: '#fbbf24', margin: 0 }}>⚙️ Stitching audio & video...</p>
                    ) : f.state === 'done' && f.file ? (
                      <>
                        <video src={`/api/videogen/assemble?file=${encodeURIComponent(f.file)}`} controls playsInline style={{ width: '100%', height: '140px', objectFit: 'cover', borderRadius: '0.35rem', background: '#000', marginBottom: '0.5rem' }} />
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ fontSize: '10px', color: '#64748b' }}>{f.bytes ? fmtBytes(f.bytes) : ''} · {f.duration}s</span>
                          <a href={`/api/videogen/assemble?file=${encodeURIComponent(f.file)}&download=1`} download style={{ fontSize: '11px', color: 'var(--gold)', fontWeight: 700, textDecoration: 'none' }}>
                            💾 Download Film
                          </a>
                        </div>
                      </>
                    ) : (
                      <p style={{ fontSize: '11px', color: '#ef4444', margin: 0 }}>Assembly Error</p>
                    )}
                    <button onClick={() => removeFilm(f.id)} style={{ background: 'none', border: 'none', color: '#ef4444', fontSize: '10px', cursor: 'pointer', marginTop: '0.5rem' }}>Delete Film</button>
                  </div>
                ))}
              </div>
            </div>
          )}

        </main>
      </div>

      {/* ── Sticky Floating Bottom Render Bar ── */}
      <div style={{
        position: 'sticky', bottom: 0, zIndex: 40, background: 'rgba(7, 12, 20, 0.95)',
        backdropFilter: 'blur(12px)', borderTop: '1px solid #1a2840', padding: '0.85rem 2rem',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem' }}>
          <div>
            <span style={{ fontSize: '10px', color: '#64748b', textTransform: 'uppercase', fontWeight: 700 }}>Active Film:</span>
            <span style={{ fontSize: '13px', fontWeight: 800, color: '#fff', marginLeft: '0.4rem' }}>{board.title}</span>
          </div>
          <span style={{ color: '#1a2840' }}>|</span>
          <span style={{ fontSize: '11px', color: '#94a3b8' }}>
            {total} Shots · ~{totalSec}s Duration · {done}/{total} Rendered
          </span>
        </div>

        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
          <button
            onClick={assembleMovie}
            disabled={assembling || done === 0}
            style={{
              background: done > 0 ? 'var(--gold)' : '#1a2840',
              color: done > 0 ? '#05080e' : '#64748b',
              border: 'none', borderRadius: '0.5rem', padding: '0.6rem 1.5rem',
              fontSize: '13px', fontWeight: 800, cursor: done > 0 ? 'pointer' : 'not-allowed'
            }}
          >
            {assembling ? '⚙️ Stitching & Exporting Movie...' : '🎥 Export & Assemble Full Movie'}
          </button>
        </div>
      </div>
    </main>
  )
}
