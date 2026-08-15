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
  { key: 'native', label: 'Model audio', hint: "LTX 2.5's own ambience and sound design. Free." },
  { key: 'elevenlabs', label: 'ElevenLabs narration', hint: 'Scripted voiceover. Uses credits.' },
  { key: 'both', label: 'Both, layered', hint: 'Model ambience under ElevenLabs narration.' },
  { key: 'none', label: 'Silent', hint: 'No audio track.' },
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

const label = { fontSize: '10px', color: 'var(--grey)', textTransform: 'uppercase' as const, letterSpacing: '0.08em', fontWeight: 700, display: 'block', marginBottom: '0.3rem' }
const input = { width: '100%', padding: '0.6rem 0.8rem', borderRadius: '0.5rem', background: '#070c14', border: '1px solid #1a2840', color: 'var(--white)', fontSize: '13px', outline: 'none', fontFamily: 'var(--font-body)' }
const sectionLabel = { fontSize: '10px', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase' as const, color: 'var(--grey)', marginBottom: '1rem' }

function totalDuration(scenes: Scene[]) {
  // 1s crossfade between consecutive clips eats a second per join.
  const raw = scenes.reduce((n, s) => n + s.seconds, 0)
  return Math.max(0, raw - Math.max(0, scenes.length - 1))
}

// ── Characters ──

function CharacterPanel({
  characters, onChange,
}: { characters: Character[]; onChange: () => void }) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const save = async () => {
    if (!name.trim()) return
    setSaving(true); setErr(null)
    try {
      const fd = new FormData()
      fd.append('name', name.trim())
      fd.append('description', description.trim())
      if (file) fd.append('image', file)
      const res = await fetch('/api/admin/videogen/characters', { method: 'POST', body: fd })
      const data = await res.json()
      if (!res.ok || data.error) throw new Error(data.error || 'Save failed')
      setName(''); setDescription(''); setFile(null)
      if (fileRef.current) fileRef.current.value = ''
      onChange()
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const remove = async (id: string) => {
    if (!confirm('Delete this character? Scenes using it will fall back to prompt-only.')) return
    await fetch(`/api/admin/videogen/characters?id=${id}`, { method: 'DELETE' })
    onChange()
  }

  return (
    <div style={{ marginBottom: '2.5rem' }}>
      <p style={sectionLabel}>CHARACTERS</p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '1rem', marginBottom: '1rem' }}>
        {characters.map(c => (
          <div key={c.id} style={{ borderRadius: '0.75rem', overflow: 'hidden', background: 'var(--navy-card)', border: '1px solid #1a2840' }}>
            {c.imageFile ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={`/api/admin/videogen/characters?image=${encodeURIComponent(c.imageFile)}`}
                alt={c.name}
                style={{ width: '100%', height: '150px', objectFit: 'cover', display: 'block', background: '#070c14' }} />
            ) : (
              <div style={{ height: '150px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#070c14', color: '#334155', fontSize: '11px' }}>
                Prompt-only
              </div>
            )}
            <div style={{ padding: '0.75rem 0.9rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem' }}>
                <p style={{ fontWeight: 700, fontSize: '13px', color: 'var(--white)' }}>{c.name}</p>
                <button onClick={() => remove(c.id)} style={{ background: 'none', border: 'none', color: '#f87171', fontSize: '11px', cursor: 'pointer', padding: 0 }}>Delete</button>
              </div>
              {c.description && (
                <p style={{ fontSize: '11px', color: 'var(--grey)', marginTop: '0.3rem', lineHeight: 1.5 }}>{c.description}</p>
              )}
            </div>
          </div>
        ))}
      </div>

      <div style={{ padding: '1.25rem', borderRadius: '0.75rem', background: 'var(--navy-card)', border: '1px dashed #1a3050' }}>
        <p style={{ fontSize: '12px', fontWeight: 700, color: 'var(--white)', marginBottom: '0.85rem' }}>Add a character</p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.85rem', alignItems: 'start' }}>
          <div>
            <label style={label}>Name</label>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Meera" style={input} />
          </div>
          <div>
            <label style={label}>Reference image</label>
            <input ref={fileRef} type="file" accept="image/*"
              onChange={e => setFile(e.target.files?.[0] ?? null)}
              style={{ ...input, padding: '0.45rem', fontSize: '11px' }} />
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <label style={label}>Appearance description</label>
            <input value={description} onChange={e => setDescription(e.target.value)}
              placeholder="e.g. Indian woman in her late 20s, long dark hair, warm smile, emerald silk saree"
              style={input} />
          </div>
        </div>
        <p style={{ fontSize: '10px', color: '#64748b', marginTop: '0.6rem', lineHeight: 1.6 }}>
          The image seeds the first frame of every scene this character appears in — that&apos;s what keeps them
          looking like the same person. The description is prepended to those scene prompts.
        </p>
        {err && <p style={{ fontSize: '11px', color: '#f87171', marginTop: '0.5rem' }}>{err}</p>}
        <button onClick={save} disabled={saving || !name.trim()}
          style={{
            marginTop: '0.85rem', padding: '0.55rem 1.25rem', borderRadius: '0.5rem', border: 'none',
            background: name.trim() ? 'var(--gold)' : '#1a2840', color: name.trim() ? 'var(--navy)' : '#64748b',
            fontSize: '12px', fontWeight: 700, cursor: saving || !name.trim() ? 'not-allowed' : 'pointer',
          }}>
          {saving ? 'Saving…' : 'Add character'}
        </button>
      </div>
    </div>
  )
}

// ── Scene row ──

function SceneRow({
  scene, index, totalScenes, characters, onUpdate, onDelete, onGenerate, onMoveUp, onMoveDown, audioMode, voiceId, podRunning, dragHandleProps,
}: {
  scene: Scene
  index: number
  totalScenes: number
  characters: Character[]
  onUpdate: (s: Scene) => void
  onDelete: () => void
  onGenerate: () => void
  onMoveUp: () => void
  onMoveDown: () => void
  audioMode: string
  voiceId?: string
  podRunning: boolean
  dragHandleProps?: any
}) {
  const [vo, setVo] = useState<string | null>(null)
  const [voLoading, setVoLoading] = useState(false)
  const [voErr, setVoErr] = useState<string | null>(null)
  const [previewInfo, setPreviewInfo] = useState<{ duration: number; fittedSeconds: number } | null>(null)

  const videoUrl = scene.filename
    ? `/api/admin/videogen/video?filename=${encodeURIComponent(scene.filename)}&subfolder=${encodeURIComponent(scene.subfolder ?? 'gen')}`
    : null

  const effectiveAudioMode = scene.audioMode || audioMode
  const wantsNarration = effectiveAudioMode === 'elevenlabs' || effectiveAudioMode === 'both'

  const makeVoiceover = async () => {
    if (!scene.narration?.trim()) return
    setVoLoading(true); setVoErr(null)
    try {
      const res = await fetch('/api/admin/videogen/voiceover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: scene.narration, voiceId }),
      })
      if (!res.ok) throw new Error((await res.json()).error || 'Voiceover failed')
      const blob = await res.blob()
      const blobUrl = URL.createObjectURL(blob)
      setVo(blobUrl)

      const audio = new Audio(blobUrl)
      audio.addEventListener('loadedmetadata', () => {
        const dur = audio.duration
        if (dur && !isNaN(dur)) {
          const fitted = Math.max(2, Math.ceil(dur + 0.8))
          setPreviewInfo({ duration: dur, fittedSeconds: fitted })
          onUpdate({ ...scene, seconds: fitted })
        }
      })
    } catch (e) {
      setVoErr((e as Error).message)
    } finally {
      setVoLoading(false)
    }
  }

  const stateColor =
    scene.state === 'done' ? '#4ade80'
    : scene.state === 'error' ? '#f87171'
    : scene.state === 'queued' || scene.state === 'running' ? '#fbbf24'
    : '#334155'

  return (
    <div style={{
      borderRadius: '0.75rem', padding: '1.25rem',
      background: 'var(--navy-card)', border: '1px solid #1a2840',
      display: 'grid', gridTemplateColumns: '36px minmax(0,1fr) 260px', gap: '1.25rem',
    }}>
      {/* Control Column: Drag handle and Up/Down buttons */}
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '0.4rem',
        paddingRight: '0.5rem',
        borderRight: '1px solid #1a2840',
        marginRight: '0.2rem',
      }}>
        {/* Drag Handle */}
        <div
          {...dragHandleProps}
          style={{
            cursor: 'grab',
            padding: '0.3rem',
            color: '#475569',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          title="Drag to reorder"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="9" cy="5" r="1" />
            <circle cx="9" cy="12" r="1" />
            <circle cx="9" cy="19" r="1" />
            <circle cx="15" cy="5" r="1" />
            <circle cx="15" cy="12" r="1" />
            <circle cx="15" cy="19" r="1" />
          </svg>
        </div>

        {/* Up Button */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onMoveUp();
          }}
          disabled={index === 0}
          style={{
            background: 'none',
            border: 'none',
            color: index === 0 ? '#1e293b' : '#64748b',
            cursor: index === 0 ? 'not-allowed' : 'pointer',
            padding: '0.2rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'color 0.2s',
          }}
          title="Move up"
          className="hover-white-transition"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="18 15 12 9 6 15" />
          </svg>
        </button>

        {/* Down Button */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onMoveDown();
          }}
          disabled={index === totalScenes - 1}
          style={{
            background: 'none',
            border: 'none',
            color: index === totalScenes - 1 ? '#1e293b' : '#64748b',
            cursor: index === totalScenes - 1 ? 'not-allowed' : 'pointer',
            padding: '0.2rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'color 0.2s',
          }}
          title="Move down"
          className="hover-white-transition"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>
      </div>
      <div>
        <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', marginBottom: '0.75rem' }}>
          <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: stateColor, flexShrink: 0 }} />
          <input value={scene.title} onChange={e => onUpdate({ ...scene, title: e.target.value })}
            style={{ ...input, fontWeight: 700, padding: '0.4rem 0.6rem', width: 'auto', flex: 1 }} />
          <button onClick={onDelete} style={{ background: 'none', border: 'none', color: '#64748b', fontSize: '11px', cursor: 'pointer' }}>Remove</button>
        </div>

        <textarea value={scene.prompt} onChange={e => onUpdate({ ...scene, prompt: e.target.value })}
          rows={2} placeholder="What happens in this shot?"
          style={{ ...input, lineHeight: 1.6, resize: 'vertical' }} />

        <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.75rem', flexWrap: 'wrap' }}>
          <div>
            <label style={label}>Duration</label>
            <select value={scene.seconds} onChange={e => onUpdate({ ...scene, seconds: Number(e.target.value) })}
              style={{ ...input, padding: '0.4rem 0.6rem', fontSize: '12px' }}>
              {Array.from(new Set([2, 3, 4, 5, 6, 8, 10, Math.ceil(scene.seconds)]))
                .sort((a, b) => a - b)
                .map(s => <option key={s} value={s}>{s}s</option>)}
            </select>
          </div>
          <div style={{ flex: 1, minWidth: '140px' }}>
            <label style={label}>Character</label>
            <select value={scene.characterId ?? ''} onChange={e => onUpdate({ ...scene, characterId: e.target.value || undefined })}
              style={{ ...input, padding: '0.4rem 0.6rem', fontSize: '12px' }}>
              <option value="">None</option>
              {characters.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div style={{ flex: 1, minWidth: '140px' }}>
            <label style={label}>Audio Override</label>
            <select value={scene.audioMode ?? ''} onChange={e => onUpdate({ ...scene, audioMode: e.target.value || undefined })}
              style={{ ...input, padding: '0.4rem 0.6rem', fontSize: '12px' }}>
              <option value="">Global Default</option>
              <option value="native">Model audio</option>
              <option value="elevenlabs">ElevenLabs narration</option>
              <option value="both">Both, layered</option>
              <option value="none">Silent</option>
            </select>
          </div>
        </div>

        {wantsNarration && (
          <div style={{ marginTop: '0.75rem' }}>
            <label style={label}>Narration</label>
            <textarea value={scene.narration ?? ''} onChange={e => onUpdate({ ...scene, narration: e.target.value })}
              rows={2} placeholder="What the voice says over this shot…"
              style={{ ...input, lineHeight: 1.6, resize: 'vertical' }} />
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginTop: '0.5rem', flexWrap: 'wrap' }}>
              <button onClick={makeVoiceover} disabled={voLoading || !scene.narration?.trim()}
                style={{
                  fontSize: '11px', padding: '0.3rem 0.7rem', fontWeight: 700, borderRadius: '0.375rem',
                  border: '1px solid rgba(232,185,74,0.25)', background: 'transparent',
                  color: scene.narration?.trim() ? 'var(--gold)' : '#64748b',
                  cursor: voLoading || !scene.narration?.trim() ? 'not-allowed' : 'pointer',
                }}>
                  {voLoading ? 'Synthesizing…' : 'Preview voice'}
              </button>
              {vo && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                  <audio src={vo} controls style={{ height: '30px', maxWidth: '210px' }} />
                  {previewInfo && (
                    <span style={{
                      fontSize: '10px',
                      color: 'var(--gold)',
                      background: 'rgba(232,185,74,0.1)',
                      padding: '0.2rem 0.4rem',
                      borderRadius: '0.25rem',
                      border: '1px solid rgba(232,185,74,0.2)',
                    }}>
                      Fitted to {previewInfo.fittedSeconds}s (audio: {previewInfo.duration.toFixed(1)}s)
                    </span>
                  )}
                </div>
              )}
            </div>
            {voErr && <p style={{ fontSize: '11px', color: '#f87171', marginTop: '0.4rem' }}>{voErr}</p>}
          </div>
        )}

        {scene.error && (
          <p style={{ fontSize: '11px', color: '#f87171', marginTop: '0.6rem', lineHeight: 1.5 }}>{scene.error}</p>
        )}
      </div>

      <div>
        {videoUrl ? (
          <>
            <video src={videoUrl} controls loop playsInline
              style={{ width: '100%', borderRadius: '0.5rem', background: '#000', border: '1px solid #1a2840' }} />
            <a href={`${videoUrl}&download=1`} download
              style={{ display: 'inline-block', marginTop: '0.5rem', fontSize: '11px', color: 'var(--gold)', fontWeight: 700 }}>
              Download
            </a>
          </>
        ) : (
          <div style={{
            width: '100%', aspectRatio: '16/9', borderRadius: '0.5rem',
            background: '#070c14', border: '1px dashed #1a2840',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '11px', color: '#334155', textAlign: 'center', padding: '0.5rem',
          }}>
            {scene.state === 'queued' ? 'Queued…'
              : scene.state === 'running' ? 'Generating…'
              : scene.state === 'error' ? 'Failed'
              : 'Not generated'}
          </div>
        )}
        <button onClick={onGenerate} disabled={!podRunning || !scene.prompt.trim()}
          style={{
            width: '100%', marginTop: '0.5rem', padding: '0.5rem', borderRadius: '0.4rem', border: 'none',
            background: podRunning && scene.prompt.trim() ? 'rgba(232,185,74,0.12)' : '#1a2840',
            color: podRunning && scene.prompt.trim() ? 'var(--gold)' : '#64748b',
            fontSize: '11px', fontWeight: 700,
            cursor: podRunning && scene.prompt.trim() ? 'pointer' : 'not-allowed',
          }}>
          {scene.filename ? 'Regenerate' : 'Generate scene'}
        </button>
      </div>
    </div>
  )
}

// ── Captions ──

function CaptionPanel({
  style, onChange, fonts, positions, sampleText,
}: {
  style: CaptionStyle
  onChange: (s: CaptionStyle) => void
  fonts: string[]
  positions: { key: string; label: string }[]
  sampleText: string
}) {
  const set = <K extends keyof CaptionStyle>(k: K, v: CaptionStyle[K]) => onChange({ ...style, [k]: v })

  const preview = style.uppercase ? sampleText.toUpperCase() : sampleText
  const shadow = style.boxed
    ? 'none'
    : `${style.outlineWidth}px ${style.outlineWidth}px 0 ${style.outlineColor}, ` +
      `-${style.outlineWidth}px -${style.outlineWidth}px 0 ${style.outlineColor}, ` +
      `${style.outlineWidth}px -${style.outlineWidth}px 0 ${style.outlineColor}, ` +
      `-${style.outlineWidth}px ${style.outlineWidth}px 0 ${style.outlineColor}`

  return (
    <div style={{ padding: '1.25rem', borderRadius: '0.75rem', background: 'var(--navy-card)', border: '1px solid #1a2840' }}>
      <label style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', cursor: 'pointer', marginBottom: style.enabled ? '1rem' : 0 }}>
        <input type="checkbox" checked={style.enabled} onChange={e => set('enabled', e.target.checked)}
          style={{ accentColor: 'var(--gold)', width: '15px', height: '15px', cursor: 'pointer' }} />
        <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--white)' }}>Burn in captions</span>
        <span style={{ fontSize: '11px', color: 'var(--grey)' }}>from each scene&apos;s narration</span>
      </label>

      {style.enabled && (
        <>
          {/* Live preview */}
          <div style={{
            position: 'relative', height: '110px', borderRadius: '0.5rem', marginBottom: '1rem',
            background: 'linear-gradient(135deg, #1a2434 0%, #0b1220 100%)',
            border: '1px solid #1a2840', display: 'flex', overflow: 'hidden',
            alignItems: style.position === 'top' ? 'flex-start' : style.position === 'middle' ? 'center' : 'flex-end',
            justifyContent: 'center', padding: '0.75rem',
          }}>
            <span style={{
              fontFamily: `"${style.font}", sans-serif`,
              fontSize: `${style.fontSize}px`,
              color: style.color,
              textShadow: shadow,
              background: style.boxed ? 'rgba(0,0,0,0.6)' : 'transparent',
              padding: style.boxed ? '0.15em 0.5em' : 0,
              borderRadius: style.boxed ? '3px' : 0,
              textAlign: 'center', lineHeight: 1.3, maxWidth: '90%',
            }}>
              {preview || 'Caption preview'}
            </span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.85rem' }}>
            <div>
              <label style={label}>Font</label>
              <select value={style.font} onChange={e => set('font', e.target.value)} style={input}>
                {fonts.map(f => <option key={f} value={f}>{f}</option>)}
              </select>
            </div>
            <div>
              <label style={label}>Size — {style.fontSize}px</label>
              <input type="range" min={12} max={48} value={style.fontSize}
                onChange={e => set('fontSize', Number(e.target.value))}
                style={{ width: '100%', accentColor: 'var(--gold)' }} />
            </div>
            <div>
              <label style={label}>Position</label>
              <select value={style.position} onChange={e => set('position', e.target.value)} style={input}>
                {positions.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
              </select>
            </div>
            <div>
              <label style={label}>Text colour</label>
              <input type="color" value={style.color} onChange={e => set('color', e.target.value)}
                style={{ ...input, padding: '0.2rem', height: '36px', cursor: 'pointer' }} />
            </div>
            <div>
              <label style={label}>{style.boxed ? 'Box colour' : 'Outline colour'}</label>
              <input type="color" value={style.outlineColor} onChange={e => set('outlineColor', e.target.value)}
                style={{ ...input, padding: '0.2rem', height: '36px', cursor: 'pointer' }} />
            </div>
            {!style.boxed && (
              <div>
                <label style={label}>Outline — {style.outlineWidth}px</label>
                <input type="range" min={0} max={5} value={style.outlineWidth}
                  onChange={e => set('outlineWidth', Number(e.target.value))}
                  style={{ width: '100%', accentColor: 'var(--gold)' }} />
              </div>
            )}
          </div>

          <div style={{ display: 'flex', gap: '1.25rem', marginTop: '0.85rem', flexWrap: 'wrap' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer', fontSize: '11px', color: 'var(--grey)' }}>
              <input type="checkbox" checked={style.boxed} onChange={e => set('boxed', e.target.checked)}
                style={{ accentColor: 'var(--gold)', cursor: 'pointer' }} />
              Boxed background
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer', fontSize: '11px', color: 'var(--grey)' }}>
              <input type="checkbox" checked={style.uppercase} onChange={e => set('uppercase', e.target.checked)}
                style={{ accentColor: 'var(--gold)', cursor: 'pointer' }} />
              UPPERCASE
            </label>
          </div>
        </>
      )}
    </div>
  )
}

// ── Studio ──

export default function StudioClient() {
  const [characters, setCharacters] = useState<Character[]>([])
  const [board, setBoard] = useState<Storyboard | null>(null)
  const [boards, setBoards] = useState<Storyboard[]>([])
  const [voices, setVoices] = useState<Voice[]>([])
  const [podRunning, setPodRunning] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null)
  const [isDraggable, setIsDraggable] = useState<boolean>(false)

  // ── Assembly ──
  const [captions, setCaptions] = useState<CaptionStyle>(DEFAULT_CAPTIONS)
  const [fonts, setFonts] = useState<string[]>([])
  const [positions, setPositions] = useState<{ key: string; label: string }[]>([])
  const [films, setFilms] = useState<Film[]>([])
  const [diskBytes, setDiskBytes] = useState(0)
  const [assembling, setAssembling] = useState(false)

  const loadFilms = useCallback(async () => {
    const r = await fetch('/api/admin/videogen/assemble', { cache: 'no-store' })
    if (!r.ok) return
    const d = await r.json()
    setFilms(d.films ?? [])
    setDiskBytes(d.diskBytes ?? 0)
    if (d.fonts?.length) setFonts(d.fonts)
    if (d.positions?.length) setPositions(d.positions)
  }, [])

  const loadCharacters = useCallback(async () => {
    const r = await fetch('/api/admin/videogen/characters', { cache: 'no-store' })
    if (r.ok) setCharacters((await r.json()).characters ?? [])
  }, [])

  useEffect(() => {
    ;(async () => {
      const [c, sb, v, pods] = await Promise.all([
        fetch('/api/admin/videogen/characters', { cache: 'no-store' }).then(r => r.ok ? r.json() : { characters: [] }),
        fetch('/api/admin/videogen/storyboard', { cache: 'no-store' }).then(r => r.ok ? r.json() : { storyboards: [] }),
        fetch('/api/admin/videogen/voices', { cache: 'no-store' }).then(r => r.ok ? r.json() : { voices: [] }),
        fetch('/api/admin/videogen', { cache: 'no-store' }).then(r => r.ok ? r.json() : null),
      ])
      setCharacters(c.characters ?? [])
      const initialBoards = sb.storyboards?.length ? sb.storyboards : [{
        id: uid(), title: 'Jewellery brand film', resolution: DEFAULT_RESOLUTION,
        audioMode: 'native', voiceId: v.voices?.[0]?.voiceId,
        scenes: [emptyScene(0)], createdAt: Date.now(), updatedAt: Date.now(),
      }]
      setBoards(initialBoards)
      setVoices(v.voices ?? [])
      setPodRunning(pods?.ltx?.desiredStatus === 'RUNNING')
      setBoard(initialBoards[0])
      await loadFilms()
      setLoading(false)
    })()
  }, [loadFilms])

  // Poll while a film is rendering.
  const building = films.some(f => f.state === 'building')
  useEffect(() => {
    if (!building) return
    const iv = setInterval(loadFilms, 4000)
    return () => clearInterval(iv)
  }, [building, loadFilms])

  const assemble = async () => {
    if (!board) return
    setErr(null); setAssembling(true)
    try {
      await persist(board)
      const res = await fetch('/api/admin/videogen/assemble', {
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
    if (!confirm('Delete this film from the server?')) return
    await fetch(`/api/admin/videogen/assemble?id=${id}`, { method: 'DELETE' })
    await loadFilms()
  }

  const persist = useCallback(async (b: Storyboard) => {
    setSaving(true)
    try {
      const res = await fetch('/api/admin/videogen/storyboard', {
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
    } finally {
      setSaving(false)
    }
  }, [])

  const update = (patch: Partial<Storyboard>) => {
    setBoard(b => (b ? { ...b, ...patch } : b))
  }

  const updateScene = (s: Scene) => {
    setBoard(b => b ? { ...b, scenes: b.scenes.map(x => x.id === s.id ? s : x) } : b)
  }

  const moveScene = (index: number, direction: 'up' | 'down') => {
    if (!board) return
    const newIndex = direction === 'up' ? index - 1 : index + 1
    if (newIndex < 0 || newIndex >= board.scenes.length) return

    const newScenes = [...board.scenes]
    const temp = newScenes[index]
    newScenes[index] = newScenes[newIndex]
    newScenes[newIndex] = temp

    // Re-assign the order field to match the new index
    const updatedScenes = newScenes.map((s, idx) => ({ ...s, order: idx }))

    const updatedBoard = { ...board, scenes: updatedScenes }
    setBoard(updatedBoard)
    persist(updatedBoard)
  }

  const handleDragStart = (e: React.DragEvent, index: number) => {
    e.dataTransfer.effectAllowed = 'move'
    setDraggedIndex(index)
  }

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault()
    if (!board || draggedIndex === null || draggedIndex === index) return

    const newScenes = [...board.scenes]
    const draggedItem = newScenes[draggedIndex]
    newScenes.splice(draggedIndex, 1)
    newScenes.splice(index, 0, draggedItem)

    // Re-assign the order field to match the new index
    const updatedScenes = newScenes.map((s, idx) => ({ ...s, order: idx }))

    setBoard(b => b ? { ...b, scenes: updatedScenes } : b)
    setDraggedIndex(index)
  }

  const handleDragEnd = () => {
    setDraggedIndex(null)
    setIsDraggable(false)
    if (board) {
      persist(board)
    }
  }

  const createNewStoryboard = async () => {
    const newSb: Storyboard = {
      id: uid(),
      title: 'New Movie Storyboard',
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
    if (!confirm(`Are you sure you want to delete "${board.title}"?`)) return

    try {
      const res = await fetch(`/api/admin/videogen/storyboard?id=${board.id}`, {
        method: 'DELETE',
      })
      if (!res.ok) throw new Error('Delete failed')

      const remaining = boards.filter(b => b.id !== board.id)
      setBoards(remaining)

      if (remaining.length > 0) {
        setBoard(remaining[0])
      } else {
        const fallbackSb: Storyboard = {
          id: uid(),
          title: 'Jewellery brand film',
          resolution: DEFAULT_RESOLUTION,
          audioMode: 'native',
          voiceId: voices[0]?.voiceId,
          scenes: [emptyScene(0)],
          createdAt: Date.now(),
          updatedAt: Date.now(),
        }
        await persist(fallbackSb)
        setBoard(fallbackSb)
      }
    } catch (e) {
      setErr((e as Error).message)
    }
  }

  const generate = async (sceneIds?: string[]) => {
    if (!board) return
    setErr(null)
    await persist(board)
    try {
      const res = await fetch('/api/admin/videogen/storyboard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: board.id, sceneIds }),
      })
      const data = await res.json()
      if (!res.ok || data.error) throw new Error(data.error || 'Generation failed')
      if (data.storyboard) setBoard(data.storyboard)
    } catch (e) {
      setErr((e as Error).message)
    }
  }

  // Poll scenes that are still rendering.
  const pendingIds = (board?.scenes ?? [])
    .filter(s => s.promptId && (s.state === 'queued' || s.state === 'running'))
    .map(s => s.promptId!)
    .join(',')

  useEffect(() => {
    if (!pendingIds) return
    let stop = false
    const tick = async () => {
      try {
        const r = await fetch(`/api/admin/videogen/status?ids=${pendingIds}`, { cache: 'no-store' })
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
        // transient
      }
    }
    tick()
    const iv = setInterval(tick, 5000)
    return () => { stop = true; clearInterval(iv) }
  }, [pendingIds])

  // Persist finished renders so results survive a reload.
  const doneCount = (board?.scenes ?? []).filter(s => s.state === 'done').length
  useEffect(() => {
    if (board && doneCount > 0 && !pendingIds) persist(board)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doneCount, pendingIds])

  if (loading || !board) {
    return (
      <main className="grid-bg" style={{ background: 'var(--navy)', minHeight: '100vh' }}>
        <p style={{ padding: '4rem', textAlign: 'center', color: 'var(--grey)', fontSize: '13px' }}>Loading studio…</p>
      </main>
    )
  }

  const done = board.scenes.filter(s => s.state === 'done').length
  const total = board.scenes.length
  const wantsVoice = board.audioMode === 'elevenlabs' || board.audioMode === 'both'

  return (
    <main className="grid-bg" style={{ background: 'var(--navy)', minHeight: '100vh', paddingBottom: '4rem' }}>
      <header style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '1.25rem 2rem', borderBottom: '1px solid #1a2840', background: '#0a1220',
        flexWrap: 'wrap', gap: '1rem',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
          <Link href="/admin/videogen" style={{ color: 'var(--gold)', fontSize: '12px', textDecoration: 'none', fontWeight: 700 }} className="hover-white-transition">
            ← Home
          </Link>
          <span style={{ color: '#1a2840' }}>|</span>
          <Link href="/admin/videogen/movie" style={{ color: 'var(--gold)', fontSize: '12px', textDecoration: 'none', fontWeight: 700 }} className="hover-white-transition">
            🎬 Movie Generation
          </Link>
          <span style={{ color: '#1a2840' }}>|</span>
          <Link href="/admin/videogen/canvas" style={{ color: 'var(--grey)', fontSize: '12px', textDecoration: 'none' }} className="hover-white-transition">
            🌌 Canvas Mode
          </Link>
          <span style={{ color: '#1a2840' }}>|</span>
          <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, color: 'var(--gold)', fontSize: '1.05rem', marginRight: '0.5rem' }}>
            🎥 Movie Studio:
          </span>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
            <select
              value={board.id}
              onChange={(e) => {
                const selected = boards.find(b => b.id === e.target.value)
                if (selected) setBoard(selected)
              }}
              style={{
                background: '#070c14',
                border: '1px solid #1a2840',
                color: 'var(--white)',
                padding: '0.4rem 0.6rem',
                borderRadius: '0.4rem',
                fontSize: '12px',
                fontWeight: 'bold',
                outline: 'none',
                cursor: 'pointer',
              }}
            >
              {[...boards]
                .sort((a, b) => a.createdAt - b.createdAt)
                .map(b => (
                  <option key={b.id} value={b.id}>{b.title}</option>
                ))}
            </select>

            <button
              onClick={createNewStoryboard}
              style={{
                fontSize: '11px',
                padding: '0.4rem 0.8rem',
                fontWeight: 700,
                borderRadius: '0.4rem',
                border: '1px dashed var(--gold)',
                background: 'transparent',
                color: 'var(--gold)',
                cursor: 'pointer',
                transition: 'opacity 0.2s',
              }}
              className="hover-white-transition"
              title="Create new storyboard"
            >
              + New Movie
            </button>

            {boards.length > 1 && (
              <button
                onClick={deleteCurrentStoryboard}
                style={{
                  fontSize: '11px',
                  padding: '0.4rem 0.8rem',
                  fontWeight: 700,
                  borderRadius: '0.4rem',
                  border: '1px solid #f87171',
                  background: 'transparent',
                  color: '#f87171',
                  cursor: 'pointer',
                  transition: 'opacity 0.2s',
                }}
                className="hover-white-transition"
                title="Delete current storyboard"
              >
                Delete Movie
              </button>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
          {saving && <span style={{ fontSize: '10px', color: '#64748b' }}>Saving…</span>}
          {!podRunning && <span style={{ fontSize: '10px', color: '#fbbf24', fontWeight: 700 }}>POD STOPPED</span>}
          <span style={{ fontSize: '11px', color: 'var(--grey)' }}>
            {done}/{total} scenes · ~{totalDuration(board.scenes)}s
          </span>
        </div>
      </header>

      <div style={{ padding: '2rem', maxWidth: '76rem', margin: '0 auto' }}>

        <CharacterPanel characters={characters} onChange={loadCharacters} />

        {/* Movie settings */}
        <div style={{ marginBottom: '2rem' }}>
          <p style={sectionLabel}>MOVIE</p>
          <div style={{ padding: '1.25rem', borderRadius: '0.75rem', background: 'var(--navy-card)', border: '1px solid #1a2840' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem' }}>
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={label}>Title</label>
                <input value={board.title} onChange={e => update({ title: e.target.value })} style={input} />
              </div>
              <div>
                <label style={label}>Resolution</label>
                <select value={board.resolution} onChange={e => update({ resolution: Number(e.target.value) })} style={input}>
                  {RESOLUTIONS.map((r, i) => <option key={r.label} value={i}>{r.label}</option>)}
                </select>
              </div>
              <div>
                <label style={label}>Audio</label>
                <select value={board.audioMode} onChange={e => update({ audioMode: e.target.value })} style={input}>
                  {AUDIO_MODES.map(m => <option key={m.key} value={m.key}>{m.label}</option>)}
                </select>
              </div>
              {wantsVoice && (
                <div>
                  <label style={label}>Voice ({voices.length} available)</label>
                  <select value={board.voiceId ?? ''} onChange={e => update({ voiceId: e.target.value })} style={input}>
                    {voices.map(v => (
                      <option key={v.voiceId} value={v.voiceId}>
                        {v.name}{v.category === 'cloned' ? ' ★ your clone' : ''}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
            <p style={{ fontSize: '10px', color: '#64748b', marginTop: '0.75rem' }}>
              {AUDIO_MODES.find(m => m.key === board.audioMode)?.hint}
            </p>
          </div>
        </div>

        {/* Scenes */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <p style={{ ...sectionLabel, marginBottom: 0 }}>STORYBOARD — {total} scenes</p>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button onClick={() => {
              const nextScenes = [...board.scenes, emptyScene(board.scenes.length)]
              const updatedBoard = { ...board, scenes: nextScenes }
              setBoard(updatedBoard)
              persist(updatedBoard)
            }}
              style={{
                fontSize: '11px', padding: '0.4rem 0.9rem', fontWeight: 700, borderRadius: '0.4rem',
                border: '1px solid #1a2840', background: 'transparent', color: 'var(--grey)', cursor: 'pointer',
              }}>
              + Add scene
            </button>
            <button onClick={() => generate()} disabled={!podRunning}
              style={{
                fontSize: '11px', padding: '0.4rem 1rem', fontWeight: 700, borderRadius: '0.4rem', border: 'none',
                background: podRunning ? 'var(--gold)' : '#1a2840',
                color: podRunning ? 'var(--navy)' : '#64748b',
                cursor: podRunning ? 'pointer' : 'not-allowed',
              }}>
              Generate all scenes
            </button>
          </div>
        </div>

        {err && <p style={{ fontSize: '11px', color: '#f87171', marginBottom: '0.75rem' }}>{err}</p>}

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
          {board.scenes.map((s, index) => (
            <div
              key={s.id}
              draggable={isDraggable}
              onDragStart={(e) => handleDragStart(e, index)}
              onDragOver={(e) => handleDragOver(e, index)}
              onDragEnd={handleDragEnd}
              style={{
                opacity: draggedIndex === index ? 0.4 : 1,
                transition: 'opacity 0.2s, transform 0.2s',
                transform: draggedIndex === index ? 'scale(0.98)' : 'scale(1)',
              }}
            >
              <SceneRow
                scene={s}
                index={index}
                totalScenes={board.scenes.length}
                characters={characters}
                audioMode={board.audioMode}
                voiceId={board.voiceId}
                podRunning={podRunning}
                onUpdate={updateScene}
                onDelete={() => {
                  const nextScenes = board.scenes
                    .filter((x) => x.id !== s.id)
                    .map((scene, idx) => ({ ...scene, order: idx }))
                  const updatedBoard = { ...board, scenes: nextScenes }
                  setBoard(updatedBoard)
                  persist(updatedBoard)
                }}
                onGenerate={() => generate([s.id])}
                onMoveUp={() => moveScene(index, 'up')}
                onMoveDown={() => moveScene(index, 'down')}
                dragHandleProps={{
                  onMouseDown: () => setIsDraggable(true),
                  onMouseUp: () => setIsDraggable(false),
                  onTouchStart: () => setIsDraggable(true),
                  onTouchEnd: () => setIsDraggable(false),
                }}
              />
            </div>
          ))}
        </div>

        {/* Captions */}
        <div style={{ marginTop: '2.5rem' }}>
          <p style={sectionLabel}>CAPTIONS</p>
          <CaptionPanel style={captions} onChange={setCaptions}
            fonts={fonts} positions={positions}
            sampleText={board.scenes.find(s => s.narration?.trim())?.narration ?? 'Your narration appears here'} />
        </div>

        {/* Assembly */}
        <div style={{ marginTop: '2.5rem' }}>
          <p style={sectionLabel}>FINAL CUT</p>
          <div style={{ padding: '1.25rem 1.5rem', background: 'var(--navy-card)', borderRadius: '0.75rem', border: '1px solid #1a2840' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
              <div>
                <p style={{ fontSize: '13px', fontWeight: 700, color: 'var(--white)' }}>
                  {done < total
                    ? `${total - done} scene${total - done === 1 ? '' : 's'} still to generate`
                    : `All ${total} scenes ready — about ${totalDuration(board.scenes)}s`}
                </p>
                <p style={{ fontSize: '11px', color: 'var(--grey)', marginTop: '0.25rem' }}>
                  Crossfades the scenes, mixes audio, {captions.enabled ? 'burns in captions, ' : ''}and saves the film to the server.
                </p>
              </div>
              <button onClick={assemble} disabled={assembling || done === 0 || !podRunning}
                style={{
                  padding: '0.6rem 1.5rem', borderRadius: '0.5rem', border: 'none',
                  background: done > 0 && podRunning ? 'var(--gold)' : '#1a2840',
                  color: done > 0 && podRunning ? 'var(--navy)' : '#64748b',
                  fontSize: '13px', fontWeight: 700,
                  cursor: assembling || done === 0 || !podRunning ? 'not-allowed' : 'pointer',
                }}>
                {assembling ? 'Starting…' : 'Assemble film'}
              </button>
            </div>
            {!podRunning && done > 0 && (
              <p style={{ fontSize: '11px', color: '#fbbf24', marginTop: '0.6rem' }}>
                The pod holds the rendered clips — start it before assembling.
              </p>
            )}
          </div>

          {/* Films library */}
          {films.length > 0 && (
            <div style={{ marginTop: '1rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                <p style={{ ...sectionLabel, marginBottom: 0 }}>SAVED FILMS ({films.length})</p>
                <span style={{ fontSize: '10px', color: '#64748b' }}>{fmtBytes(diskBytes)} on server</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                {films.map(f => (
                  <div key={f.id} style={{ padding: '1rem 1.25rem', background: 'var(--navy-card)', borderRadius: '0.75rem', border: '1px solid #1a2840' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', marginBottom: f.state === 'done' ? '0.75rem' : 0 }}>
                      <div>
                        <p style={{ fontSize: '13px', fontWeight: 700, color: 'var(--white)' }}>{f.title}</p>
                        <p style={{ fontSize: '10px', color: 'var(--grey)', marginTop: '0.2rem' }}>
                          {f.state === 'building' ? 'Rendering…'
                            : f.state === 'error' ? 'Failed'
                            : `${f.duration?.toFixed(1)}s · ${fmtBytes(f.bytes ?? 0)}`}
                          {' · '}{new Date(f.createdAt).toLocaleString()}
                        </p>
                      </div>
                      <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                        {f.state === 'done' && (
                          <a href={`/api/admin/videogen/assemble?file=${f.file}&download=1`} download
                            style={{ fontSize: '11px', color: 'var(--gold)', fontWeight: 700 }}>Download</a>
                        )}
                        <button onClick={() => removeFilm(f.id)}
                          style={{ background: 'none', border: 'none', color: '#f87171', fontSize: '11px', cursor: 'pointer' }}>
                          Delete
                        </button>
                      </div>
                    </div>
                    {f.state === 'done' && f.file && (
                      <video src={`/api/admin/videogen/assemble?file=${f.file}`} controls playsInline
                        style={{ width: '100%', maxWidth: '520px', borderRadius: '0.5rem', background: '#000', border: '1px solid #1a2840' }} />
                    )}
                    {f.state === 'error' && (
                      <p style={{ fontSize: '11px', color: '#f87171', marginTop: '0.5rem', lineHeight: 1.5 }}>{f.error}</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Where things live */}
          <div style={{ marginTop: '1rem', padding: '1rem 1.25rem', background: '#0a1220', borderRadius: '0.75rem', border: '1px solid #1a2840' }}>
            <p style={{ fontSize: '11px', fontWeight: 700, color: 'var(--grey)', marginBottom: '0.4rem' }}>Where your files live</p>
            <p style={{ fontSize: '11px', color: '#64748b', lineHeight: 1.7 }}>
              Individual scenes stay on the <strong style={{ color: 'var(--grey)' }}>GPU pod</strong> and are lost when it&apos;s
              terminated. Assembled films are copied to <strong style={{ color: 'var(--grey)' }}>this server</strong> and persist —
              currently {fmtBytes(diskBytes)}. Assemble anything you want to keep before terminating the pod.
            </p>
          </div>
        </div>
      </div>
    </main>
  )
}
