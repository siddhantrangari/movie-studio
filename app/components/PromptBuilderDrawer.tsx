'use client'

import { useState, useRef } from 'react'
import { useToast } from './Toast'

export type PromptBuilderResult = {
  title?: string
  prompt?: string
  cameraMotion?: string
  lighting?: string
  colorPalette?: string
  name?: string
  tag?: string
  description?: string
  wardrobe?: string
  turnaroundPrompt?: string
  voiceRecommendation?: string
  logline?: string
  shots?: Array<{
    order: number
    title: string
    seconds: number
    camera: string
    lighting: string
    prompt: string
  }>
}

type Props = {
  isOpen: boolean
  onToggle: () => void
  onWideToggle?: (wide: boolean) => void
  initialType?: 'scene' | 'character' | 'movie'
  selectedModel?: 'ltx25' | 'minimax'
  refImages?: string[]
  resolution?: number
  onApplyScene?: (data: { prompt: string; cameraMotion?: string; lighting?: string; colorPalette?: string }) => void
  onApplyCharacter?: (data: { name: string; description: string; turnaroundPrompt: string }) => void
  onApplyMovie?: (data: { title: string; shots: Array<{ order: number; title: string; seconds: number; prompt: string }> }) => void
  onShotsQueued?: (shots: Array<{ id: string; promptId?: string; title: string; prompt: string; seconds: number; state: string }>) => void
  onShotsUpdated?: (shots: Array<{ id: string; promptId?: string; title?: string; prompt?: string; seconds?: number; state: string; filename?: string; subfolder?: string; error?: string }>) => void
  onFilmCompleted?: (file: string) => void
}

export default function PromptBuilderDrawer({
  isOpen,
  onToggle,
  onWideToggle,
  initialType = 'scene',
  selectedModel = 'ltx25',
  refImages = [],
  resolution = 0,
  onApplyScene,
  onApplyCharacter,
  onApplyMovie,
  onShotsQueued,
  onShotsUpdated,
  onFilmCompleted,
}: Props) {
  const { toast } = useToast()
  const [type, setType] = useState<'scene' | 'character' | 'movie'>(initialType)
  const [input, setInput] = useState('')
  const [genre, setGenre] = useState('⚡ Auto / Director\'s Choice (AI Decides)')
  const [cameraStyle, setCameraStyle] = useState('⚡ Auto / Dynamic Camera Progression (AI Decides)')
  const [lightingStyle, setLightingStyle] = useState('⚡ Auto / Cinematic Lighting Physics (AI Decides)')
  const [durationSeconds, setDurationSeconds] = useState(10)
  const [loading, setLoading] = useState(false)
  const [elapsedSec, setElapsedSec] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<PromptBuilderResult | null>(null)
  const [usage, setUsage] = useState<{ model: string; promptTokens: number; completionTokens: number; totalTokens: number; costUsd: number } | null>(null)
  const [copied, setCopied] = useState(false)
  const [isWide, setIsWide] = useState(false)

  // Storyboard Shot-Specific Editing State
  const [editingShotIdx, setEditingShotIdx] = useState<number | null>(null)
  const [editDraft, setEditDraft] = useState<{ title: string; camera: string; seconds: number; prompt: string } | null>(null)
  const [regeneratingShotIdx, setRegeneratingShotIdx] = useState<number | null>(null)

  // 1-Click Full Movie Generation & Assembly State
  const [movieGenState, setMovieGenState] = useState<'idle' | 'saving' | 'queueing' | 'rendering' | 'assembling' | 'done' | 'error'>('idle')
  const [movieGenProgress, setMovieGenProgress] = useState<{
    stage: string
    currentShot: number
    totalShots: number
    shotStatus: Record<string, string>
    filmFile?: string
    error?: string
  }>({ stage: '', currentShot: 0, totalShots: 0, shotStatus: {} })

  // Timer interval for animated generation progress
  const timerRef = useRef<NodeJS.Timeout | null>(null)
  const moviePollRef = useRef<NodeJS.Timeout | null>(null)

  const handleToggleWide = () => {
    const nextWide = !isWide
    setIsWide(nextWide)
    onWideToggle?.(nextWide)
  }

  const handleGenerate = async () => {
    if (!input.trim()) {
      setError('Please enter your idea or scene concept first.')
      return
    }
    setLoading(true)
    setError(null)
    setResult(null)
    setUsage(null)
    setElapsedSec(0)
    setMovieGenState('idle')

    const startTime = Date.now()
    timerRef.current = setInterval(() => {
      setElapsedSec(Number(((Date.now() - startTime) / 1000).toFixed(1)))
    }, 100)

    try {
      const res = await fetch('/api/videogen/prompt-builder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type,
          input,
          genre,
          cameraStyle,
          lightingStyle,
          durationSeconds,
        }),
      })

      const data = await res.json()
      if (!res.ok || data.error) {
        throw new Error(data.error || 'Failed to generate prompt')
      }

      setResult(data.result)
      if (data.usage) {
        setUsage(data.usage)
      }
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
      if (timerRef.current) {
        clearInterval(timerRef.current)
        timerRef.current = null
      }
    }
  }

  // Edit Single Shot
  const handleStartEditShot = (idx: number) => {
    if (!result?.shots?.[idx]) return
    const s = result.shots[idx]
    setEditingShotIdx(idx)
    setEditDraft({
      title: s.title,
      camera: s.camera,
      seconds: s.seconds || 6,
      prompt: s.prompt,
    })
  }

  const handleSaveEditShot = (idx: number) => {
    if (!result?.shots || !editDraft) return
    const updatedShots = [...result.shots]
    updatedShots[idx] = {
      ...updatedShots[idx],
      title: editDraft.title,
      camera: editDraft.camera,
      seconds: editDraft.seconds,
      prompt: editDraft.prompt,
    }
    setResult({ ...result, shots: updatedShots })
    setEditingShotIdx(null)
    setEditDraft(null)
  }

  const handleCancelEditShot = () => {
    setEditingShotIdx(null)
    setEditDraft(null)
  }

  const handleDeleteShot = (idx: number) => {
    if (!result?.shots) return
    const updated = result.shots.filter((_, i) => i !== idx).map((s, i) => ({ ...s, order: i + 1 }))
    setResult({ ...result, shots: updated })
  }

  const handleAddShot = () => {
    if (!result?.shots) return
    const nextOrder = result.shots.length + 1
    const newShot = {
      order: nextOrder,
      title: `Shot #${nextOrder}: Climax / Transition`,
      camera: '35mm Prime, Dynamic Push In',
      lighting: '5600K Diffuse Daylight',
      seconds: 6,
      prompt: `At frame one, dramatic camera motion reveals character in motion with high atmospheric contrast...`,
    }
    setResult({ ...result, shots: [...result.shots, newShot] })
  }

  // Regenerate Single Shot
  const handleRegenerateSingleShot = async (idx: number) => {
    if (!result?.shots?.[idx]) return
    const targetShot = result.shots[idx]
    setRegeneratingShotIdx(idx)

    try {
      const res = await fetch('/api/videogen/prompt-builder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'scene',
          input: `Regenerate a distinct cinematic shot variation for this movie scene. Movie: "${result.title || 'Cinema'}" - Logline: "${result.logline || ''}". Shot #${targetShot.order} Title: "${targetShot.title}". Current prompt: "${targetShot.prompt}". Re-craft with fresh camera dynamics and lighting.`,
          genre,
          cameraStyle: targetShot.camera || cameraStyle,
          lightingStyle,
          durationSeconds: targetShot.seconds || 6,
        }),
      })

      const data = await res.json()
      if (!res.ok || data.error) throw new Error(data.error || 'Failed to regenerate shot')

      const newPrompt = data.result?.prompt || data.result?.shots?.[0]?.prompt
      if (newPrompt && result.shots) {
        const updatedShots = [...result.shots]
        updatedShots[idx] = {
          ...updatedShots[idx],
          prompt: newPrompt,
          title: data.result?.title || targetShot.title,
          camera: data.result?.cameraMotion || targetShot.camera,
        }
        setResult({ ...result, shots: updatedShots })
      }
    } catch (e) {
      toast.error(`Regeneration error: ${(e as Error).message}`)
    } finally {
      setRegeneratingShotIdx(null)
    }
  }

  // 1-Click Generate Full Movie
  const handleGenerateFullMovie = async () => {
    if (!result?.shots || result.shots.length === 0) return

    setMovieGenState('saving')
    setMovieGenProgress({
      stage: 'Saving storyboard & shot timeline...',
      currentShot: 0,
      totalShots: result.shots.length,
      shotStatus: {},
    })

    const sbId = `sb_${Date.now()}`
    try {
      // Step 1: Save storyboard scenes
      const scenes = result.shots.map((s, i) => ({
        id: `sc_${Date.now()}_${i}`,
        order: s.order || i + 1,
        title: s.title,
        prompt: s.prompt,
        description: s.prompt,
        seconds: s.seconds || 6,
        camera: s.camera || '',
        state: 'idle',
      }))

      const saveRes = await fetch('/api/videogen/storyboard', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: sbId,
          title: result.title || 'AI Director Master Film',
          model: selectedModel,
          referenceImages: refImages && refImages.length > 0 ? refImages : undefined,
          resolution,
          scenes,
        }),
      })
      if (!saveRes.ok) {
        const errJson = await saveRes.json().catch(() => ({}))
        throw new Error(errJson.error || `Failed to save storyboard (HTTP ${saveRes.status})`)
      }

      // Step 2: Queue all scenes on ComfyUI GPU
      setMovieGenState('queueing')
      setMovieGenProgress((p) => ({ ...p, stage: 'Queueing all shots on GPU Node...' }))

      const queueRes = await fetch('/api/videogen/storyboard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: sbId,
          model: selectedModel,
          referenceImages: refImages && refImages.length > 0 ? refImages : undefined,
        }),
      })
      const queueData = await queueRes.json()
      if (!queueRes.ok || queueData.error) {
        throw new Error(queueData.error || 'Failed to dispatch shots to GPU')
      }

      const queuedScenes = queueData.storyboard?.scenes || scenes
      onShotsQueued?.(queuedScenes)

      // Step 3: Poll GPU progress until all shots are rendered
      setMovieGenState('rendering')
      const initialStage = queueData.booting
        ? (queueData.message || '🚀 GPU node is starting up... Shots #1–5 are queued and will render automatically.')
        : `Rendering shots on GPU (0/${result.shots!.length} completed)...`
      setMovieGenProgress((p) => ({ ...p, stage: initialStage }))

      const checkRenderDone = async (): Promise<boolean> => {
        const r = await fetch(`/api/videogen/storyboard?id=${sbId}`, { cache: 'no-store' })
        if (!r.ok) return false
        const d = await r.json()
        const currentScenes = d.storyboard?.scenes || []
        const doneCount = currentScenes.filter((s: { state: string }) => s.state === 'done').length
        const errorCount = currentScenes.filter((s: { state: string }) => s.state === 'error').length
        const statuses: Record<string, string> = {}
        currentScenes.forEach((s: { id: string; state: string; error?: string; title?: string }) => {
          statuses[s.id] = s.state === 'done' ? '✓ Rendered' : s.state === 'error' ? `⚠️ Failed: ${s.error || 'GPU error'}` : s.state === 'running' ? '⏳ Rendering Frame…' : '⏱️ Queued'
        })

        setMovieGenProgress((p) => ({
          ...p,
          stage: `Rendering shots on GPU (${doneCount}/${currentScenes.length} completed)...`,
          currentShot: doneCount,
          shotStatus: statuses,
        }))

        // Live update the generation cards on the left
        onShotsUpdated?.(currentScenes)

        if (errorCount > 0 && doneCount + errorCount === currentScenes.length) {
          const firstErr = currentScenes.find((s: { error?: string }) => s.error)?.error || 'One or more shots failed on GPU'
          throw new Error(firstErr)
        }

        return doneCount === currentScenes.length && currentScenes.length > 0
      }

      // Polling loop
      await new Promise<void>((resolve, reject) => {
        const interval = setInterval(async () => {
          try {
            const allDone = await checkRenderDone()
            if (allDone) {
              clearInterval(interval)
              resolve()
            }
          } catch (err) {
            clearInterval(interval)
            reject(err)
          }
        }, 3000)
        moviePollRef.current = interval
      })

      // Step 4: Auto-assemble into Master Movie MP4
      setMovieGenState('assembling')
      setMovieGenProgress((p) => ({ ...p, stage: 'Auto-stitching shots with FFmpeg into master movie...' }))

      const assembleRes = await fetch('/api/videogen/assemble', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storyboardId: sbId }),
      })
      const assembleData = await assembleRes.json()
      if (!assembleRes.ok || assembleData.error) {
        throw new Error(assembleData.error || 'Failed to assemble master film')
      }

      const filmId = assembleData.film?.id || sbId

      // Poll assembly completion
      await new Promise<string>((resolve, reject) => {
        const aInterval = setInterval(async () => {
          try {
            const fRes = await fetch('/api/videogen/assemble', { cache: 'no-store' })
            if (!fRes.ok) return
            const fData = await fRes.json()
            const matching = (fData.films || []).find((f: { id: string; file: string; state: string }) => f.id === filmId || f.file?.includes(sbId))
            if (matching && matching.state === 'done' && matching.file) {
              clearInterval(aInterval)
              resolve(matching.file)
            }
          } catch (e) {
            clearInterval(aInterval)
            reject(e)
          }
        }, 3000)
      }).then((file) => {
        setMovieGenState('done')
        setMovieGenProgress((p) => ({
          ...p,
          stage: '🎉 Master Movie Assembly Complete!',
          filmFile: file,
        }))
        onFilmCompleted?.(file)
      })
    } catch (e) {
      setMovieGenState('error')
      setMovieGenProgress((p) => ({ ...p, error: (e as Error).message }))
    }
  }

  const copyText = (text: string) => {
    navigator.clipboard.writeText(text)
    setCopied(true)
    toast.success('Copied to clipboard!')
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <>
      {/* Floating Right Edge Trigger Pill when collapsed */}
      {!isOpen && (
        <button
          onClick={onToggle}
          title="Open AI Cinematic Prompt Generator"
          style={{
            position: 'fixed',
            right: 0,
            top: '50%',
            transform: 'translateY(-50%)',
            zIndex: 80,
            background: 'linear-gradient(135deg, #121F35, #070c14)',
            border: '1px solid rgba(232,185,74,0.4)',
            borderRight: 'none',
            borderRadius: '0.75rem 0 0 0.75rem',
            padding: '0.75rem 0.5rem',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '0.5rem',
            cursor: 'pointer',
            boxShadow: '-4px 0 20px rgba(0,0,0,0.5)',
            transition: 'all 0.2s ease',
          }}
        >
          <span style={{ fontSize: '1.1rem' }}>✨</span>
          <span
            style={{
              writingMode: 'vertical-rl',
              textOrientation: 'mixed',
              fontSize: '11px',
              fontWeight: 800,
              color: 'var(--gold, #E8B94A)',
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
            }}
          >
            AI Prompt Director
          </span>
        </button>
      )}

      {/* Right Drawer Panel */}
      <aside
        style={{
          position: 'fixed',
          top: 0,
          right: 0,
          bottom: 0,
          width: isWide ? 'min(620px, 92vw)' : 'min(440px, 92vw)',
          background: '#0a101d',
          borderLeft: '1px solid #1a2840',
          zIndex: 90,
          display: 'flex',
          flexDirection: 'column',
          boxShadow: isOpen ? '-10px 0 40px rgba(0,0,0,0.7)' : 'none',
          transform: isOpen ? 'translateX(0)' : 'translateX(105%)',
          transition: 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1), width 0.2s ease',
        }}
      >
        {/* Drawer Header */}
        <div
          style={{
            padding: '1rem 1.25rem',
            borderBottom: '1px solid #1a2840',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: 'linear-gradient(180deg, #121d33, #0a101d)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <span style={{ fontSize: '1.3rem' }}>✨</span>
            <div>
              <h2
                style={{
                  fontSize: '13px',
                  fontWeight: 800,
                  color: 'var(--gold, #E8B94A)',
                  margin: 0,
                  letterSpacing: '0.04em',
                  textTransform: 'uppercase',
                }}
              >
                AI Prompt Director
              </h2>
              <p style={{ fontSize: '9.5px', color: '#94a3b8', margin: 0 }}>
                OpenAI Photorealism Engine (Optics & Physics)
              </p>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            {/* Expand / Narrow Toggle Button */}
            <button
              onClick={handleToggleWide}
              title={isWide ? 'Narrow Drawer' : 'Expand Drawer'}
              style={{
                background: 'rgba(255,255,255,0.06)',
                border: '1px solid #1a2840',
                color: '#cbd5e1',
                borderRadius: '0.35rem',
                padding: '0.3rem 0.55rem',
                fontSize: '11px',
                fontWeight: 700,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '0.25rem',
              }}
            >
              <span>{isWide ? '⤡' : '⤢'}</span>
              <span style={{ fontSize: '10px' }}>{isWide ? 'Narrow' : 'Expand'}</span>
            </button>

            {/* Close Drawer Button */}
            <button
              onClick={onToggle}
              title="Close Panel"
              style={{
                background: 'rgba(255,255,255,0.06)',
                border: '1px solid #1a2840',
                color: '#94a3b8',
                borderRadius: '0.35rem',
                padding: '0.3rem 0.6rem',
                fontSize: '12px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              ▶
            </button>
          </div>
        </div>

        {/* Drawer Body Scroll Area */}
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '1.25rem',
            display: 'flex',
            flexDirection: 'column',
            gap: '1.25rem',
          }}
        >
          {/* Mode Selector Tabs */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, 1fr)',
              background: '#070c14',
              padding: '0.25rem',
              borderRadius: '0.5rem',
              border: '1px solid #1a2840',
            }}
          >
            {[
              { id: 'scene', label: '🎬 Scene', hint: 'Photoreal Video Prompt' },
              { id: 'character', label: '👤 Character', hint: 'Consistent Face & Bio' },
              { id: 'movie', label: '📽️ Storyboard', hint: 'Multi-Shot Full Movie' },
            ].map((tab) => {
              const active = type === tab.id
              return (
                <button
                  key={tab.id}
                  onClick={() => {
                    setType(tab.id as typeof type)
                    setResult(null)
                    setError(null)
                    setMovieGenState('idle')
                  }}
                  style={{
                    padding: '0.55rem 0.4rem',
                    borderRadius: '0.4rem',
                    background: active ? 'rgba(232,185,74,0.15)' : 'transparent',
                    color: active ? 'var(--gold, #E8B94A)' : '#94a3b8',
                    border: active ? '1px solid rgba(232,185,74,0.3)' : 'none',
                    fontWeight: 700,
                    fontSize: '11px',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                  }}
                >
                  {tab.label}
                </button>
              )
            })}
          </div>

          {/* Director Options Grid */}
          <div style={{ display: 'grid', gridTemplateColumns: isWide ? '1fr 1fr' : '1fr', gap: '0.75rem' }}>
            <div>
              <label style={{ fontSize: '9.5px', color: '#64748b', textTransform: 'uppercase', fontWeight: 800, letterSpacing: '0.06em', display: 'block', marginBottom: '0.3rem' }}>
                Genre / Mood
              </label>
              <select
                value={genre}
                onChange={(e) => setGenre(e.target.value)}
                style={{
                  width: '100%',
                  padding: '0.5rem',
                  borderRadius: '0.4rem',
                  background: '#070c14',
                  border: '1px solid #1a2840',
                  color: genre.startsWith('⚡') ? 'var(--gold, #E8B94A)' : '#F2F5FA',
                  fontWeight: 600,
                  fontSize: '11px',
                  outline: 'none',
                }}
              >
                <option value="⚡ Auto / Director's Choice (AI Decides)">⚡ Auto / Director&apos;s Choice (AI Decides)</option>
                <option value="Cinematic Drama">Cinematic Drama (35mm Arri Look)</option>
                <option value="Moody Film Noir">Moody Film Noir (High Contrast Chiaroscuro)</option>
                <option value="Cyberpunk Neon Sci-Fi">Cyberpunk Neon Sci-Fi (Anamorphic Streak)</option>
                <option value="Ethereal Fantasy">Ethereal Fantasy (Golden Hour & Mist)</option>
                <option value="Gritty Realistic Action">Gritty Realistic Action (180° Shutter)</option>
                <option value="High-End Commercial">High-End Luxury Commercial (Clean Rim)</option>
                <option value="Horror & Suspense">Horror & Suspense (Volumetric Falloff)</option>
                <option value="Historical Period Piece">Historical Period Piece (Warm Tungsten)</option>
              </select>
            </div>

            <div>
              <label style={{ fontSize: '9.5px', color: '#64748b', textTransform: 'uppercase', fontWeight: 800, letterSpacing: '0.06em', display: 'block', marginBottom: '0.3rem' }}>
                Lens / Camera
              </label>
              <select
                value={cameraStyle}
                onChange={(e) => setCameraStyle(e.target.value)}
                style={{
                  width: '100%',
                  padding: '0.5rem',
                  borderRadius: '0.4rem',
                  background: '#070c14',
                  border: '1px solid #1a2840',
                  color: cameraStyle.startsWith('⚡') ? 'var(--gold, #E8B94A)' : '#F2F5FA',
                  fontWeight: 600,
                  fontSize: '11px',
                  outline: 'none',
                }}
              >
                <option value="⚡ Auto / Dynamic Camera Progression (AI Decides)">⚡ Auto / Dynamic Camera Progression (AI Decides)</option>
                <option value="35mm Panavision Anamorphic (Wide Cinematic)">35mm Panavision Anamorphic (Wide Cinematic)</option>
                <option value="50mm Master Prime (Natural Human Eye FOV)">50mm Master Prime (Natural Human Eye FOV)</option>
                <option value="85mm Portrait Prime (Tight Intimacy, Soft Bokeh)">85mm Portrait Prime (Tight Intimacy, Soft Bokeh)</option>
                <option value="Dynamic Push In (35mm Prime)">Dynamic Push In (35mm Prime)</option>
                <option value="Slow Tracking Dolly Lateral Move">Slow Tracking Dolly Lateral Move</option>
                <option value="Orbiting Steadicam Arc">Orbiting Steadicam Arc</option>
                <option value="Low Angle Heroic Track">Low Angle Heroic Track</option>
              </select>
            </div>
          </div>

          <div>
            <label style={{ fontSize: '9.5px', color: '#64748b', textTransform: 'uppercase', fontWeight: 800, letterSpacing: '0.06em', display: 'block', marginBottom: '0.3rem' }}>
              Lighting Physics
            </label>
            <select
              value={lightingStyle}
              onChange={(e) => setLightingStyle(e.target.value)}
              style={{
                width: '100%',
                padding: '0.5rem',
                borderRadius: '0.4rem',
                background: '#070c14',
                border: '1px solid #1a2840',
                color: lightingStyle.startsWith('⚡') ? 'var(--gold, #E8B94A)' : '#F2F5FA',
                fontWeight: 600,
                fontSize: '11px',
                outline: 'none',
              }}
            >
              <option value="⚡ Auto / Cinematic Lighting Physics (AI Decides)">⚡ Auto / Cinematic Lighting Physics (AI Decides)</option>
              <option value="Natural 5600K Diffuse Daylight">Natural 5600K Diffuse Daylight (Soft Sky Fill)</option>
              <option value="Golden Hour 3200K Low Sun">Golden Hour 3200K Low Sun (Warm Edge Rim)</option>
              <option value="Moody Low-Key Chiaroscuro">Moody Low-Key Chiaroscuro (Deep Shadows)</option>
              <option value="Neon Practical Rim Lighting">Neon Practical Rim Lighting (Cool Cyan & Magenta)</option>
              <option value="Warm Tungsten Interior">Warm Tungsten Interior 2800K (Candlelight Ambient)</option>
            </select>
          </div>

          {/* Prompt Concept Textarea */}
          <div>
            <label style={{ fontSize: '9.5px', color: '#64748b', textTransform: 'uppercase', fontWeight: 800, letterSpacing: '0.06em', display: 'block', marginBottom: '0.3rem' }}>
              {type === 'scene'
                ? 'Scene or shot concept in plain words:'
                : type === 'character'
                ? 'Character persona or background concept:'
                : 'Movie premise, logline, or plot arc:'}
            </label>
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={
                type === 'scene'
                  ? 'e.g. japanese agent roaming in china and doing her work with lot of dedication'
                  : type === 'character'
                  ? 'e.g. A weary cybernetic detective in neo-tokyo with trench coat and scanner eye'
                  : 'e.g. A 4-shot mini movie about a mysterious courier delivering an ancient relic across Tokyo at midnight'
              }
              rows={4}
              style={{
                width: '100%',
                padding: '0.65rem',
                borderRadius: '0.5rem',
                background: '#070c14',
                border: '1px solid #1a2840',
                color: '#F2F5FA',
                fontSize: '12px',
                outline: 'none',
                resize: 'vertical',
                fontFamily: 'inherit',
                lineHeight: 1.5,
              }}
            />
          </div>

          {/* Error Banner */}
          {error && (
            <div
              style={{
                padding: '0.6rem 0.75rem',
                borderRadius: '0.4rem',
                background: 'rgba(248,113,113,0.1)',
                border: '1px solid #f87171',
                color: '#f87171',
                fontSize: '10.5px',
              }}
            >
              ⚠️ {error}
            </div>
          )}

          {/* Animated Progress Box during generation */}
          {loading && (
            <div
              style={{
                padding: '0.85rem 1rem',
                background: 'linear-gradient(135deg, rgba(232,185,74,0.08), rgba(18,31,53,0.9))',
                border: '1px solid rgba(232,185,74,0.4)',
                borderRadius: '0.6rem',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.5rem',
                boxShadow: '0 0 25px rgba(232,185,74,0.15)',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '11px', fontWeight: 800, color: 'var(--gold, #E8B94A)', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  <span style={{ display: 'inline-block', animation: 'spin 1.5s linear infinite' }}>✨</span>
                  AI Director Active
                </span>
                <span style={{ fontSize: '10.5px', fontFamily: 'monospace', color: '#cbd5e1', background: '#070c14', padding: '0.15rem 0.45rem', borderRadius: '0.3rem', border: '1px solid #1a2840' }}>
                  ⏱️ {elapsedSec.toFixed(1)}s
                </span>
              </div>

              {/* Progress dynamic status phase */}
              <div style={{ fontSize: '11px', color: '#F2F5FA', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'var(--gold, #E8B94A)', display: 'inline-block', boxShadow: '0 0 8px var(--gold)' }} />
                {elapsedSec < 2.0
                  ? 'Analyzing concept & narrative context...'
                  : elapsedSec < 4.5
                  ? 'Selecting 35mm optical prime lens & choreographing camera moves...'
                  : elapsedSec < 7.0
                  ? 'Engineering 5600K lighting physics & volumetric shadow falloff...'
                  : 'Synthesizing epidermal micro-textures & kinetic motion...'}
              </div>

              {/* Shimmer progress bar */}
              <div style={{ width: '100%', height: '4px', background: '#070c14', borderRadius: '2px', overflow: 'hidden' }}>
                <div
                  style={{
                    height: '100%',
                    width: `${Math.min(95, elapsedSec * 15)}%`,
                    background: 'linear-gradient(90deg, #E8B94A, #F5D77F)',
                    borderRadius: '2px',
                    transition: 'width 0.2s ease',
                    boxShadow: '0 0 10px rgba(232,185,74,0.6)',
                  }}
                />
              </div>
            </div>
          )}

          {/* Generate Button */}
          <button
            onClick={handleGenerate}
            disabled={loading || !input.trim()}
            style={{
              padding: '0.75rem 1rem',
              borderRadius: '0.5rem',
              background: loading
                ? 'linear-gradient(90deg, #121F35, #1e3357)'
                : 'linear-gradient(135deg, #E8B94A, #d4a032)',
              color: loading ? 'var(--gold, #E8B94A)' : '#05080e',
              border: loading ? '1px solid rgba(232,185,74,0.3)' : 'none',
              fontWeight: 800,
              fontSize: '12px',
              cursor: loading || !input.trim() ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '0.5rem',
              boxShadow: loading ? 'none' : '0 4px 15px rgba(232,185,74,0.3)',
              transition: 'all 0.2s ease',
            }}
          >
            {loading ? (
              <>
                <span style={{ display: 'inline-block', animation: 'spin 1s linear infinite' }}>⚡</span>
                <span>Crafting Photorealistic Prompt ({elapsedSec.toFixed(1)}s)...</span>
              </>
            ) : (
              '✨ Generate Cinematic Prompt'
            )}
          </button>

          {/* Result View */}
          {result && (
            <div
              style={{
                padding: '1rem',
                background: '#070c14',
                border: '1px solid rgba(232,185,74,0.3)',
                borderRadius: '0.6rem',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.75rem',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span
                  style={{
                    fontSize: '9.5px',
                    fontWeight: 800,
                    textTransform: 'uppercase',
                    color: 'var(--gold, #E8B94A)',
                    letterSpacing: '0.08em',
                  }}
                >
                  ✓ AI Director Result
                </span>
                <button
                  onClick={() =>
                    copyText(
                      result.prompt ||
                        result.turnaroundPrompt ||
                        (result.shots ? result.shots.map((s) => s.prompt).join('\n\n') : '')
                    )
                  }
                  style={{
                    background: 'rgba(255,255,255,0.06)',
                    border: '1px solid #1a2840',
                    color: '#cbd5e1',
                    borderRadius: '0.35rem',
                    padding: '0.2rem 0.5rem',
                    fontSize: '9.5px',
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  {copied ? '✓ Copied' : '📋 Copy'}
                </button>
              </div>

              {/* Usage & Cost Badge */}
              {usage && (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '0.35rem 0.6rem',
                    background: '#0e182e',
                    borderRadius: '0.4rem',
                    border: '1px solid #1a2840',
                    fontSize: '10px',
                    color: '#94a3b8',
                  }}
                >
                  <span>⚡ <strong>{usage.model}</strong> · {usage.totalTokens} Tokens</span>
                  <span style={{ color: 'var(--gold, #E8B94A)', fontWeight: 700 }}>Est: ${usage.costUsd.toFixed(5)}</span>
                </div>
              )}

              {/* Scene Prompt View */}
              {type === 'scene' && result.prompt && (
                <>
                  <div>
                    <h4 style={{ fontSize: '12px', fontWeight: 800, color: '#fff', margin: 0 }}>
                      {result.title || 'Cinematic Shot'}
                    </h4>
                    <p style={{ fontSize: '11px', color: '#cbd5e1', lineHeight: 1.5, margin: '0.4rem 0 0', whiteSpace: 'pre-wrap' }}>
                      {result.prompt}
                    </p>
                  </div>
                  {onApplyScene && (
                    <button
                      onClick={() => {
                        onApplyScene({
                          prompt: result.prompt!,
                          cameraMotion: result.cameraMotion,
                          lighting: result.lighting,
                          colorPalette: result.colorPalette,
                        })
                      }}
                      style={{
                        background: 'var(--gold, #E8B94A)',
                        color: '#05080e',
                        border: 'none',
                        borderRadius: '0.4rem',
                        padding: '0.5rem',
                        fontWeight: 800,
                        fontSize: '11px',
                        cursor: 'pointer',
                      }}
                    >
                      ⚡ Apply to Prompt & Settings
                    </button>
                  )}
                </>
              )}

              {/* Character View */}
              {type === 'character' && (
                <>
                  <div>
                    <h4 style={{ fontSize: '13px', fontWeight: 800, color: 'var(--gold, #E8B94A)', margin: 0 }}>
                      {result.name} ({result.tag})
                    </h4>
                    <p style={{ fontSize: '11px', color: '#cbd5e1', margin: '0.3rem 0 0', lineHeight: 1.4 }}>
                      <strong>Description:</strong> {result.description}
                    </p>
                    {result.wardrobe && (
                      <p style={{ fontSize: '10.5px', color: '#94a3b8', margin: '0.2rem 0 0' }}>
                        <strong>Wardrobe:</strong> {result.wardrobe}
                      </p>
                    )}
                    {result.voiceRecommendation && (
                      <p style={{ fontSize: '10.5px', color: 'var(--gold, #E8B94A)', margin: '0.2rem 0 0' }}>
                        🎙️ {result.voiceRecommendation}
                      </p>
                    )}
                    {result.turnaroundPrompt && (
                      <div style={{ marginTop: '0.4rem', padding: '0.5rem', background: '#0e182e', borderRadius: '0.4rem', border: '1px solid #1a2840' }}>
                        <span style={{ fontSize: '9px', color: '#64748b', fontWeight: 700, textTransform: 'uppercase' }}>
                          Turnaround Prompt:
                        </span>
                        <p style={{ fontSize: '10.5px', color: '#cbd5e1', margin: '0.2rem 0 0', lineHeight: 1.4 }}>
                          {result.turnaroundPrompt}
                        </p>
                      </div>
                    )}
                  </div>
                  {onApplyCharacter && result.name && result.description && (
                    <button
                      onClick={() => {
                        onApplyCharacter({
                          name: result.name!,
                          description: result.description!,
                          turnaroundPrompt: result.turnaroundPrompt || result.description!,
                        })
                      }}
                      style={{
                        background: 'var(--gold, #E8B94A)',
                        color: '#05080e',
                        border: 'none',
                        borderRadius: '0.4rem',
                        padding: '0.5rem',
                        fontWeight: 800,
                        fontSize: '11px',
                        cursor: 'pointer',
                      }}
                    >
                      ⚡ Apply to Character Form
                    </button>
                  )}
                </>
              )}

              {/* Movie Storyboard View with Edit / Regenerate per Shot & 1-Click Generate */}
              {type === 'movie' && result.shots && (
                <>
                  <div>
                    <h4 style={{ fontSize: '13px', fontWeight: 800, color: 'var(--gold, #E8B94A)', margin: 0 }}>
                      {result.title || 'Movie Storyboard'}
                    </h4>
                    {result.logline && <p style={{ fontSize: '10.5px', color: '#94a3b8', margin: '0.15rem 0 0.5rem' }}>{result.logline}</p>}

                    {/* 1-Click Full Movie Master Button */}
                    <div style={{ margin: '0.5rem 0 0.85rem' }}>
                      <button
                        onClick={handleGenerateFullMovie}
                        disabled={movieGenState !== 'idle' && movieGenState !== 'done' && movieGenState !== 'error'}
                        style={{
                          width: '100%',
                          padding: '0.75rem',
                          background: 'linear-gradient(135deg, #E8B94A, #f59e0b)',
                          color: '#05080e',
                          border: 'none',
                          borderRadius: '0.5rem',
                          fontWeight: 900,
                          fontSize: '12px',
                          cursor: movieGenState === 'rendering' || movieGenState === 'assembling' ? 'not-allowed' : 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: '0.5rem',
                          boxShadow: '0 4px 15px rgba(232,185,74,0.35)',
                        }}
                      >
                        <span>🎬</span>
                        <span>1-Click Generate Full Movie (All Shots + Auto-Stitch)</span>
                      </button>
                    </div>

                    {/* 1-Click Full Movie Live Generation Progress Card */}
                    {movieGenState !== 'idle' && (
                      <div
                        style={{
                          padding: '1rem',
                          background: 'linear-gradient(135deg, rgba(18,31,53,0.98), rgba(7,12,20,0.98))',
                          border: movieGenState === 'done' ? '1px solid #4ade80' : movieGenState === 'error' ? '1px solid #f87171' : '1px solid var(--gold, #E8B94A)',
                          borderRadius: '0.6rem',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '0.75rem',
                          boxShadow: '0 8px 30px rgba(0,0,0,0.5)',
                          marginBottom: '0.75rem',
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ fontSize: '11px', fontWeight: 800, color: movieGenState === 'done' ? '#4ade80' : movieGenState === 'error' ? '#f87171' : 'var(--gold, #E8B94A)', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                            {movieGenState === 'done' ? '🎉 Full Movie Rendered & Assembled!' : movieGenState === 'error' ? '⚠️ Movie Generation Error' : (
                              <>
                                <span style={{ display: 'inline-block', animation: 'spin 1.5s linear infinite' }}>⚡</span>
                                <span>1-Click Full Movie Engine Active</span>
                              </>
                            )}
                          </span>
                          <span style={{ fontSize: '10px', color: '#94a3b8', background: '#070c14', padding: '0.2rem 0.5rem', borderRadius: '0.3rem', border: '1px solid #1a2840' }}>
                            {movieGenProgress.currentShot} / {movieGenProgress.totalShots} Shots
                          </span>
                        </div>

                        <p style={{ fontSize: '11px', color: movieGenProgress.error ? '#f87171' : '#F2F5FA', margin: 0, fontWeight: 600 }}>
                          {movieGenProgress.error ? `Error: ${movieGenProgress.error}` : movieGenProgress.stage}
                        </p>

                        {/* Shimmer progress bar */}
                        {movieGenState !== 'done' && movieGenState !== 'error' && (
                          <div style={{ width: '100%', height: '5px', background: '#070c14', borderRadius: '3px', overflow: 'hidden' }}>
                            <div
                              style={{
                                height: '100%',
                                width: `${Math.max(10, (movieGenProgress.currentShot / Math.max(1, movieGenProgress.totalShots)) * 100)}%`,
                                background: 'linear-gradient(90deg, #E8B94A, #4ade80)',
                                borderRadius: '3px',
                                transition: 'width 0.4s ease',
                              }}
                            />
                          </div>
                        )}

                        {/* Shot Statuses List */}
                        {Object.keys(movieGenProgress.shotStatus).length > 0 && (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', maxHeight: '140px', overflowY: 'auto' }}>
                            {Object.entries(movieGenProgress.shotStatus).map(([id, st]) => (
                              <div key={id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10.5px', background: '#070c14', padding: '0.3rem 0.5rem', borderRadius: '0.3rem', border: '1px solid #1a2840' }}>
                                <span style={{ color: '#94a3b8' }}>Shot {id.slice(-3)}:</span>
                                <span style={{ color: st.includes('Rendered') ? '#4ade80' : st.includes('Failed') ? '#f87171' : 'var(--gold, #E8B94A)', fontWeight: 700 }}>{st}</span>
                              </div>
                            ))}
                          </div>
                        )}

                        {/* Master Movie Video Player when Done */}
                        {movieGenState === 'done' && movieGenProgress.filmFile && (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', marginTop: '0.4rem' }}>
                            <video
                              src={`/api/videogen/assemble?file=${encodeURIComponent(movieGenProgress.filmFile)}`}
                              controls
                              autoPlay
                              playsInline
                              style={{ width: '100%', borderRadius: '0.5rem', background: '#000', maxHeight: '220px' }}
                            />
                            <div style={{ display: 'flex', gap: '0.5rem' }}>
                              <a
                                href={`/api/videogen/assemble?file=${encodeURIComponent(movieGenProgress.filmFile)}&download=1`}
                                download
                                style={{
                                  flex: 1,
                                  textAlign: 'center',
                                  textDecoration: 'none',
                                  background: 'var(--gold, #E8B94A)',
                                  color: '#05080e',
                                  padding: '0.5rem',
                                  borderRadius: '0.4rem',
                                  fontSize: '11px',
                                  fontWeight: 800,
                                }}
                              >
                                ⬇️ Download Master Movie (.mp4)
                              </a>
                              <a
                                href="/movie"
                                style={{
                                  textAlign: 'center',
                                  textDecoration: 'none',
                                  background: '#0e182e',
                                  border: '1px solid #1a2840',
                                  color: '#cbd5e1',
                                  padding: '0.5rem 0.75rem',
                                  borderRadius: '0.4rem',
                                  fontSize: '11px',
                                  fontWeight: 700,
                                }}
                              >
                                🎞️ Open Studio Timeline
                              </a>
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Shot List with Edit & Regenerate controls */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginTop: '0.4rem' }}>
                      {result.shots.map((shot, idx) => {
                        const isEditing = editingShotIdx === idx
                        const isRegen = regeneratingShotIdx === idx

                        return (
                          <div
                            key={shot.order || idx}
                            style={{
                              padding: '0.75rem',
                              background: '#0e182e',
                              borderRadius: '0.5rem',
                              border: isEditing ? '1px solid var(--gold, #E8B94A)' : '1px solid #1a2840',
                              display: 'flex',
                              flexDirection: 'column',
                              gap: '0.4rem',
                            }}
                          >
                            {/* Shot Header */}
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <span style={{ fontSize: '11px', fontWeight: 800, color: 'var(--gold, #E8B94A)' }}>
                                Shot #{shot.order}: {shot.title} ({shot.seconds}s)
                              </span>
                              <span style={{ fontSize: '9.5px', color: '#94a3b8' }}>{shot.camera}</span>
                            </div>

                            {/* Inline Editing Mode */}
                            {isEditing && editDraft ? (
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '0.3rem' }}>
                                <input
                                  type="text"
                                  value={editDraft.title}
                                  onChange={(e) => setEditDraft({ ...editDraft, title: e.target.value })}
                                  placeholder="Shot Title"
                                  style={{ padding: '0.4rem', borderRadius: '0.3rem', background: '#070c14', border: '1px solid #1a2840', color: '#fff', fontSize: '11px' }}
                                />
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px', gap: '0.4rem' }}>
                                  <input
                                    type="text"
                                    value={editDraft.camera}
                                    onChange={(e) => setEditDraft({ ...editDraft, camera: e.target.value })}
                                    placeholder="Camera move / lens"
                                    style={{ padding: '0.4rem', borderRadius: '0.3rem', background: '#070c14', border: '1px solid #1a2840', color: '#fff', fontSize: '11px' }}
                                  />
                                  <input
                                    type="number"
                                    value={editDraft.seconds}
                                    onChange={(e) => setEditDraft({ ...editDraft, seconds: Number(e.target.value) })}
                                    placeholder="Sec"
                                    style={{ padding: '0.4rem', borderRadius: '0.3rem', background: '#070c14', border: '1px solid #1a2840', color: '#fff', fontSize: '11px' }}
                                  />
                                </div>
                                <textarea
                                  value={editDraft.prompt}
                                  onChange={(e) => setEditDraft({ ...editDraft, prompt: e.target.value })}
                                  rows={4}
                                  style={{ padding: '0.4rem', borderRadius: '0.3rem', background: '#070c14', border: '1px solid #1a2840', color: '#fff', fontSize: '11px', resize: 'vertical' }}
                                />
                                <div style={{ display: 'flex', gap: '0.4rem' }}>
                                  <button
                                    onClick={() => handleSaveEditShot(idx)}
                                    style={{ background: 'var(--gold, #E8B94A)', color: '#05080e', border: 'none', borderRadius: '0.3rem', padding: '0.35rem 0.65rem', fontSize: '10.5px', fontWeight: 800, cursor: 'pointer' }}
                                  >
                                    💾 Save Shot
                                  </button>
                                  <button
                                    onClick={handleCancelEditShot}
                                    style={{ background: '#070c14', border: '1px solid #1a2840', color: '#94a3b8', borderRadius: '0.3rem', padding: '0.35rem 0.65rem', fontSize: '10.5px', cursor: 'pointer' }}
                                  >
                                    Cancel
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <>
                                <p style={{ fontSize: '10.5px', color: '#cbd5e1', margin: 0, lineHeight: 1.45 }}>
                                  {shot.prompt}
                                </p>

                                {/* Per-Shot Actions Toolbar */}
                                <div style={{ display: 'flex', gap: '0.35rem', marginTop: '0.25rem', flexWrap: 'wrap' }}>
                                  <button
                                    onClick={() => handleStartEditShot(idx)}
                                    style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid #1a2840', color: '#cbd5e1', borderRadius: '0.3rem', padding: '0.2rem 0.5rem', fontSize: '9.5px', fontWeight: 700, cursor: 'pointer' }}
                                  >
                                    ✏️ Edit
                                  </button>

                                  <button
                                    onClick={() => handleRegenerateSingleShot(idx)}
                                    disabled={isRegen}
                                    style={{ background: 'rgba(232,185,74,0.1)', border: '1px solid rgba(232,185,74,0.3)', color: 'var(--gold, #E8B94A)', borderRadius: '0.3rem', padding: '0.2rem 0.5rem', fontSize: '9.5px', fontWeight: 700, cursor: isRegen ? 'not-allowed' : 'pointer' }}
                                  >
                                    {isRegen ? '⏳ Re-crafting...' : '🔄 Regenerate Shot'}
                                  </button>

                                  <button
                                    onClick={() => copyText(shot.prompt)}
                                    style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid #1a2840', color: '#94a3b8', borderRadius: '0.3rem', padding: '0.2rem 0.45rem', fontSize: '9.5px', cursor: 'pointer' }}
                                  >
                                    📋 Copy
                                  </button>

                                  <button
                                    onClick={() => handleDeleteShot(idx)}
                                    style={{ background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.25)', color: '#f87171', borderRadius: '0.3rem', padding: '0.2rem 0.45rem', fontSize: '9.5px', cursor: 'pointer', marginLeft: 'auto' }}
                                  >
                                    🗑️
                                  </button>
                                </div>
                              </>
                            )}
                          </div>
                        )
                      })}

                      {/* Add Shot Button */}
                      <button
                        onClick={handleAddShot}
                        style={{
                          background: 'rgba(255,255,255,0.04)',
                          border: '1px dashed #1a2840',
                          color: '#94a3b8',
                          borderRadius: '0.4rem',
                          padding: '0.5rem',
                          fontSize: '11px',
                          fontWeight: 700,
                          cursor: 'pointer',
                        }}
                      >
                        ➕ Add Another Shot to Storyboard
                      </button>
                    </div>
                  </div>

                  {onApplyMovie && (
                    <button
                      onClick={() => {
                        onApplyMovie({
                          title: result.title || 'Generated Movie',
                          shots: result.shots!,
                        })
                      }}
                      style={{
                        background: 'transparent',
                        color: 'var(--gold, #E8B94A)',
                        border: '1px solid rgba(232,185,74,0.4)',
                        borderRadius: '0.4rem',
                        padding: '0.5rem',
                        fontWeight: 800,
                        fontSize: '11px',
                        cursor: 'pointer',
                        marginTop: '0.5rem',
                      }}
                    >
                      ⚡ Load Storyboard into Movie Studio Timeline
                    </button>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </aside>
    </>
  )
}
