'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import Link from 'next/link'
import { SHOT_PRESETS, GRADES, buildShotPrompt, type Preset } from '@/lib/presets'
import { RESOLUTIONS, DEFAULT_RESOLUTION } from '@/lib/resolutions'
import PodPanel from './PodPanel'
import PromptBuilderDrawer from '../components/PromptBuilderDrawer'

type Shot = {
  id: string
  order: number
  description: string
  seconds: number
  shotPreset?: string
  grade?: string
  characterId?: string
  narration?: string
  promptId?: string
  filename?: string
  subfolder?: string
  state?: 'idle' | 'queued' | 'running' | 'done' | 'error'
  error?: string
}

type Character = { id: string; name: string; description: string; imageFile?: string }
type Voice = { voiceId: string; name: string; category: string }
type Film = { id: string; title: string; state: string; file?: string; bytes?: number; duration?: number; error?: string; createdAt: number }
type Project = { id: string; name: string }

const uid = () => Math.random().toString(36).slice(2, 10)
const newShot = (order: number): Shot => ({
  id: uid(), order, description: '', seconds: 6, state: 'idle',
})

const GOLD = '#E8B94A'
const CARD = '#121F35'
const LINE = '#1a2840'
const GREY = '#96A3B6'

const lbl: React.CSSProperties = { fontSize: '10px', color: GREY, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700, display: 'block', marginBottom: '0.4rem' }
const inp: React.CSSProperties = { width: '100%', padding: '0.65rem 0.85rem', borderRadius: '0.6rem', background: '#070c14', border: `1px solid ${LINE}`, color: '#F2F5FA', fontSize: '13px', outline: 'none', fontFamily: 'inherit' }

function AnimatedPresetGrid({ list, value, onPick, isGrade = false }: {
  list: Preset[]; value?: string; onPick: (k: string) => void; isGrade?: boolean
}) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: isGrade ? 'repeat(auto-fill, minmax(90px, 1fr))' : 'repeat(auto-fill, minmax(120px, 1fr))', gap: '0.5rem' }}>
      {list.map(p => {
        const on = value === p.key
        return (
          <button key={p.key} onClick={() => onPick(on ? '' : p.key)}
            title={on ? 'Click again to clear' : p.hint}
            className={`preset-card preset-anim-${p.key}`}
            style={{
              position: 'relative', padding: 0, cursor: 'pointer', overflow: 'hidden',
              borderRadius: '0.6rem', height: '62px', textAlign: 'left',
              border: on ? `2px solid ${GOLD}` : `1px solid ${LINE}`,
              background: `linear-gradient(135deg, ${p.swatch[0]}, ${p.swatch[1]})`,
              transition: 'all 0.2s ease-in-out',
            }}>
            <span style={{
              position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
              justifyContent: 'flex-end', padding: '0.45rem 0.55rem',
              background: 'linear-gradient(to top, rgba(0,0,0,0.8), transparent 75%)',
            }}>
              <span style={{ fontSize: '11px', fontWeight: 700, color: '#fff', lineHeight: 1.2 }}>{p.label}</span>
              <span style={{ fontSize: '9px', color: 'rgba(255,255,255,0.7)' }}>{p.hint}</span>
            </span>
            {on && (
              <span style={{
                position: 'absolute', top: '5px', right: '6px', width: '16px', height: '16px',
                borderRadius: '50%', background: GOLD, color: '#0A1220',
                fontSize: '10px', fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>✓</span>
            )}
          </button>
        )
      })}
    </div>
  )
}

export default function MovieClient() {
  const [title, setTitle] = useState('Untitled movie')
  const [shots, setShots] = useState<Shot[]>([newShot(0)])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [characters, setCharacters] = useState<Character[]>([])
  const [voices, setVoices] = useState<Voice[]>([])
  const [films, setFilms] = useState<Film[]>([])
  const [tab, setTab] = useState<'settings' | 'cast' | 'captions'>('settings')
  const [activeProjectId, setActiveProjectId] = useState<string>('default-project')
  const [projects, setProjects] = useState<Project[]>([])
  const [showPromptBuilder, setShowPromptBuilder] = useState(false)
  const [promptBuilderIsWide, setPromptBuilderIsWide] = useState(false)
  const [promptBuilderType, setPromptBuilderType] = useState<'scene' | 'character' | 'movie'>('scene')
  const [resolution, setResolution] = useState(DEFAULT_RESOLUTION)
  const [audioMode, setAudioMode] = useState('native')
  const [voiceId, setVoiceId] = useState<string>()
  const [podRunning, setPodRunning] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const boardId = useRef('movie-main')

  const shotsRef = useRef(shots)
  useEffect(() => { shotsRef.current = shots }, [shots])

  const active = shots.find(s => s.id === activeId) ?? shots[0]

  const loadFilms = useCallback(async () => {
    const r = await fetch('/api/videogen/assemble', { cache: 'no-store' })
    if (r.ok) setFilms((await r.json()).films ?? [])
  }, [])

  useEffect(() => {
    ;(async () => {
      const [c, v, pods, sb, proj] = await Promise.all([
        fetch('/api/videogen/characters', { cache: 'no-store' }).then(r => r.ok ? r.json() : { characters: [] }),
        fetch('/api/videogen/voices', { cache: 'no-store' }).then(r => r.ok ? r.json() : { voices: [] }),
        fetch('/api/videogen', { cache: 'no-store' }).then(r => r.ok ? r.json() : null),
        fetch('/api/videogen/storyboard', { cache: 'no-store' }).then(r => r.ok ? r.json() : { storyboards: [] }),
        fetch('/api/videogen/projects', { cache: 'no-store' }).then(r => r.ok ? r.json() : { projects: [] }),
      ])
      setCharacters(c.characters ?? [])
      setVoices(v.voices ?? [])
      setVoiceId(v.voices?.[0]?.voiceId)
      setPodRunning(pods?.ltx?.desiredStatus === 'RUNNING')
      setProjects(proj.projects ?? [])

      const saved = (sb.storyboards ?? []).find((s: { id: string }) => s.id === boardId.current)
      if (saved) {
        setTitle(saved.title)
        setResolution(saved.resolution ?? DEFAULT_RESOLUTION)
        setAudioMode(saved.audioMode ?? 'native')
        if (saved.voiceId) setVoiceId(saved.voiceId)
        if (saved.projectId) setActiveProjectId(saved.projectId)
        if (saved.scenes?.length) {
          setShots(saved.scenes.map((s: Record<string, unknown>, i: number) => ({
            id: (s.id as string) ?? uid(),
            order: (s.order as number) ?? i,
            description: (s.prompt as string) ?? '',
            seconds: (s.seconds as number) ?? 6,
            shotPreset: s.shotPreset as string | undefined,
            grade: s.grade as string | undefined,
            characterId: s.characterId as string | undefined,
            narration: s.narration as string | undefined,
            promptId: s.promptId as string | undefined,
            filename: s.filename as string | undefined,
            subfolder: s.subfolder as string | undefined,
            state: (s.state as Shot['state']) ?? 'idle',
          })))
        }
      }
      await loadFilms()
    })()
  }, [loadFilms])

  const persist = useCallback(async (next: Shot[]) => {
    const body = {
      id: boardId.current, title, resolution, audioMode, voiceId, projectId: activeProjectId,
      scenes: next.map((s, i) => ({
        id: s.id, order: i, title: s.description.slice(0, 40) || `Shot ${i + 1}`,
        prompt: s.description, seconds: s.seconds,
        shotPreset: s.shotPreset, grade: s.grade,
        characterId: s.characterId, narration: s.narration,
        promptId: s.promptId, filename: s.filename, subfolder: s.subfolder, state: s.state,
      })),
      createdAt: Date.now(), updatedAt: Date.now(),
    }
    await fetch('/api/videogen/storyboard', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })
  }, [title, resolution, audioMode, voiceId, activeProjectId])

  const commit = useCallback((next: Shot[]) => {
    setShots(next)
    persist(next)
  }, [persist])

  const update = (id: string, patch: Partial<Shot>) =>
    commit(shots.map(s => s.id === id ? { ...s, ...patch } : s))

  const move = (id: string, dir: -1 | 1) => {
    const i = shots.findIndex(s => s.id === id)
    const j = i + dir
    if (i < 0 || j < 0 || j >= shots.length) return
    const next = [...shots]
    ;[next[i], next[j]] = [next[j], next[i]]
    commit(next.map((s, k) => ({ ...s, order: k })))
  }

  const addShot = () => {
    const shot = newShot(shots.length)
    commit([...shots, shot])
    setActiveId(shot.id)
  }

  const removeShot = (id: string) => {
    if (shots.length === 1) return
    commit(shots.filter(s => s.id !== id).map((s, k) => ({ ...s, order: k })))
  }

  // ── Generate single or all shots ──
  const generate = async (ids?: string[]) => {
    const targets = ids ? shots.filter(s => ids.includes(s.id)) : shots.filter(s => s.description.trim())
    if (!targets.length) { setErr('Write a shot description first'); return }
    setErr(null); setBusy(true)
    try {
      await persist(shots)
      const res = RESOLUTIONS[resolution]
      for (const shot of targets) {
        const character = characters.find(c => c.id === shot.characterId)
        const r = await fetch('/api/videogen/generate', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt: buildShotPrompt({
              description: shot.description,
              characterDescription: character?.description,
              shotPreset: shot.shotPreset,
              grade: shot.grade,
            }),
            seconds: shot.seconds, width: res.w, height: res.h,
            characterId: shot.characterId,
            projectId: activeProjectId,
          }),
        })
        const d = await r.json()
        if (!r.ok || d.error) { update(shot.id, { state: 'error', error: d.error }); continue }
        update(shot.id, { promptId: d.promptId, state: 'queued', error: undefined, filename: undefined })
      }
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  // ── Status Poll ──
  const pending = shots.filter(s => s.promptId && (s.state === 'queued' || s.state === 'running')).map(s => s.promptId!).join(',')
  useEffect(() => {
    if (!pending) return
    let stop = false
    const tick = async () => {
      const r = await fetch(`/api/videogen/status?ids=${pending}`, { cache: 'no-store' })
      if (!r.ok || stop) return
      const d = await r.json()
      if (!d.jobs) return
      let changed = false
      const next = shotsRef.current.map(s => {
        const u = s.promptId ? d.jobs[s.promptId] : null
        if (!u || u.state === s.state) return s
        changed = true
        return { ...s, ...u }
      })
      if (changed) {
        setShots(next)
        persist(next)
      }
    }
    tick()
    const iv = setInterval(tick, 4000)
    return () => { stop = true; clearInterval(iv) }
  }, [pending, persist])

  const assemble = async () => {
    setErr(null); setBusy(true)
    try {
      await persist(shots)
      const r = await fetch('/api/videogen/assemble', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storyboardId: boardId.current, captions: { enabled: false } }),
      })
      const d = await r.json()
      if (!r.ok || d.error) throw new Error(d.error)
      await loadFilms()
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const done = shots.filter(s => s.state === 'done').length
  const runtime = Math.max(0, shots.reduce((n, s) => n + s.seconds, 0) - Math.max(0, shots.length - 1))
  const building = films.some(f => f.state === 'building')

  useEffect(() => {
    if (!building) return
    const iv = setInterval(loadFilms, 4000)
    return () => clearInterval(iv)
  }, [building, loadFilms])

  return (
    <main style={{ background: '#05080e', minHeight: '100vh', color: '#F2F5FA', fontFamily: 'var(--font-body)' }}>
      {/* Dynamic Keyframe Animations for Look & Grade Cards */}
      <style>{`
        @keyframes animPushIn { 0% { transform: scale(1); } 100% { transform: scale(1.06); } }
        @keyframes animPullBack { 0% { transform: scale(1.06); } 100% { transform: scale(1); } }
        @keyframes animOrbit { 0% { background-position: 0% 50%; } 100% { background-position: 100% 50%; } }
        @keyframes animShimmer { 0% { opacity: 0.7; } 50% { opacity: 1; } 100% { opacity: 0.7; } }

        .preset-card:hover { transform: translateY(-2px); box-shadow: 0 4px 14px rgba(0,0,0,0.5); }
        .preset-anim-push_in { animation: animPushIn 4s infinite alternate ease-in-out; }
        .preset-anim-pull_back { animation: animPullBack 4s infinite alternate ease-in-out; }
        .preset-anim-orbit { background-size: 200% 200% !important; animation: animOrbit 6s infinite linear; }
        .preset-anim-golden { animation: animShimmer 3s infinite ease-in-out; }
        .preset-anim-luxury { animation: animShimmer 3.5s infinite ease-in-out; }
        .preset-anim-teal_orange { background-size: 200% 200% !important; animation: animOrbit 5s infinite ease-in-out; }

        .ms-grid { display: grid; grid-template-columns: minmax(0, 1fr) 360px; gap: 1.5rem; padding: 1.5rem 2.5rem; maxWidth: 96rem; margin: 0 auto; }
        @media (max-width: 1024px) { .ms-grid { grid-template-columns: 1fr; padding: 1rem; } }
      `}</style>

      {/* Top Header */}
      <header style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem',
        padding: '0.85rem 2.5rem', borderBottom: `1px solid ${LINE}`, background: '#070c14', position: 'sticky', top: 0, zIndex: 20
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <Link href="/" style={{ color: 'var(--gold)', textDecoration: 'none', fontWeight: 800, fontSize: '13px' }}>
            ← Home
          </Link>
          <span style={{ color: LINE }}>|</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span style={{ fontSize: '10px', color: '#64748b', textTransform: 'uppercase', fontWeight: 700 }}>Project:</span>
            <select value={activeProjectId} onChange={e => setActiveProjectId(e.target.value)} style={{
              background: '#070c14', border: '1px solid #1a2840', borderRadius: '0.4rem', color: 'var(--gold)', fontSize: '12px', fontWeight: 700, outline: 'none'
            }}>
              {projects.map(p => <option key={p.id} value={p.id}>📁 {p.name}</option>)}
            </select>
          </div>
          <span style={{ color: LINE }}>|</span>
          <input value={title} onChange={e => setTitle(e.target.value)}
            style={{ ...inp, width: '220px', fontWeight: 800, fontSize: '14px', border: '1px solid #1a2840', padding: '0.35rem 0.6rem' }} />
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <span style={{ fontSize: '11px', color: GREY }}>
            {shots.length} shots · ~{runtime}s · {done} ready
          </span>
          <PodPanel onPodChange={setPodRunning} />
          <button
            onClick={async () => {
              await fetch('/api/logout', { method: 'POST' })
              window.location.href = '/login'
            }}
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
      </header>

      {/* Step Indicator Header Bar */}
      <div style={{ background: '#070c14', borderBottom: `1px solid ${LINE}`, padding: '0.75rem 2.5rem', display: 'flex', gap: '2rem', justifyContent: 'center', fontSize: '11px', fontWeight: 700 }}>
        <div style={{ color: 'var(--gold)', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          <span style={{ width: '18px', height: '18px', borderRadius: '50%', background: 'var(--gold)', color: '#05080e', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px' }}>1</span>
          1. Compose Shot Prompts & Style
        </div>
        <div style={{ color: podRunning ? '#4ade80' : GREY, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          <span style={{ width: '18px', height: '18px', borderRadius: '50%', background: '#121F35', border: '1px solid #1a2840', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px' }}>2</span>
          2. Render Shot Videos (`Generate Shot` / `Generate All`)
        </div>
        <div style={{ color: done > 0 ? 'var(--gold)' : GREY, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          <span style={{ width: '18px', height: '18px', borderRadius: '50%', background: '#121F35', border: '1px solid #1a2840', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px' }}>3</span>
          3. Stitch & Render Final Movie (`Create Movie`)
        </div>
      </div>

      {err && (
        <p style={{ margin: '0.75rem 2.5rem', fontSize: '12px', color: '#f87171', background: 'rgba(248,113,113,0.1)', padding: '0.5rem 1rem', borderRadius: '0.4rem' }}>
          ⚠️ {err}
        </p>
      )}

      {/* Main Studio Grid (Dynamically shifts to prevent overlap when right AI Prompt Director opens) */}
      <div
        className="ms-grid"
        style={{
          marginRight: showPromptBuilder ? (promptBuilderIsWide ? 'min(620px, 92vw)' : 'min(440px, 92vw)') : 0,
          transition: 'margin-right 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
        }}
      >
        
        {/* Left/Middle Column: Active Shot Editor & Timeline */}
        <section style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          
          {/* Active Shot Editor Card */}
          <div style={{ background: CARD, border: `1px solid ${LINE}`, borderRadius: '1rem', padding: '1.25rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.5rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span style={{ fontSize: '12px', fontWeight: 800, color: 'var(--gold)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                  Shot {shots.findIndex(s => s.id === active?.id) + 1} Editor
                </span>
                {active?.state === 'done' && <span style={{ fontSize: '10px', color: '#4ade80', fontWeight: 800, background: 'rgba(74,222,128,0.1)', padding: '0.15rem 0.5rem', borderRadius: '0.2rem' }}>✓ RENDERED</span>}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
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
                    fontSize: '11px',
                    fontWeight: 800,
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.35rem',
                  }}
                >
                  <span>✨ AI Director Shot Prompt</span>
                </button>
                <span style={{ fontSize: '11px', color: GREY }}>{active?.seconds}s duration</span>
              </div>
            </div>

            {active && (
              <>
                <textarea
                  value={active.description}
                  onChange={e => update(active.id, { description: e.target.value })}
                  rows={3}
                  placeholder="Describe what happens in this shot — e.g. Cinematic close-up of a diamond ring on velvet, warm lighting, macro detail..."
                  style={{ ...inp, lineHeight: 1.6, resize: 'vertical', marginBottom: '1.25rem', background: '#070c14' }}
                />

                {/* Animated Camera Look Presets */}
                <div style={{ marginBottom: '1.25rem' }}>
                  <label style={lbl}>
                    Camera Movement (Look) <span style={{ color: '#64748b', fontWeight: 500, textTransform: 'none' }}>— Select visual style with live animation</span>
                  </label>
                  <AnimatedPresetGrid list={SHOT_PRESETS} value={active.shotPreset} onPick={k => update(active.id, { shotPreset: k })} />
                </div>

                {/* Animated Color Grade Presets */}
                <div style={{ marginBottom: '1.25rem' }}>
                  <label style={lbl}>
                    Color Grade <span style={{ color: '#64748b', fontWeight: 500, textTransform: 'none' }}>— Select color palette grade</span>
                  </label>
                  <AnimatedPresetGrid list={GRADES} value={active.grade} isGrade={true} onPick={k => update(active.id, { grade: k })} />
                </div>

                {/* Parameter Row */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1.25rem' }}>
                  <div>
                    <label style={lbl}>Length (Seconds)</label>
                    <select value={active.seconds} onChange={e => update(active.id, { seconds: Number(e.target.value) })} style={inp}>
                      {[3, 4, 5, 6, 8, 10].map(n => <option key={n} value={n}>{n} seconds</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={lbl}>Character Reference</label>
                    <select value={active.characterId ?? ''} onChange={e => update(active.id, { characterId: e.target.value || undefined })} style={inp}>
                      <option value="">None Linked</option>
                      {characters.map(c => <option key={c.id} value={c.id}>👤 {c.name}</option>)}
                    </select>
                  </div>
                </div>

                {(audioMode === 'elevenlabs' || audioMode === 'both') && (
                  <div style={{ marginBottom: '1.25rem' }}>
                    <label style={lbl}>Voiceover Narration Script</label>
                    <textarea value={active.narration ?? ''} onChange={e => update(active.id, { narration: e.target.value })}
                      rows={2} placeholder="What the character voice says during this scene..." style={{ ...inp, resize: 'vertical', background: '#070c14' }} />
                  </div>
                )}

                {/* Button 1: GENERATE SINGLE SHOT (Properly placed inside shot card) */}
                <div style={{ borderTop: `1px solid ${LINE}`, paddingTop: '1rem', marginTop: '0.5rem' }}>
                  <button
                    onClick={() => generate([active.id])}
                    disabled={busy || !podRunning || !active.description.trim()}
                    style={{
                      width: '100%', padding: '0.75rem', borderRadius: '0.6rem', border: 'none',
                      background: podRunning && active.description.trim() ? 'var(--gold)' : LINE,
                      color: podRunning && active.description.trim() ? '#05080e' : '#64748b',
                      fontSize: '13px', fontWeight: 800, cursor: busy || !podRunning || !active.description.trim() ? 'not-allowed' : 'pointer',
                      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '0.15rem'
                    }}
                  >
                    <span>⚡ {active.filename ? `REGENERATE SHOT #${shots.findIndex(s => s.id === active.id) + 1}` : `GENERATE SHOT #${shots.findIndex(s => s.id === active.id) + 1}`}</span>
                    <span style={{ fontSize: '10px', opacity: 0.8, fontWeight: 500 }}>
                      Render 6s video clip for current shot
                    </span>
                  </button>
                </div>
              </>
            )}
          </div>

          {/* Timeline & Batch Shot Controls */}
          <div style={{ background: CARD, border: `1px solid ${LINE}`, borderRadius: '1rem', padding: '1.25rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.5rem' }}>
              <div>
                <h4 style={{ fontSize: '12px', fontWeight: 800, color: 'var(--gold)', margin: 0, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                  SHOT TIMELINE ({shots.length} SCENES)
                </h4>
                <p style={{ fontSize: '10px', color: GREY, margin: '0.15rem 0 0' }}>Click a shot card below to edit or reorder.</p>
              </div>

              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  onClick={() => {
                    setPromptBuilderType('movie')
                    setShowPromptBuilder(true)
                  }}
                  style={{
                    fontSize: '11px', padding: '0.45rem 0.85rem', borderRadius: '0.4rem', cursor: 'pointer',
                    border: '1px solid rgba(232,185,74,0.4)', background: 'rgba(232,185,74,0.15)', color: 'var(--gold)', fontWeight: 800,
                    display: 'flex', alignItems: 'center', gap: '0.35rem',
                  }}
                >
                  <span>✨ AI Storyboard Generator</span>
                </button>

                <button onClick={addShot} style={{
                  fontSize: '11px', padding: '0.45rem 0.85rem', borderRadius: '0.4rem', cursor: 'pointer',
                  border: `1px solid ${LINE}`, background: '#070c14', color: '#F2F5FA', fontWeight: 700,
                }}>
                  + Add Shot
                </button>

                {/* Button 2: GENERATE ALL SHOTS (Properly placed in timeline bar) */}
                <button
                  onClick={() => generate()}
                  disabled={busy || !podRunning}
                  style={{
                    padding: '0.45rem 0.85rem', borderRadius: '0.4rem',
                    background: podRunning ? 'rgba(74,222,128,0.15)' : LINE,
                    color: podRunning ? '#4ade80' : '#64748b',
                    border: podRunning ? '1px solid rgba(74,222,128,0.3)' : '1px solid transparent',
                    fontSize: '11px', fontWeight: 800, cursor: busy || !podRunning ? 'not-allowed' : 'pointer',
                    display: 'flex', alignItems: 'center', gap: '0.4rem'
                  }}
                  title="Batch render remaining un-rendered shots in timeline sequentially"
                >
                  <span>🚀 Generate All Shots</span>
                </button>
              </div>
            </div>

            {/* Horizontal Timeline Scroll */}
            <div style={{ display: 'flex', gap: '0.75rem', overflowX: 'auto', paddingBottom: '0.5rem' }}>
              {shots.map((s, i) => {
                const on = s.id === active?.id
                const url = s.filename
                  ? `/api/videogen/video?filename=${encodeURIComponent(s.filename)}&subfolder=${encodeURIComponent(s.subfolder ?? 'gen')}`
                  : null
                return (
                  <div key={s.id} onClick={() => setActiveId(s.id)}
                    style={{
                      flex: '0 0 160px', cursor: 'pointer', borderRadius: '0.6rem', overflow: 'hidden',
                      border: on ? `2px solid ${GOLD}` : `1px solid ${LINE}`, background: '#070c14',
                    }}>
                    <div style={{ position: 'relative', height: '90px', background: '#000' }}>
                      {url ? (
                        <video src={url} muted playsInline autoPlay loop style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      ) : (
                        <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', color: '#64748b' }}>
                          {s.state === 'queued' ? 'Queued...' : s.state === 'running' ? 'Rendering...' : 'Empty'}
                        </div>
                      )}
                      <span style={{ position: 'absolute', top: '4px', left: '5px', fontSize: '9px', fontWeight: 800, background: 'rgba(0,0,0,0.7)', color: 'var(--gold)', padding: '0.1rem 0.4rem', borderRadius: '3px' }}>
                        Shot {i + 1}
                      </span>
                      <span style={{ position: 'absolute', bottom: '4px', right: '5px', fontSize: '9px', background: 'rgba(0,0,0,0.7)', padding: '0.1rem 0.35rem', borderRadius: '3px', color: '#96A3B6' }}>
                        {s.seconds}s
                      </span>
                    </div>

                    <div style={{ padding: '0.5rem' }}>
                      <p style={{ fontSize: '10px', color: '#96A3B6', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {s.description || 'No description yet'}
                      </p>
                      <div style={{ display: 'flex', gap: '0.25rem', marginTop: '0.4rem' }}>
                        <button onClick={e => { e.stopPropagation(); move(s.id, -1) }} disabled={i === 0} style={{ flex: 1, fontSize: '10px', padding: '0.1rem', cursor: 'pointer', background: '#121F35', border: '1px solid #1a2840', color: '#96A3B6', borderRadius: '3px' }}>←</button>
                        <button onClick={e => { e.stopPropagation(); move(s.id, 1) }} disabled={i === shots.length - 1} style={{ flex: 1, fontSize: '10px', padding: '0.1rem', cursor: 'pointer', background: '#121F35', border: '1px solid #1a2840', color: '#96A3B6', borderRadius: '3px' }}>→</button>
                        <button onClick={e => { e.stopPropagation(); removeShot(s.id) }} disabled={shots.length === 1} style={{ flex: 1, fontSize: '10px', padding: '0.1rem', cursor: 'pointer', background: '#121F35', border: '1px solid #1a2840', color: '#ef4444', borderRadius: '3px' }}>×</button>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </section>

        {/* Right Rail: Movie Settings & Final Film Assembly */}
        <aside style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          
          {/* Movie Parameters Box */}
          <div style={{ background: CARD, border: `1px solid ${LINE}`, borderRadius: '1rem', padding: '1.25rem' }}>
            <h4 style={{ fontSize: '12px', fontWeight: 800, color: 'var(--gold)', margin: '0 0 1rem', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              MOVIE SETTINGS
            </h4>

            <div style={{ marginBottom: '1rem' }}>
              <label style={lbl}>Resolution Format</label>
              <select value={resolution} onChange={e => setResolution(Number(e.target.value))} style={inp}>
                {RESOLUTIONS.map((r, i) => <option key={r.label} value={i}>{r.label}</option>)}
              </select>
            </div>

            <div style={{ marginBottom: '1rem' }}>
              <label style={lbl}>Audio Layering</label>
              <select value={audioMode} onChange={e => setAudioMode(e.target.value)} style={inp}>
                <option value="native">Model audio (LTX 2.5 ambience)</option>
                <option value="elevenlabs">ElevenLabs narration only</option>
                <option value="both">Both (Ambience + Narration)</option>
                <option value="none">Silent</option>
              </select>
            </div>

            {(audioMode === 'elevenlabs' || audioMode === 'both') && (
              <div>
                <label style={lbl}>Default Voiceover Voice</label>
                <select value={voiceId ?? ''} onChange={e => setVoiceId(e.target.value)} style={inp}>
                  {voices.map(v => <option key={v.voiceId} value={v.voiceId}>{v.name}{v.category === 'cloned' ? ' ★' : ''}</option>)}
                </select>
              </div>
            )}
          </div>

          {/* Button 3: CREATE MOVIE (STITCH FILM) (Properly placed in right panel) */}
          <div style={{ background: CARD, border: `1px solid ${LINE}`, borderRadius: '1rem', padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
            <div>
              <h4 style={{ fontSize: '13px', fontWeight: 800, margin: 0, color: '#F2F5FA' }}>
                {done === shots.length ? 'All shots ready for stitching' : `${shots.length - done} shot${shots.length - done === 1 ? '' : 's'} remaining`}
              </h4>
              <p style={{ fontSize: '11px', color: GREY, lineHeight: 1.5, margin: '0.3rem 0 0' }}>
                Stitches all generated shot videos in timeline order with smooth crossfades and audio layers into a single MP4 movie.
              </p>
            </div>

            <button
              onClick={assemble}
              disabled={busy || done === 0 || !podRunning}
              style={{
                width: '100%', padding: '0.85rem', borderRadius: '0.6rem', border: 'none',
                background: done > 0 && podRunning ? 'var(--gold)' : LINE,
                color: done > 0 && podRunning ? '#05080e' : '#64748b',
                fontSize: '13px', fontWeight: 800,
                cursor: busy || done === 0 || !podRunning ? 'not-allowed' : 'pointer',
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '0.15rem'
              }}
            >
              <span>🎬 CREATE MOVIE (STITCH FILM)</span>
              <span style={{ fontSize: '10px', opacity: 0.8, fontWeight: 500 }}>
                Assemble final MP4 movie with audio
              </span>
            </button>
          </div>

          {/* Rendered Movies List */}
          {films.length > 0 && (
            <div style={{ background: CARD, border: `1px solid ${LINE}`, borderRadius: '1rem', padding: '1.25rem' }}>
              <h4 style={{ fontSize: '12px', fontWeight: 800, color: 'var(--gold)', margin: '0 0 0.85rem', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                COMPILED MOVIES
              </h4>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                {films.slice(0, 3).map(f => (
                  <div key={f.id} style={{ background: '#070c14', border: '1px solid #1a2840', borderRadius: '0.5rem', padding: '0.75rem' }}>
                    {f.state === 'done' && f.file ? (
                      <video src={`/api/videogen/assemble?file=${f.file}`} controls playsInline autoPlay loop muted style={{ width: '100%', borderRadius: '0.4rem', background: '#000' }} />
                    ) : (
                      <div style={{ padding: '0.5rem', fontSize: '11px', color: f.state === 'error' ? '#f87171' : 'var(--gold)' }}>
                        {f.state === 'building' ? 'Rendering MP4 movie...' : f.error ?? 'Failed'}
                      </div>
                    )}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.4rem' }}>
                      <span style={{ fontSize: '10px', color: GREY }}>
                        {f.duration ? `${f.duration.toFixed(1)}s` : ''} {f.bytes ? `· ${(f.bytes / 1e6).toFixed(1)}MB` : ''}
                      </span>
                      {f.state === 'done' && f.file && (
                        <a href={`/api/videogen/assemble?file=${f.file}&download=1`} download style={{ fontSize: '10px', color: 'var(--gold)', fontWeight: 800, textDecoration: 'none' }}>
                          Download MP4
                        </a>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </aside>
      </div>

      {/* AI Cinematic Prompt Generator Right Drawer */}
      <PromptBuilderDrawer
        isOpen={showPromptBuilder}
        onToggle={() => setShowPromptBuilder(!showPromptBuilder)}
        onWideToggle={setPromptBuilderIsWide}
        initialType={promptBuilderType}
        onApplyScene={(data) => {
          if (active) {
            update(active.id, { description: data.prompt })
          }
        }}
        onApplyMovie={(data) => {
          if (data.title) setTitle(data.title)
          if (data.shots && data.shots.length > 0) {
            const newShots: Shot[] = data.shots.map((s, idx) => ({
              id: uid(),
              order: idx + 1,
              description: s.prompt,
              seconds: s.seconds || 6,
              state: 'idle' as const,
            }))
            setShots(newShots)
            shotsRef.current = newShots
            setActiveId(newShots[0].id)
            persist(newShots)
          }
        }}
      />
    </main>
  )
}
