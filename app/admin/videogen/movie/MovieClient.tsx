'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { SHOT_PRESETS, GRADES, buildShotPrompt, type Preset } from '@/lib/presets'
import { RESOLUTIONS } from '@/lib/resolutions'
import PodPanel from './PodPanel'

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

function PresetGrid({ list, value, onPick, cols = 4 }: {
  list: Preset[]; value?: string; onPick: (k: string) => void; cols?: number
}) {
  return (
    <div className={cols === 5 ? 'ms-grades' : 'ms-presets'}>
      {list.map(p => {
        const on = value === p.key
        return (
          // Clicking the selected card clears it — a detailed prompt often
          // already says how it should look, and preset phrasing fights it.
          <button key={p.key} onClick={() => onPick(on ? '' : p.key)}
            title={on ? 'Click again to clear' : p.hint}
            style={{
              position: 'relative', padding: 0, cursor: 'pointer', overflow: 'hidden',
              borderRadius: '0.6rem', height: '62px', textAlign: 'left',
              border: on ? `2px solid ${GOLD}` : `1px solid ${LINE}`,
              background: `linear-gradient(135deg, ${p.swatch[0]}, ${p.swatch[1]})`,
              transition: 'transform 0.15s',
            }}>
            <span style={{
              position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
              justifyContent: 'flex-end', padding: '0.45rem 0.55rem',
              background: 'linear-gradient(to top, rgba(0,0,0,0.75), transparent 70%)',
            }}>
              <span style={{ fontSize: '11px', fontWeight: 700, color: '#fff', lineHeight: 1.2 }}>{p.label}</span>
              <span style={{ fontSize: '9px', color: 'rgba(255,255,255,0.6)' }}>{p.hint}</span>
            </span>
            {on && (
              <span style={{
                position: 'absolute', top: '5px', right: '6px', width: '15px', height: '15px',
                borderRadius: '50%', background: GOLD, color: '#0A1220',
                fontSize: '10px', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center',
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
  const [resolution, setResolution] = useState(0)
  const [audioMode, setAudioMode] = useState('native')
  const [voiceId, setVoiceId] = useState<string>()
  const [podRunning, setPodRunning] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const boardId = useRef('movie-main')

  // Lets the poller read current shots without re-subscribing every render.
  const shotsRef = useRef(shots)
  useEffect(() => { shotsRef.current = shots }, [shots])

  const active = shots.find(s => s.id === activeId) ?? shots[0]

  // ── Load ──
  const loadFilms = useCallback(async () => {
    const r = await fetch('/api/admin/videogen/assemble', { cache: 'no-store' })
    if (r.ok) setFilms((await r.json()).films ?? [])
  }, [])

  useEffect(() => {
    ;(async () => {
      const [c, v, pods, sb] = await Promise.all([
        fetch('/api/admin/videogen/characters', { cache: 'no-store' }).then(r => r.ok ? r.json() : { characters: [] }),
        fetch('/api/admin/videogen/voices', { cache: 'no-store' }).then(r => r.ok ? r.json() : { voices: [] }),
        fetch('/api/admin/videogen', { cache: 'no-store' }).then(r => r.ok ? r.json() : null),
        fetch('/api/admin/videogen/storyboard', { cache: 'no-store' }).then(r => r.ok ? r.json() : { storyboards: [] }),
      ])
      setCharacters(c.characters ?? [])
      setVoices(v.voices ?? [])
      setVoiceId(v.voices?.[0]?.voiceId)
      setPodRunning(pods?.ltx?.desiredStatus === 'RUNNING')

      const saved = (sb.storyboards ?? []).find((s: { id: string }) => s.id === boardId.current)
      if (saved) {
        setTitle(saved.title)
        setResolution(saved.resolution ?? 0)
        setAudioMode(saved.audioMode ?? 'native')
        if (saved.voiceId) setVoiceId(saved.voiceId)
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

  // Persist as a storyboard so assembly and the rest of the API work unchanged.
  const persist = useCallback(async (next: Shot[]) => {
    const body = {
      id: boardId.current, title, resolution, audioMode, voiceId,
      scenes: next.map((s, i) => ({
        id: s.id, order: i, title: s.description.slice(0, 40) || `Shot ${i + 1}`,
        prompt: s.description, seconds: s.seconds,
        shotPreset: s.shotPreset, grade: s.grade,
        characterId: s.characterId, narration: s.narration,
        promptId: s.promptId, filename: s.filename, subfolder: s.subfolder, state: s.state,
      })),
      createdAt: Date.now(), updatedAt: Date.now(),
    }
    await fetch('/api/admin/videogen/storyboard', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })
  }, [title, resolution, audioMode, voiceId])

  // State updaters stay pure — saving happens alongside, never inside them.
  // React may invoke an updater more than once, which silently double-applied
  // reorders when the save lived in there.
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

  // ── Generate ──
  const generate = async (ids?: string[]) => {
    const targets = ids ? shots.filter(s => ids.includes(s.id)) : shots.filter(s => s.description.trim())
    if (!targets.length) { setErr('Write a shot description first'); return }
    setErr(null); setBusy(true)
    try {
      await persist(shots)
      const res = RESOLUTIONS[resolution]
      for (const shot of targets) {
        const character = characters.find(c => c.id === shot.characterId)
        const r = await fetch('/api/admin/videogen/generate', {
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

  // ── Poll ──
  const pending = shots.filter(s => s.promptId && (s.state === 'queued' || s.state === 'running')).map(s => s.promptId!).join(',')
  useEffect(() => {
    if (!pending) return
    let stop = false
    const tick = async () => {
      const r = await fetch(`/api/admin/videogen/status?ids=${pending}`, { cache: 'no-store' })
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
    const iv = setInterval(tick, 5000)
    return () => { stop = true; clearInterval(iv) }
  }, [pending, persist])

  const assemble = async () => {
    setErr(null); setBusy(true)
    try {
      await persist(shots)
      const r = await fetch('/api/admin/videogen/assemble', {
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
    <main style={{ background: '#0A1220', minHeight: '100vh', color: '#F2F5FA' }}>
      {/* Header */}
      <header className="ms-head" style={{
        display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap',
        padding: '0.9rem 1.5rem', borderBottom: `1px solid ${LINE}`, background: '#0a1220',
        position: 'sticky', top: 0, zIndex: 20,
      }}>
        <input value={title} onChange={e => setTitle(e.target.value)}
          style={{ ...inp, width: 'auto', flex: '1 1 220px', fontWeight: 700, fontSize: '15px', border: '1px solid transparent', background: 'transparent', padding: '0.35rem 0.5rem' }} />
        <span className="ms-head-stats" style={{ fontSize: '11px', color: GREY }}>
          {shots.length} shots · ~{runtime}s · {done} ready
        </span>
        <PodPanel onPodChange={setPodRunning} />
        <button onClick={() => generate()} disabled={busy || !podRunning}
          style={{
            padding: '0.55rem 1.2rem', borderRadius: '0.5rem', border: 'none',
            background: podRunning ? GOLD : LINE, color: podRunning ? '#0A1220' : '#64748b',
            fontSize: '13px', fontWeight: 700, cursor: busy || !podRunning ? 'not-allowed' : 'pointer',
          }}>
          {busy ? 'Working…' : 'Generate all shots'}
        </button>
      </header>

      {err && (
        <p style={{ margin: '0.75rem 1.5rem', fontSize: '12px', color: '#f87171' }}>{err}</p>
      )}

      {/* Inline styles can't express media queries, and the whole page is
          inline-styled — so the responsive rules live here. */}
      <style>{`
        .ms-grid { display: grid; grid-template-columns: minmax(0,1fr) 340px; gap: 1.5rem; padding: 1.5rem; max-width: 92rem; margin: 0 auto; align-items: start; }
        .ms-rail { display: flex; flex-direction: column; gap: 1rem; position: sticky; top: 5rem; }
        .ms-presets { display: grid; grid-template-columns: repeat(4, 1fr); gap: 0.5rem; }
        .ms-grades  { display: grid; grid-template-columns: repeat(5, 1fr); gap: 0.5rem; }
        @media (max-width: 1024px) {
          .ms-grid { grid-template-columns: 1fr; }
          /* Sticky is wrong once the rail is stacked under the editor. */
          .ms-rail { position: static; }
        }
        @media (max-width: 640px) {
          .ms-grid { padding: 1rem; gap: 1rem; }
          .ms-presets { grid-template-columns: repeat(2, 1fr); }
          .ms-grades  { grid-template-columns: repeat(3, 1fr); }
          .ms-head { padding: 0.75rem 1rem !important; }
          .ms-head-stats { width: 100%; order: 3; }
          .ms-shot { padding: 1rem !important; }
          /* Thumbs get a touch bigger so the arrows stay tappable. */
          .ms-thumb { flex: 0 0 140px !important; }
        }
      `}</style>

      <div className="ms-grid">

        {/* ── Shot editor ── */}
        <section>
          <div className="ms-shot" style={{ background: CARD, border: `1px solid ${LINE}`, borderRadius: '1rem', padding: '1.25rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.85rem' }}>
              <span style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.1em', color: GREY, textTransform: 'uppercase' }}>
                Shot {shots.findIndex(s => s.id === active?.id) + 1}
              </span>
              {active?.state === 'done' && <span style={{ fontSize: '10px', color: '#4ade80', fontWeight: 700 }}>● RENDERED</span>}
            </div>

            {active && (
              <>
                <textarea value={active.description}
                  onChange={e => update(active.id, { description: e.target.value })}
                  rows={3} placeholder="Describe what happens in this shot — a diamond ring resting on black velvet, light catching every facet…"
                  style={{ ...inp, lineHeight: 1.6, resize: 'vertical', marginBottom: '1rem' }} />

                <label style={lbl}>
                  Look <span style={{ color: '#64748b', fontWeight: 500, textTransform: 'none', letterSpacing: 0 }}>
                    — optional{active.shotPreset ? ', click again to clear' : ''}
                  </span>
                </label>
                <div style={{ marginBottom: '1rem' }}>
                  <PresetGrid list={SHOT_PRESETS} value={active.shotPreset}
                    onPick={k => update(active.id, { shotPreset: k })} />
                </div>

                <label style={lbl}>
                  Grade <span style={{ color: '#64748b', fontWeight: 500, textTransform: 'none', letterSpacing: 0 }}>
                    — optional{active.grade ? ', click again to clear' : ''}
                  </span>
                </label>
                <div style={{ marginBottom: '1rem' }}>
                  <PresetGrid list={GRADES} value={active.grade} cols={5}
                    onPick={k => update(active.id, { grade: k })} />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px,1fr))', gap: '0.75rem' }}>
                  <div>
                    <label style={lbl}>Length</label>
                    <select value={active.seconds} onChange={e => update(active.id, { seconds: Number(e.target.value) })} style={inp}>
                      {[3, 4, 5, 6, 8, 10].map(n => <option key={n} value={n}>{n} seconds</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={lbl}>Character</label>
                    <select value={active.characterId ?? ''} onChange={e => update(active.id, { characterId: e.target.value || undefined })} style={inp}>
                      <option value="">None</option>
                      {characters.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </div>
                </div>

                {(audioMode === 'elevenlabs' || audioMode === 'both') && (
                  <div style={{ marginTop: '0.75rem' }}>
                    <label style={lbl}>Narration</label>
                    <textarea value={active.narration ?? ''} onChange={e => update(active.id, { narration: e.target.value })}
                      rows={2} placeholder="What the voice says over this shot…" style={{ ...inp, resize: 'vertical' }} />
                  </div>
                )}

                <button onClick={() => generate([active.id])} disabled={busy || !podRunning || !active.description.trim()}
                  style={{
                    marginTop: '1rem', width: '100%', padding: '0.65rem', borderRadius: '0.5rem', border: 'none',
                    background: podRunning && active.description.trim() ? 'rgba(232,185,74,0.14)' : LINE,
                    color: podRunning && active.description.trim() ? GOLD : '#64748b',
                    fontSize: '12px', fontWeight: 700,
                    cursor: busy || !podRunning || !active.description.trim() ? 'not-allowed' : 'pointer',
                  }}>
                  {active.filename ? 'Regenerate this shot' : 'Generate this shot'}
                </button>
              </>
            )}
          </div>

          {/* ── Timeline ── */}
          <div style={{ marginTop: '1.25rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
              <span style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.1em', color: GREY, textTransform: 'uppercase' }}>Timeline</span>
              <button onClick={addShot} style={{
                fontSize: '11px', padding: '0.35rem 0.8rem', borderRadius: '0.4rem', cursor: 'pointer',
                border: `1px solid ${LINE}`, background: 'transparent', color: GREY, fontWeight: 700,
              }}>+ Add shot</button>
            </div>

            <div style={{ display: 'flex', gap: '0.6rem', overflowX: 'auto', paddingBottom: '0.5rem' }}>
              {shots.map((s, i) => {
                const on = s.id === active?.id
                const url = s.filename
                  ? `/api/admin/videogen/video?filename=${encodeURIComponent(s.filename)}&subfolder=${encodeURIComponent(s.subfolder ?? 'gen')}`
                  : null
                return (
                  <div key={s.id} className="ms-thumb" onClick={() => setActiveId(s.id)}
                    style={{
                      flex: '0 0 156px', cursor: 'pointer', borderRadius: '0.6rem', overflow: 'hidden',
                      border: on ? `2px solid ${GOLD}` : `1px solid ${LINE}`, background: CARD,
                    }}>
                    <div style={{ position: 'relative', height: '88px', background: '#070c14' }}>
                      {url
                        ? <video src={url} muted playsInline style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        : <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', color: '#334155' }}>
                            {s.state === 'queued' ? 'Queued' : s.state === 'running' ? 'Rendering…' : s.state === 'error' ? 'Failed' : 'Empty'}
                          </span>}
                      <span style={{
                        position: 'absolute', top: '4px', left: '5px', fontSize: '9px', fontWeight: 700,
                        background: 'rgba(0,0,0,0.65)', padding: '0.1rem 0.35rem', borderRadius: '3px',
                      }}>{i + 1}</span>
                      <span style={{
                        position: 'absolute', bottom: '4px', right: '5px', fontSize: '9px',
                        background: 'rgba(0,0,0,0.65)', padding: '0.1rem 0.35rem', borderRadius: '3px', color: GREY,
                      }}>{s.seconds}s</span>
                    </div>
                    <div style={{ padding: '0.4rem 0.5rem' }}>
                      <p style={{ fontSize: '10px', color: GREY, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {s.description || 'No description'}
                      </p>
                      <div style={{ display: 'flex', gap: '0.3rem', marginTop: '0.3rem' }}>
                        <button onClick={e => { e.stopPropagation(); move(s.id, -1) }} disabled={i === 0}
                          style={{ flex: 1, fontSize: '10px', padding: '0.1rem', cursor: i === 0 ? 'default' : 'pointer', background: 'transparent', border: `1px solid ${LINE}`, borderRadius: '3px', color: i === 0 ? '#334155' : GREY }}>←</button>
                        <button onClick={e => { e.stopPropagation(); move(s.id, 1) }} disabled={i === shots.length - 1}
                          style={{ flex: 1, fontSize: '10px', padding: '0.1rem', cursor: i === shots.length - 1 ? 'default' : 'pointer', background: 'transparent', border: `1px solid ${LINE}`, borderRadius: '3px', color: i === shots.length - 1 ? '#334155' : GREY }}>→</button>
                        <button onClick={e => { e.stopPropagation(); removeShot(s.id) }} disabled={shots.length === 1}
                          style={{ flex: 1, fontSize: '10px', padding: '0.1rem', cursor: 'pointer', background: 'transparent', border: `1px solid ${LINE}`, borderRadius: '3px', color: '#f87171' }}>×</button>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </section>

        {/* ── Right rail ── */}
        <aside className="ms-rail">
          <div style={{ background: CARD, border: `1px solid ${LINE}`, borderRadius: '1rem', padding: '1.1rem' }}>
            <p style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.1em', color: GREY, textTransform: 'uppercase', marginBottom: '0.85rem' }}>Movie settings</p>
            <div style={{ marginBottom: '0.75rem' }}>
              <label style={lbl}>Format</label>
              <select value={resolution} onChange={e => setResolution(Number(e.target.value))} style={inp}>
                {RESOLUTIONS.map((r, i) => <option key={r.label} value={i}>{r.label}</option>)}
              </select>
            </div>
            <div style={{ marginBottom: '0.75rem' }}>
              <label style={lbl}>Audio</label>
              <select value={audioMode} onChange={e => setAudioMode(e.target.value)} style={inp}>
                <option value="native">Model audio</option>
                <option value="elevenlabs">Narration only</option>
                <option value="both">Narration + ambience</option>
                <option value="none">Silent</option>
              </select>
            </div>
            {(audioMode === 'elevenlabs' || audioMode === 'both') && (
              <div>
                <label style={lbl}>Voice</label>
                <select value={voiceId ?? ''} onChange={e => setVoiceId(e.target.value)} style={inp}>
                  {voices.map(v => <option key={v.voiceId} value={v.voiceId}>{v.name}{v.category === 'cloned' ? ' ★' : ''}</option>)}
                </select>
              </div>
            )}
          </div>

          <div style={{ background: CARD, border: `1px solid ${LINE}`, borderRadius: '1rem', padding: '1.1rem' }}>
            <p style={{ fontSize: '13px', fontWeight: 700, marginBottom: '0.3rem' }}>
              {done === shots.length ? 'All shots ready' : `${shots.length - done} shot${shots.length - done === 1 ? '' : 's'} to go`}
            </p>
            <p style={{ fontSize: '11px', color: GREY, lineHeight: 1.6, marginBottom: '0.85rem' }}>
              Stitches every shot in timeline order with crossfades and mixes the audio.
            </p>
            <button onClick={assemble} disabled={busy || done === 0 || !podRunning}
              style={{
                width: '100%', padding: '0.7rem', borderRadius: '0.5rem', border: 'none',
                background: done > 0 && podRunning ? GOLD : LINE,
                color: done > 0 && podRunning ? '#0A1220' : '#64748b',
                fontSize: '13px', fontWeight: 700,
                cursor: busy || done === 0 || !podRunning ? 'not-allowed' : 'pointer',
              }}>
              Create movie
            </button>
          </div>

          {films.length > 0 && (
            <div style={{ background: CARD, border: `1px solid ${LINE}`, borderRadius: '1rem', padding: '1.1rem' }}>
              <p style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.1em', color: GREY, textTransform: 'uppercase', marginBottom: '0.75rem' }}>Your movies</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                {films.slice(0, 4).map(f => (
                  <div key={f.id}>
                    {f.state === 'done' && f.file
                      ? <video src={`/api/admin/videogen/assemble?file=${f.file}`} controls playsInline
                          style={{ width: '100%', borderRadius: '0.5rem', background: '#000', border: `1px solid ${LINE}` }} />
                      : <div style={{ padding: '0.6rem', borderRadius: '0.5rem', background: '#070c14', fontSize: '11px', color: f.state === 'error' ? '#f87171' : '#fbbf24' }}>
                          {f.state === 'building' ? 'Rendering movie…' : f.error ?? 'Failed'}
                        </div>}
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '0.3rem' }}>
                      <span style={{ fontSize: '10px', color: GREY }}>
                        {f.duration ? `${f.duration.toFixed(1)}s` : ''} {f.bytes ? `· ${(f.bytes / 1e6).toFixed(1)}MB` : ''}
                      </span>
                      {f.state === 'done' && (
                        <a href={`/api/admin/videogen/assemble?file=${f.file}&download=1`} download
                          style={{ fontSize: '10px', color: GOLD, fontWeight: 700 }}>Download</a>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </aside>
      </div>
    </main>
  )
}
