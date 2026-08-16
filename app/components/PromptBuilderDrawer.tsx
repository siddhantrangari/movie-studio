'use client'

import { useState, useRef } from 'react'

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
  onToggle: () => void
  initialType?: 'scene' | 'character' | 'movie'
  onApplyScene?: (data: { prompt: string; cameraMotion?: string; lighting?: string; colorPalette?: string }) => void
  onApplyCharacter?: (data: { name: string; description: string; turnaroundPrompt: string }) => void
  onApplyMovie?: (data: { title: string; shots: Array<{ order: number; title: string; seconds: number; prompt: string }> }) => void
}

export default function PromptBuilderDrawer({
  isOpen,
  onToggle,
  initialType = 'scene',
  onApplyScene,
  onApplyCharacter,
  onApplyMovie,
}: Props) {
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

  // Timer interval for animated generation progress
  const timerRef = useRef<NodeJS.Timeout | null>(null)

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

  const copyText = (text: string) => {
    navigator.clipboard.writeText(text)
    setCopied(true)
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
                }}
              >
                AI PROMPT DIRECTOR
              </h2>
              <p style={{ fontSize: '10px', color: '#64748b', margin: '0.1rem 0 0' }}>
                OpenAI Photorealism Engine (Optics & Physics)
              </p>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            {/* Expand width button */}
            <button
              onClick={() => setIsWide(!isWide)}
              title={isWide ? 'Standard width' : 'Expand panel'}
              style={{
                background: 'rgba(255,255,255,0.05)',
                border: '1px solid #1a2840',
                color: '#94a3b8',
                borderRadius: '0.35rem',
                padding: '0.3rem 0.5rem',
                fontSize: '11px',
                cursor: 'pointer',
              }}
            >
              {isWide ? '⤡ Normal' : '⤢ Expand'}
            </button>

            {/* Close/Collapse button */}
            <button
              onClick={onToggle}
              title="Collapse sidebar"
              style={{
                background: 'rgba(255,255,255,0.05)',
                border: '1px solid #1a2840',
                color: '#94a3b8',
                borderRadius: '0.35rem',
                padding: '0.3rem 0.5rem',
                fontSize: '11px',
                cursor: 'pointer',
              }}
            >
              ▶
            </button>
          </div>
        </div>

        {/* Mode Selector Tabs */}
        <div
          style={{
            display: 'flex',
            borderBottom: '1px solid #1a2840',
            background: '#070c14',
            padding: '0.4rem 0.75rem 0',
            gap: '0.35rem',
          }}
        >
          {(
            [
              { key: 'scene', label: '🎬 Scene' },
              { key: 'character', label: '👤 Character' },
              { key: 'movie', label: '📽️ Storyboard' },
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
                padding: '0.45rem 0.65rem',
                fontSize: '11px',
                fontWeight: 700,
                color: type === tab.key ? 'var(--gold, #E8B94A)' : '#64748b',
                background: type === tab.key ? '#0e182e' : 'transparent',
                border: '1px solid',
                borderColor: type === tab.key ? '#1a2840' : 'transparent',
                borderBottom: 'none',
                borderRadius: '0.4rem 0.4rem 0 0',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Scrollable Form Body */}
        <div
          style={{
            padding: '1.25rem',
            overflowY: 'auto',
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            gap: '1rem',
          }}
        >
          {/* Controls Bar */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.6rem' }}>
            <div>
              <label style={{ fontSize: '9px', fontWeight: 700, textTransform: 'uppercase', color: '#64748b', display: 'block', marginBottom: '0.25rem' }}>
                Genre / Mood
              </label>
              <select
                value={genre}
                onChange={(e) => setGenre(e.target.value)}
                style={{ width: '100%', padding: '0.4rem 0.5rem', borderRadius: '0.4rem', background: '#070c14', border: '1px solid #1a2840', color: '#F2F5FA', fontSize: '11px', outline: 'none' }}
              >
                <option>⚡ Auto / Director&apos;s Choice (AI Decides)</option>
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
              <label style={{ fontSize: '9px', fontWeight: 700, textTransform: 'uppercase', color: '#64748b', display: 'block', marginBottom: '0.25rem' }}>
                Lens / Camera
              </label>
              <select
                value={cameraStyle}
                onChange={(e) => setCameraStyle(e.target.value)}
                style={{ width: '100%', padding: '0.4rem 0.5rem', borderRadius: '0.4rem', background: '#070c14', border: '1px solid #1a2840', color: '#F2F5FA', fontSize: '11px', outline: 'none' }}
              >
                <option>⚡ Auto / Dynamic Camera Progression (AI Decides)</option>
                <option>Dynamic Push In (35mm Prime)</option>
                <option>Handheld Documentary Realism</option>
                <option>Orbit Macro (85mm Portrait)</option>
                <option>Anamorphic Wide (2.39:1 Flare)</option>
                <option>Crane Down Sweeping</option>
                <option>Locked-Off Symmetric Composition</option>
              </select>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 0.8fr', gap: '0.6rem' }}>
            <div>
              <label style={{ fontSize: '9px', fontWeight: 700, textTransform: 'uppercase', color: '#64748b', display: 'block', marginBottom: '0.25rem' }}>
                Lighting Physics
              </label>
              <select
                value={lightingStyle}
                onChange={(e) => setLightingStyle(e.target.value)}
                style={{ width: '100%', padding: '0.4rem 0.5rem', borderRadius: '0.4rem', background: '#070c14', border: '1px solid #1a2840', color: '#F2F5FA', fontSize: '11px', outline: 'none' }}
              >
                <option>⚡ Auto / Cinematic Lighting Physics (AI Decides)</option>
                <option>Natural 5600K Diffuse Daylight</option>
                <option>Golden Hour Volumetric Backlight</option>
                <option>Moody Noir Chiaroscuro</option>
                <option>Warm 2400K Candlelight</option>
                <option>Cyberpunk Neon Reflections</option>
                <option>Studio 3-Point Softbox</option>
              </select>
            </div>

            <div>
              <label style={{ fontSize: '9px', fontWeight: 700, textTransform: 'uppercase', color: '#64748b', display: 'block', marginBottom: '0.25rem' }}>
                Shot Duration
              </label>
              <select
                value={durationSeconds}
                onChange={(e) => setDurationSeconds(Number(e.target.value))}
                style={{ width: '100%', padding: '0.4rem 0.5rem', borderRadius: '0.4rem', background: '#070c14', border: '1px solid #1a2840', color: '#F2F5FA', fontSize: '11px', outline: 'none' }}
              >
                <option value={10}>10s (Extended Multi-Beat)</option>
                <option value={6}>6s (Standard Shot)</option>
                <option value={4}>4s (Fast Cut)</option>
              </select>
            </div>
          </div>

          {/* User Input Prompt */}
          <div>
            <label style={{ fontSize: '10px', fontWeight: 700, color: '#F2F5FA', display: 'block', marginBottom: '0.35rem' }}>
              {type === 'character'
                ? 'Character concept / traits:'
                : type === 'movie'
                ? 'Movie logline / storyline:'
                : 'Scene or shot concept in plain words:'}
            </label>
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={
                type === 'character'
                  ? 'e.g. Japanese intelligence agent operating in Shanghai, sharp eyes, tailored dark trench coat, rain-slicked hair.'
                  : type === 'movie'
                  ? 'e.g. An agent receives an encrypted beacon in Tokyo, flees an ambush on a neon highway, and meets her handler in a hidden tea house.'
                  : 'e.g. Japanese agent sitting in a dimly lit Shanghai tea house reviewing holographic dossier data, moody window light.'
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
            <div style={{
              padding: '0.85rem 1rem',
              background: 'linear-gradient(135deg, rgba(232,185,74,0.08), rgba(18,31,53,0.9))',
              border: '1px solid rgba(232,185,74,0.4)',
              borderRadius: '0.6rem',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.5rem',
              boxShadow: '0 0 25px rgba(232,185,74,0.15)',
            }}>
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
                  ? 'Analyzing scene concept & narrative context...'
                  : elapsedSec < 4.5
                  ? 'Selecting 35mm optical prime lens & choreographing camera moves...'
                  : elapsedSec < 7.0
                  ? 'Engineering 5600K lighting physics & volumetric shadow falloff...'
                  : 'Synthesizing epidermal micro-textures & kinetic motion...'}
              </div>

              {/* Shimmer progress bar */}
              <div style={{ width: '100%', height: '4px', background: '#070c14', borderRadius: '2px', overflow: 'hidden' }}>
                <div style={{
                  height: '100%',
                  width: `${Math.min(95, elapsedSec * 15)}%`,
                  background: 'linear-gradient(90deg, #E8B94A, #F5D77F)',
                  borderRadius: '2px',
                  transition: 'width 0.2s ease',
                  boxShadow: '0 0 10px rgba(232,185,74,0.6)',
                }} />
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
                <div style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '0.35rem 0.6rem', background: '#0e182e', borderRadius: '0.4rem', border: '1px solid #1a2840',
                  fontSize: '10px', color: '#94a3b8'
                }}>
                  <span>⚡ <strong>{usage.model}</strong> · {usage.totalTokens} Tokens ({usage.promptTokens} in / {usage.completionTokens} out)</span>
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

              {/* Movie Storyboard View */}
              {type === 'movie' && result.shots && (
                <>
                  <div>
                    <h4 style={{ fontSize: '13px', fontWeight: 800, color: 'var(--gold, #E8B94A)', margin: 0 }}>
                      {result.title || 'Movie Storyboard'}
                    </h4>
                    {result.logline && <p style={{ fontSize: '10.5px', color: '#94a3b8', margin: '0.15rem 0 0.5rem' }}>{result.logline}</p>}

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', marginTop: '0.4rem' }}>
                      {result.shots.map((shot) => (
                        <div key={shot.order} style={{ padding: '0.5rem 0.6rem', background: '#0e182e', borderRadius: '0.4rem', border: '1px solid #1a2840' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ fontSize: '10.5px', fontWeight: 800, color: 'var(--gold, #E8B94A)' }}>
                              Shot #{shot.order}: {shot.title} ({shot.seconds}s)
                            </span>
                            <span style={{ fontSize: '9px', color: '#64748b' }}>{shot.camera}</span>
                          </div>
                          <p style={{ fontSize: '10.5px', color: '#cbd5e1', margin: '0.25rem 0 0', lineHeight: 1.4 }}>
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
                      ⚡ Load Storyboard into Movie Studio
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
