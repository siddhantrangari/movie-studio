'use client'

import { useState } from 'react'

type PromptBuilderResult = {
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
  onClose: () => void
  initialType?: 'scene' | 'character' | 'movie'
  onApplyScene?: (data: { prompt: string; cameraMotion?: string; lighting?: string; colorPalette?: string }) => void
  onApplyCharacter?: (data: { name: string; description: string; turnaroundPrompt: string }) => void
  onApplyMovie?: (data: { title: string; shots: Array<{ order: number; title: string; seconds: number; prompt: string }> }) => void
}

export default function PromptBuilderModal({
  isOpen,
  onClose,
  initialType = 'scene',
  onApplyScene,
  onApplyCharacter,
  onApplyMovie,
}: Props) {
  const [type, setType] = useState<'scene' | 'character' | 'movie'>(initialType)
  const [input, setInput] = useState('')
  const [genre, setGenre] = useState('Cinematic Drama')
  const [cameraStyle, setCameraStyle] = useState('Dynamic Push In')
  const [lightingStyle, setLightingStyle] = useState('Natural 5600K Daylight')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<PromptBuilderResult | null>(null)
  const [copied, setCopied] = useState(false)

  if (!isOpen) return null

  const handleGenerate = async () => {
    if (!input.trim()) {
      setError('Please enter your idea or concept first.')
      return
    }
    setLoading(true)
    setError(null)
    setResult(null)

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
        }),
      })

      const data = await res.json()
      if (!res.ok || data.error) {
        throw new Error(data.error || 'Failed to generate prompt')
      }

      setResult(data.result)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  const copyText = (text: string) => {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(3, 7, 14, 0.85)',
        backdropFilter: 'blur(8px)',
        zIndex: 100,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1.5rem',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        style={{
          background: '#0a101d',
          border: '1px solid #1a2840',
          borderRadius: '1rem',
          width: '100%',
          maxWidth: '720px',
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 25px 60px rgba(0,0,0,0.7)',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '1.25rem 1.5rem',
            borderBottom: '1px solid #1a2840',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: 'linear-gradient(180deg, #121d33, #0a101d)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <span style={{ fontSize: '1.5rem' }}>✨</span>
            <div>
              <h2
                style={{
                  fontSize: '15px',
                  fontWeight: 800,
                  color: 'var(--gold, #E8B94A)',
                  margin: 0,
                  letterSpacing: '0.04em',
                }}
              >
                AI CINEMATIC PROMPT GENERATOR
              </h2>
              <p style={{ fontSize: '11px', color: '#64748b', margin: '0.15rem 0 0' }}>
                OpenAI Photorealism Engine (Physical Optics, Lighting Physics & Micro-Textures)
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              color: '#94a3b8',
              fontSize: '1.25rem',
              cursor: 'pointer',
              padding: '0.25rem',
            }}
          >
            ✕
          </button>
        </div>

        {/* Tabs */}
        <div
          style={{
            display: 'flex',
            borderBottom: '1px solid #1a2840',
            background: '#070c14',
            padding: '0.5rem 1.5rem 0',
            gap: '0.75rem',
          }}
        >
          {(
            [
              { key: 'scene', label: '🎬 Scene / Shot Prompt' },
              { key: 'character', label: '👤 Character Style Sheet' },
              { key: 'movie', label: '📽️ Complete Movie Storyboard' },
            ] as const
          ).map((tab) => (
            <button
              key={tab.key}
              onClick={() => {
                setType(tab.key)
                setResult(null)
                setError(null)
              }}
              style={{
                padding: '0.6rem 1rem',
                fontSize: '12px',
                fontWeight: 700,
                color: type === tab.key ? 'var(--gold, #E8B94A)' : '#64748b',
                background: type === tab.key ? '#0e182e' : 'transparent',
                border: '1px solid',
                borderColor: type === tab.key ? '#1a2840' : 'transparent',
                borderBottom: 'none',
                borderRadius: '0.5rem 0.5rem 0 0',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Content Body */}
        <div style={{ padding: '1.5rem', overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          {/* Controls Bar */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.75rem' }}>
            <div>
              <label style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', color: '#64748b', display: 'block', marginBottom: '0.3rem' }}>
                Genre / Mood
              </label>
              <select
                value={genre}
                onChange={(e) => setGenre(e.target.value)}
                style={{ width: '100%', padding: '0.45rem 0.6rem', borderRadius: '0.4rem', background: '#070c14', border: '1px solid #1a2840', color: '#F2F5FA', fontSize: '11px', outline: 'none' }}
              >
                <option>Cinematic Drama</option>
                <option>Sci-Fi Action</option>
                <option>Wildlife Adventure</option>
                <option>Commercial Luxury</option>
                <option>Cyberpunk Noir</option>
                <option>Historical Period</option>
                <option>Horror Thriller</option>
              </select>
            </div>

            <div>
              <label style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', color: '#64748b', display: 'block', marginBottom: '0.3rem' }}>
                Lens / Camera Feel
              </label>
              <select
                value={cameraStyle}
                onChange={(e) => setCameraStyle(e.target.value)}
                style={{ width: '100%', padding: '0.45rem 0.6rem', borderRadius: '0.4rem', background: '#070c14', border: '1px solid #1a2840', color: '#F2F5FA', fontSize: '11px', outline: 'none' }}
              >
                <option>Dynamic Push In (35mm Prime)</option>
                <option>Handheld Documentary Realism</option>
                <option>Orbit Macro (85mm Portrait)</option>
                <option>Anamorphic Wide (2.39:1 Flare)</option>
                <option>Crane Down Sweeping</option>
                <option>Locked-Off Symmetric Composition</option>
              </select>
            </div>

            <div>
              <label style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', color: '#64748b', display: 'block', marginBottom: '0.3rem' }}>
                Lighting Physics
              </label>
              <select
                value={lightingStyle}
                onChange={(e) => setLightingStyle(e.target.value)}
                style={{ width: '100%', padding: '0.45rem 0.6rem', borderRadius: '0.4rem', background: '#070c14', border: '1px solid #1a2840', color: '#F2F5FA', fontSize: '11px', outline: 'none' }}
              >
                <option>Natural 5600K Diffuse Daylight</option>
                <option>Golden Hour Volumetric Backlight</option>
                <option>Moody Noir Chiaroscuro</option>
                <option>Warm 2400K Candlelight</option>
                <option>Cyberpunk Neon Reflections</option>
                <option>Studio 3-Point Softbox</option>
              </select>
            </div>
          </div>

          {/* User Input Prompt */}
          <div>
            <label style={{ fontSize: '11px', fontWeight: 700, color: '#F2F5FA', display: 'block', marginBottom: '0.4rem' }}>
              {type === 'character'
                ? 'Describe your character idea:'
                : type === 'movie'
                ? 'Enter your movie logline or scene storyline:'
                : 'Describe your scene or shot concept in plain words:'}
            </label>
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={
                type === 'character'
                  ? 'e.g. A seasoned 42-year-old female deep-sea captain with silver-streaked hair, weathered face, wearing a heavy waterproof maritime jacket.'
                  : type === 'movie'
                  ? 'e.g. A cyberpunk delivery driver finds a forbidden encrypted AI datadrive in a neon-lit rainstorm alley and is chased across high-tech rooftops.'
                  : 'e.g. A blacksmith hammering a glowing orange steel blade on an anvil in a dark rustic workshop with sparks flying.'
              }
              rows={3}
              style={{
                width: '100%',
                padding: '0.75rem',
                borderRadius: '0.6rem',
                background: '#070c14',
                border: '1px solid #1a2840',
                color: '#F2F5FA',
                fontSize: '12px',
                outline: 'none',
                resize: 'vertical',
                fontFamily: 'inherit',
              }}
            />
          </div>

          {/* Error Banner */}
          {error && (
            <div
              style={{
                padding: '0.75rem',
                borderRadius: '0.5rem',
                background: 'rgba(248,113,113,0.1)',
                border: '1px solid #f87171',
                color: '#f87171',
                fontSize: '11px',
              }}
            >
              ⚠️ {error}
            </div>
          )}

          {/* Generate Button */}
          <button
            onClick={handleGenerate}
            disabled={loading || !input.trim()}
            style={{
              padding: '0.75rem 1.25rem',
              borderRadius: '0.6rem',
              background: loading ? '#1a2840' : 'var(--gold, #E8B94A)',
              color: loading ? '#64748b' : '#05080e',
              border: 'none',
              fontWeight: 800,
              fontSize: '13px',
              cursor: loading || !input.trim() ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '0.5rem',
              transition: 'all 0.15s ease',
            }}
          >
            {loading ? '⚡ Generating Director-Grade Prompt...' : '✨ Generate Photorealistic Prompt'}
          </button>

          {/* Result View */}
          {result && (
            <div
              style={{
                marginTop: '0.5rem',
                padding: '1.25rem',
                background: '#070c14',
                border: '1px solid rgba(232,185,74,0.3)',
                borderRadius: '0.75rem',
                display: 'flex',
                flexDirection: 'column',
                gap: '1rem',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span
                  style={{
                    fontSize: '10px',
                    fontWeight: 800,
                    textTransform: 'uppercase',
                    color: 'var(--gold, #E8B94A)',
                    letterSpacing: '0.08em',
                  }}
                >
                  ✓ AI Director Output
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
                    padding: '0.25rem 0.6rem',
                    fontSize: '10px',
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  {copied ? '✓ Copied' : '📋 Copy Text'}
                </button>
              </div>

              {/* Scene Prompt View */}
              {type === 'scene' && result.prompt && (
                <>
                  <div>
                    <h4 style={{ fontSize: '13px', fontWeight: 800, color: '#fff', margin: 0 }}>
                      {result.title || 'Cinematic Shot'}
                    </h4>
                    <p style={{ fontSize: '12px', color: '#cbd5e1', lineHeight: 1.6, margin: '0.5rem 0 0', whiteSpace: 'pre-wrap' }}>
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
                        onClose()
                      }}
                      style={{
                        background: 'var(--gold, #E8B94A)',
                        color: '#05080e',
                        border: 'none',
                        borderRadius: '0.5rem',
                        padding: '0.6rem',
                        fontWeight: 800,
                        fontSize: '12px',
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
                    <h4 style={{ fontSize: '14px', fontWeight: 800, color: 'var(--gold, #E8B94A)', margin: 0 }}>
                      {result.name} ({result.tag})
                    </h4>
                    <p style={{ fontSize: '12px', color: '#cbd5e1', margin: '0.35rem 0 0', lineHeight: 1.5 }}>
                      <strong>Description:</strong> {result.description}
                    </p>
                    {result.wardrobe && (
                      <p style={{ fontSize: '11px', color: '#94a3b8', margin: '0.25rem 0 0' }}>
                        <strong>Wardrobe & Textures:</strong> {result.wardrobe}
                      </p>
                    )}
                    {result.voiceRecommendation && (
                      <p style={{ fontSize: '11px', color: 'var(--gold, #E8B94A)', margin: '0.25rem 0 0' }}>
                        🎙️ <strong>Recommended Voice:</strong> {result.voiceRecommendation}
                      </p>
                    )}
                    {result.turnaroundPrompt && (
                      <div style={{ marginTop: '0.5rem', padding: '0.6rem', background: '#0e182e', borderRadius: '0.4rem', border: '1px solid #1a2840' }}>
                        <span style={{ fontSize: '10px', color: '#64748b', fontWeight: 700, textTransform: 'uppercase' }}>
                          Turnaround Reference Prompt:
                        </span>
                        <p style={{ fontSize: '11px', color: '#cbd5e1', margin: '0.25rem 0 0', lineHeight: 1.4 }}>
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
                        onClose()
                      }}
                      style={{
                        background: 'var(--gold, #E8B94A)',
                        color: '#05080e',
                        border: 'none',
                        borderRadius: '0.5rem',
                        padding: '0.6rem',
                        fontWeight: 800,
                        fontSize: '12px',
                        cursor: 'pointer',
                      }}
                    >
                      ⚡ Apply to Character Form
                    </button>
                  )}
                </>
              )}

              {/* Movie Storyboard View */}
              {type === 'movie' && result.shots && (
                <>
                  <div>
                    <h4 style={{ fontSize: '14px', fontWeight: 800, color: 'var(--gold, #E8B94A)', margin: 0 }}>
                      {result.title || 'Movie Storyboard'}
                    </h4>
                    {result.logline && <p style={{ fontSize: '11px', color: '#94a3b8', margin: '0.2rem 0 0.75rem' }}>{result.logline}</p>}

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginTop: '0.5rem' }}>
                      {result.shots.map((shot) => (
                        <div key={shot.order} style={{ padding: '0.6rem 0.75rem', background: '#0e182e', borderRadius: '0.4rem', border: '1px solid #1a2840' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ fontSize: '11px', fontWeight: 800, color: 'var(--gold, #E8B94A)' }}>
                              Shot #{shot.order}: {shot.title} ({shot.seconds}s)
                            </span>
                            <span style={{ fontSize: '10px', color: '#64748b' }}>{shot.camera}</span>
                          </div>
                          <p style={{ fontSize: '11px', color: '#cbd5e1', margin: '0.3rem 0 0', lineHeight: 1.4 }}>
                            {shot.prompt}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                  {onApplyMovie && (
                    <button
                      onClick={() => {
                        onApplyMovie({
                          title: result.title || 'Generated Movie',
                          shots: result.shots!,
                        })
                        onClose()
                      }}
                      style={{
                        background: 'var(--gold, #E8B94A)',
                        color: '#05080e',
                        border: 'none',
                        borderRadius: '0.5rem',
                        padding: '0.6rem',
                        fontWeight: 800,
                        fontSize: '12px',
                        cursor: 'pointer',
                      }}
                    >
                      ⚡ Load Storyboard into Movie Studio
                    </button>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
