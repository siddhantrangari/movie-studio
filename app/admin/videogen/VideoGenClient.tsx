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

const CLIPS = [
  { id: '01', name: 'Hero Shot', tag: 'Product Close-Up', duration: '8s', prompt: 'Cinematic close-up of a luxurious gold diamond necklace rotating slowly on black velvet, warm studio lighting, macro lens detail showing every facet and reflection, 8K photorealistic quality, slow motion, luxury product photography.' },
  { id: '02', name: 'Model Wearing', tag: 'Lifestyle Shot', duration: '10s', prompt: 'Beautiful Indian woman with elegant posture wearing a stunning gold and diamond necklace, soft natural window light catching the gems, slow pan from face to jewellery, cinematic depth of field, luxury fashion editorial style.' },
  { id: '03', name: 'Craftsmanship', tag: 'Artisan Detail', duration: '8s', prompt: 'Skilled artisan jeweller hands with fine tools delicately setting a diamond into a gold ring, warm workshop lamp light, extreme macro close-up of stone being placed, bokeh background, cinematic slow motion, sense of precision.' },
  { id: '04', name: 'Unboxing', tag: 'Brand Experience', duration: '8s', prompt: 'Cinematic slow-motion unboxing of a premium black jewellery box, satin ribbon untying, box opening to reveal a sparkling diamond ring on white cushion, soft ambient light with golden reflections, overhead shot transitioning to close-up.' },
  { id: '05', name: 'Lifestyle Moment', tag: 'Social Proof', duration: '8s', prompt: 'Happy Indian woman touching her gold necklace gently, smiling with confidence, soft bokeh outdoor background with golden hour light, cinematic medium shot, natural and aspirational, luxury lifestyle feel.' },
  { id: '06', name: 'Collection Reveal', tag: 'Product Range', duration: '10s', prompt: 'Wide aerial shot slowly descending on a full jewellery collection — necklaces, rings, earrings — laid out symmetrically on black marble, studio lighting with golden highlights on each piece, cinematic product photography, elegant and luxurious.' },
  { id: '07', name: 'End Card', tag: 'Brand Outro', duration: '6s', prompt: 'Elegant gold jewellery set displayed on dark velvet with scattered rose petals, soft backlighting creating a halo glow, jewellery slowly rotating, cinematic fade-in from black, premium luxury atmosphere, golden hour warmth.' }
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
}

export default function VideoGenClient() {
  const [pods, setPods] = useState<{ ltx: PodData; minimax: PodData }>({ ltx: null, minimax: null })
  const [deploying, setDeploying] = useState<{ ltx25: boolean; minimax: boolean }>({ ltx25: false, minimax: false })
  const [deployError, setDeployError] = useState<{ ltx25: string | null; minimax: string | null }>({ ltx25: null, minimax: null })
  const [actionLoading, setActionLoading] = useState<{ ltx25: string | null; minimax: string | null }>({ ltx25: null, minimax: null })

  // Custom generations state
  const [jobs, setJobs] = useState<Job[]>([])
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
  const [aspectRatio, setAspectRatio] = useState(0) // Index into RESOLUTIONS
  const [mode, setMode] = useState<'video' | 'image'>('video')

  const [submitting, setSubmitting] = useState(false)
  const [genError, setGenError] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const [initialLoading, setInitialLoading] = useState(true)

  // Modals / dropdown flags
  const [showCharModal, setShowCharModal] = useState(false)
  const [showPodDrawer, setShowPodDrawer] = useState(false)

  // Fetch status
  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/videogen', { cache: 'no-store' })
      if (!res.ok) throw new Error('Status check failed')
      const data = await res.json()
      setPods({ ltx: data.ltx || null, minimax: data.minimax || null })
      setDeployError({ ltx25: null, minimax: null })
    } catch (e) {
      // ignore
    }
  }, [])

  useEffect(() => {
    ;(async () => {
      try {
        await fetchStatus()
        const cRes = await fetch('/api/admin/videogen/characters', { cache: 'no-store' })
        if (cRes.ok) setCharacters((await cRes.json()).characters ?? [])
      } catch {
        // ignore
      } finally {
        setInitialLoading(false)
      }
    })()
  }, [fetchStatus])

  // Sync jobs from local memory / status update
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
  }, [aspectRatio, selectedCharacterId, cameraMotion, colorPalette, lighting, selectedModel])

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
    const iv = setInterval(tick, 5000)
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

  const getStatusLabel = (pod: PodData, isDeploying: boolean) => {
    if (isDeploying) return 'deploying'
    if (!pod) return 'not_deployed'
    if (pod.desiredStatus === 'RUNNING' && pod.runtime) return 'running'
    if (pod.desiredStatus === 'RUNNING' && !pod.runtime) return 'starting'
    if (pod.desiredStatus === 'EXITED') return 'stopped'
    return 'unknown'
  }

  const ltxStatus = getStatusLabel(pods.ltx, deploying.ltx25)
  const minimaxStatus = getStatusLabel(pods.minimax, deploying.minimax)
  const ltxRunning = ltxStatus === 'running'
  const minimaxRunning = minimaxStatus === 'running'

  return (
    <div style={{ display: 'flex', background: '#05080e', minHeight: '100vh', color: '#F2F5FA', fontFamily: 'var(--font-body)' }}>
      {/* ── Left Sidebar Navigation ── */}
      <aside style={{
        width: '260px', background: '#070c14', borderRight: '1px solid #1a2840',
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
            { label: 'Home', icon: '🏠', active: true, href: '/admin/videogen' },
            { label: 'My generations', icon: '🖼️', href: '#' },
            { label: 'My elements', icon: '👤', href: '#' },
            { label: 'My favorites', icon: '💖', href: '#' },
            { label: 'Community', icon: '🌐', href: '#' },
            { label: 'Academy', icon: '🎓', href: '#' }
          ].map(item => (
            <Link key={item.label} href={item.href} style={{
              display: 'flex', alignItems: 'center', gap: '0.85rem', padding: '0.65rem 0.85rem',
              borderRadius: '0.5rem', fontSize: '13px', textDecoration: 'none', fontWeight: item.active ? 700 : 500,
              background: item.active ? 'rgba(232, 185, 74, 0.08)' : 'transparent',
              color: item.active ? 'var(--gold)' : '#96A3B6',
              border: item.active ? '1px solid rgba(232, 185, 74, 0.15)' : '1px solid transparent'
            }}>
              <span>{item.icon}</span>
              {item.label}
            </Link>
          ))}
        </nav>

        {/* Contest Card */}
        <div style={{
          background: 'linear-gradient(135deg, rgba(232,185,74,0.1) 0%, rgba(14,23,38,0.6) 100%)',
          border: '1px solid rgba(232,185,74,0.25)', borderRadius: '0.75rem', padding: '1rem',
          display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: 'auto'
        }}>
          <p style={{ fontSize: '10px', color: 'var(--gold)', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
            🏆 Film Festival Contest
          </p>
          <p style={{ fontSize: '11px', color: '#96A3B6', lineHeight: 1.5 }}>
            Submit your LTX 2.5 Cinema reels to win $1,000,000 global prize!
          </p>
          <button style={{
            background: 'var(--gold)', border: 'none', borderRadius: '0.375rem', padding: '0.4rem',
            color: '#05080e', fontWeight: 700, fontSize: '11px', cursor: 'pointer', marginTop: '0.25rem'
          }}>
            Join Contest
          </button>
        </div>

        {/* Projects List */}
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
            <p style={{ fontSize: '10px', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.08em', margin: 0 }}>
              Projects
            </p>
            <button style={{ background: 'none', border: 'none', color: 'var(--gold)', fontSize: '12px', cursor: 'pointer' }}>+</button>
          </div>
          <div style={{ fontSize: '12px', color: '#96A3B6', padding: '0.25rem 0.5rem', borderLeft: '2px solid #1a2840' }}>
            📁 Cully Hill Boys
          </div>
        </div>
      </aside>

      {/* ── Main Panel Area ── */}
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>
        
        {/* Top Header Row */}
        <header style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '1rem 2.5rem', borderBottom: '1px solid #1a2840', background: '#05080e',
        }}>
          {/* Header search bar */}
          <div style={{ display: 'flex', alignItems: 'center', background: '#070c14', borderRadius: '0.5rem', border: '1px solid #1a2840', padding: '0.4rem 0.8rem', width: '280px' }}>
            <span style={{ fontSize: '12px', color: '#64748b', marginRight: '0.5rem' }}>🔍</span>
            <input type="text" placeholder="Search movies, characters, nodes..." style={{ background: 'none', border: 'none', outline: 'none', color: '#F2F5FA', fontSize: '12px', width: '100%' }} />
          </div>

          {/* Action Tools & Pod State Banner */}
          <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
            {/* Quick Pod Controller Toggle */}
            <button onClick={() => setShowPodDrawer(!showPodDrawer)} style={{
              display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '11px', fontWeight: 700,
              padding: '0.45rem 0.85rem', borderRadius: '0.5rem', border: '1px solid #1a2840',
              background: ltxRunning ? 'rgba(74,222,128,0.08)' : '#070c14',
              color: ltxRunning ? '#4ade80' : '#96A3B6', cursor: 'pointer'
            }}>
              <span>⚡</span>
              GPU Pods: {ltxRunning ? 'Active' : 'Inactive'} (Configure)
            </button>

            <Link href="/admin/videogen/studio" style={{
              fontSize: '11px', textDecoration: 'none', fontWeight: 700, color: 'var(--gold)',
              padding: '0.45rem 0.85rem', borderRadius: '0.5rem',
              border: '1px solid rgba(232,185,74,0.25)', background: 'rgba(232,185,74,0.06)',
            }}>
              🎥 Movie Studio →
            </Link>

            <Link href="/admin/videogen/canvas" style={{
              fontSize: '11px', textDecoration: 'none', fontWeight: 700, color: 'var(--gold)',
              padding: '0.45rem 0.85rem', borderRadius: '0.5rem',
              border: '1px solid rgba(232,185,74,0.25)', background: 'rgba(232,185,74,0.06)',
            }}>
              🌌 Canvas Workspace →
            </Link>

            <span style={{ color: '#1a2840' }}>|</span>
            <span style={{ fontSize: '12px', color: '#96A3B6' }}>Pricing</span>
            <span style={{ fontSize: '12px', color: '#96A3B6' }}>Assets</span>
            <div style={{ width: '28px', height: '28px', borderRadius: '50%', background: 'var(--gold)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#05080e', fontWeight: 'bold', fontSize: '11px' }}>
              SR
            </div>
          </div>
        </header>

        {/* Main Content Body */}
        <div style={{ padding: '2.5rem', maxWidth: '64rem', margin: '0 auto', width: '100%' }}>

          {/* Higgsfield Hero Layout */}
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

          {/* Higgsfield-Style Generation Controls Bar */}
          <div style={{
            background: 'rgba(14,23,38,0.75)', border: '1px solid #1a2840', borderRadius: '1.25rem',
            padding: '1.5rem', boxShadow: '0 12px 32px rgba(0,0,0,0.5)', backdropFilter: 'blur(16px)',
            marginBottom: '2.5rem'
          }}>
            
            {/* Horizontal Parameter Row */}
            <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
              {/* References Selector */}
              <div onClick={() => setShowCharModal(true)} style={{
                flex: 1, minWidth: '110px', background: '#070c14', border: '1px solid #1a2840',
                borderRadius: '0.5rem', padding: '0.5rem 0.75rem', cursor: 'pointer', display: 'flex',
                alignItems: 'center', gap: '0.5rem', justifyContent: 'space-between'
              }}>
                <div>
                  <p style={{ fontSize: '9px', color: '#64748b', textTransform: 'uppercase', margin: 0, fontWeight: 700 }}>References</p>
                  <p style={{ fontSize: '11px', color: '#F2F5FA', margin: 0, fontWeight: 600 }}>
                    {selectedCharacterId ? characters.find(c => c.id === selectedCharacterId)?.name : '0/50 Linked'}
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
                  <p style={{ fontSize: '9px', color: '#64748b', textTransform: 'uppercase', margin: 0, fontWeight: 700 }}>Film setup</p>
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
                    <option value="dolly_in" style={{ background: '#070c14' }}>Dolly In</option>
                    <option value="dolly_out" style={{ background: '#070c14' }}>Dolly Out</option>
                    <option value="zoom_in" style={{ background: '#070c14' }}>Zoom In</option>
                    <option value="zoom_out" style={{ background: '#070c14' }}>Zoom Out</option>
                    <option value="pan_left" style={{ background: '#070c14' }}>Pan Left</option>
                    <option value="pan_right" style={{ background: '#070c14' }}>Pan Right</option>
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
                  <p style={{ fontSize: '9px', color: '#64748b', textTransform: 'uppercase', margin: 0, fontWeight: 700 }}>Color palette</p>
                  <select value={colorPalette} onChange={e => setColorPalette(e.target.value)} style={{
                    background: 'none', border: 'none', color: '#F2F5FA', fontSize: '11px', fontWeight: 600, outline: 'none', padding: 0
                  }}>
                    <option value="Auto" style={{ background: '#070c14' }}>Auto</option>
                    <option value="Cinematic Warm" style={{ background: '#070c14' }}>Cinematic Warm</option>
                    <option value="Cyberpunk Neon" style={{ background: '#070c14' }}>Cyberpunk Neon</option>
                    <option value="Vintage Kodachrome" style={{ background: '#070c14' }}>Kodachrome</option>
                    <option value="Noir Black & White" style={{ background: '#070c14' }}>Noir B&W</option>
                  </select>
                </div>
              </div>

              {/* Lighting */}
              <div style={{
                flex: 1, minWidth: '110px', background: '#070c14', border: '1px solid #1a2840',
                borderRadius: '0.5rem', padding: '0.5rem 0.75rem', display: 'flex',
                alignItems: 'center', gap: '0.5rem', justifyContent: 'space-between'
              }}>
                <div>
                  <p style={{ fontSize: '9px', color: '#64748b', textTransform: 'uppercase', margin: 0, fontWeight: 700 }}>Lighting</p>
                  <select value={lighting} onChange={e => setLighting(e.target.value)} style={{
                    background: 'none', border: 'none', color: '#F2F5FA', fontSize: '11px', fontWeight: 600, outline: 'none', padding: 0
                  }}>
                    <option value="Auto" style={{ background: '#070c14' }}>Auto</option>
                    <option value="Volumetric rays" style={{ background: '#070c14' }}>Volumetric</option>
                    <option value="Golden hour sunset" style={{ background: '#070c14' }}>Golden Hour</option>
                    <option value="Soft studio portrait" style={{ background: '#070c14' }}>Soft Studio</option>
                  </select>
                </div>
              </div>
            </div>

            {/* Prompt input with layout switch */}
            <div style={{ display: 'flex', gap: '1rem', alignItems: 'stretch' }}>
              {/* Vertical Image / Video Toggle switches */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', justifyContent: 'center' }}>
                <button onClick={() => setMode('image')} style={{
                  padding: '0.5rem 0.75rem', borderRadius: '0.4rem', border: '1px solid #1a2840',
                  background: mode === 'image' ? 'var(--gold)' : '#070c14',
                  color: mode === 'image' ? '#05080e' : '#96A3B6',
                  fontSize: '11px', fontWeight: 700, cursor: 'pointer', transition: 'all 0.2s'
                }}>
                  🖼️ Image
                </button>
                <button onClick={() => setMode('video')} style={{
                  padding: '0.5rem 0.75rem', borderRadius: '0.4rem', border: '1px solid #1a2840',
                  background: mode === 'video' ? 'var(--gold)' : '#070c14',
                  color: mode === 'video' ? '#05080e' : '#96A3B6',
                  fontSize: '11px', fontWeight: 700, cursor: 'pointer', transition: 'all 0.2s'
                }}>
                  🎥 Video
                </button>
              </div>

              {/* Textarea */}
              <div style={{ flex: 1 }}>
                <textarea
                  value={genPrompt}
                  onChange={e => setGenPrompt(e.target.value)}
                  placeholder="Describe your scene - use @ to add characters & locations..."
                  rows={2}
                  style={{
                    width: '100%', padding: '0.85rem 1rem', borderRadius: '0.6rem',
                    background: '#070c14', border: '1px solid #1a2840', color: '#F2F5FA',
                    fontSize: '13px', lineHeight: 1.6, resize: 'vertical', outline: 'none',
                    height: '100%'
                  }}
                />
              </div>

              {/* Neon Generate Button */}
              <button
                onClick={() => genPrompt.trim() && generate({ prompt: genPrompt, label: 'Custom shot', seconds: genSeconds })}
                disabled={submitting || !genPrompt.trim() || !ltxRunning}
                style={{
                  width: '110px', borderRadius: '0.6rem', border: 'none',
                  background: !ltxRunning ? '#1a2840' : genPrompt.trim() ? '#d9f99d' : '#2e4a1a',
                  color: !ltxRunning ? '#64748b' : genPrompt.trim() ? '#0f172a' : '#64748b',
                  fontSize: '13px', fontWeight: 800, cursor: submitting || !genPrompt.trim() || !ltxRunning ? 'not-allowed' : 'pointer',
                  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '0.2rem',
                  boxShadow: ltxRunning && genPrompt.trim() ? '0 0 20px rgba(217, 249, 157, 0.2)' : 'none'
                }}
              >
                <span style={{ fontSize: '10px' }}>⚡ 45</span>
                <span>GENERATE</span>
              </button>
            </div>

            {/* Bottom options row */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '1rem', borderTop: '1px solid #1a2840', paddingTop: '1rem', flexWrap: 'wrap', gap: '0.75rem' }}>
              {/* Left action tags */}
              <div style={{ display: 'flex', gap: '0.4rem' }}>
                <button onClick={() => setShowCharModal(true)} style={{ background: '#070c14', border: '1px solid #1a2840', borderRadius: '0.3rem', color: '#96A3B6', fontSize: '12px', padding: '0.3rem 0.6rem', cursor: 'pointer' }}>+</button>
                <button onClick={() => setShowCharModal(true)} style={{ background: '#070c14', border: '1px solid #1a2840', borderRadius: '0.3rem', color: '#96A3B6', fontSize: '12px', padding: '0.3rem 0.6rem', cursor: 'pointer' }}>@</button>
                <span style={{ fontSize: '11px', color: '#64748b', display: 'flex', alignItems: 'center', padding: '0.3rem' }}>🔒 16:9</span>
              </div>

              {/* Settings Dropdown filters */}
              <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                {/* Model */}
                <select value={selectedModel} onChange={e => setSelectedModel(e.target.value as any)} style={{
                  background: '#070c14', border: '1px solid #1a2840', color: '#96A3B6', fontSize: '11px', padding: '0.3rem 0.6rem', borderRadius: '0.3rem', outline: 'none'
                }}>
                  <option value="ltx25">Cinema Studio 4.0 (LTX)</option>
                  <option value="minimax">MiniMax H3</option>
                </select>

                {/* Aspect Ratio */}
                <select value={aspectRatio} onChange={e => setAspectRatio(Number(e.target.value))} style={{
                  background: '#070c14', border: '1px solid #1a2840', color: '#96A3B6', fontSize: '11px', padding: '0.3rem 0.6rem', borderRadius: '0.3rem', outline: 'none'
                }}>
                  {RESOLUTIONS.map((r, idx) => <option key={r.label} value={idx}>{r.label.split('·')[1] || r.label}</option>)}
                </select>

                {/* Duration */}
                <select value={genSeconds} onChange={e => setGenSeconds(Number(e.target.value))} style={{
                  background: '#070c14', border: '1px solid #1a2840', color: '#96A3B6', fontSize: '11px', padding: '0.3rem 0.6rem', borderRadius: '0.3rem', outline: 'none'
                }}>
                  {[2, 3, 4, 5, 6, 8, 10].map(s => <option key={s} value={s}>{s}s</option>)}
                </select>

                {/* Audio */}
                <select style={{
                  background: '#070c14', border: '1px solid #1a2840', color: '#96A3B6', fontSize: '11px', padding: '0.3rem 0.6rem', borderRadius: '0.3rem', outline: 'none'
                }}>
                  <option>Audio: On</option>
                  <option>Audio: Off</option>
                </select>

                {/* Batch size */}
                <select style={{
                  background: '#070c14', border: '1px solid #1a2840', color: '#96A3B6', fontSize: '11px', padding: '0.3rem 0.6rem', borderRadius: '0.3rem', outline: 'none'
                }}>
                  <option>1 / 4</option>
                  <option>1 / 1</option>
                </select>
              </div>
            </div>

            {genError && (
              <p style={{ fontSize: '11px', color: '#f87171', marginTop: '0.6rem', margin: 0 }}>⚠️ {genError}</p>
            )}
          </div>

          {/* Active Generation Queue */}
          {jobs.length > 0 && (
            <div style={{ marginBottom: '2.5rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                <p style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#64748b', margin: 0 }}>
                  Active Generations ({jobs.length})
                </p>
                <button onClick={() => setJobs(js => js.filter(j => j.state !== 'done' && j.state !== 'error'))}
                  style={{
                    fontSize: '10px', padding: '0.25rem 0.6rem', cursor: 'pointer',
                    border: '1px solid #1a2840', color: '#96A3B6', background: 'transparent',
                    borderRadius: '0.35rem', fontWeight: 600,
                  }}>
                  Clear Finished
                </button>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                {jobs.map(j => (
                  <div key={j.id} style={{
                    borderRadius: '0.75rem', padding: '1rem 1.25rem', background: '#0e182e', border: '1px solid #1a2840',
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center'
                  }}>
                    <div>
                      <p style={{ fontWeight: 'bold', fontSize: '12px', margin: 0 }}>{j.label}</p>
                      <p style={{ fontSize: '11px', color: '#96A3B6', margin: '0.2rem 0 0' }}>{j.prompt}</p>
                    </div>
                    <div>
                      {j.state === 'done' && j.filename ? (
                        <video src={`/api/admin/videogen/video?filename=${encodeURIComponent(j.filename)}&subfolder=${encodeURIComponent(j.subfolder ?? 'gen')}`}
                          controls loop playsInline style={{ width: '120px', borderRadius: '0.3rem', background: '#000' }} />
                      ) : (
                        <span style={{ fontSize: '10px', padding: '0.2rem 0.5rem', borderRadius: '0.25rem', background: '#121f35', color: 'var(--gold)', fontWeight: 'bold' }}>
                          {j.state.toUpperCase()}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Higgsfield Open Source Project Grid Showcase */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
              <p style={{ fontSize: '11px', fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#F2F5FA', margin: 0 }}>
                Open Sourced by Higgsfield
              </p>
              <span style={{ fontSize: '11px', color: 'var(--gold)' }}>View all productions →</span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '1.5rem' }}>
              {CLIPS.map(clip => (
                <div key={clip.id} style={{
                  background: '#0e182e', border: '1px solid #1a2840', borderRadius: '1rem', overflow: 'hidden',
                  display: 'flex', flexDirection: 'column', gap: '0.75rem', position: 'relative'
                }}>
                  {/* Image/Video Container Placeholder with title overlays */}
                  <div style={{
                    height: '160px', background: '#070c14', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    position: 'relative', borderBottom: '1px solid #1a2840'
                  }}>
                    <span style={{ fontSize: '2rem', opacity: 0.25 }}>🎬</span>
                    <div style={{
                      position: 'absolute', bottom: '0.75rem', left: '0.75rem', right: '0.75rem',
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center'
                    }}>
                      <span style={{ fontSize: '10px', padding: '0.15rem 0.5rem', borderRadius: '0.25rem', background: '#121F35', color: 'var(--gold)', fontWeight: 700 }}>
                        {clip.tag}
                      </span>
                      <span style={{ fontSize: '10px', color: '#96A3B6' }}>{clip.duration}</span>
                    </div>
                  </div>

                  {/* Card Description */}
                  <div style={{ padding: '0.85rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <p style={{ fontWeight: 'bold', fontSize: '13px', margin: 0 }}>{clip.name}</p>
                      <button
                        onClick={() => generate({ prompt: clip.prompt, label: clip.name, seconds: parseInt(clip.duration) })}
                        disabled={!ltxRunning}
                        style={{
                          background: ltxRunning ? 'var(--gold)' : '#1a2840',
                          color: ltxRunning ? '#05080e' : '#64748b',
                          border: 'none', borderRadius: '0.3rem', fontSize: '10px', fontWeight: 700,
                          padding: '0.25rem 0.6rem', cursor: ltxRunning ? 'pointer' : 'not-allowed'
                        }}
                      >
                        Run Clip
                      </button>
                    </div>
                    <p style={{ fontSize: '11px', color: '#96A3B6', lineHeight: 1.5, margin: 0, height: '48px', overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical' }}>
                      {clip.prompt}
                    </p>
                  </div>

                  {/* Rating/Stats indicators */}
                  <div style={{
                    display: 'flex', justifyItems: 'center', justifyContent: 'space-between', padding: '0.65rem 0.85rem',
                    borderTop: '1px solid #1a2840', background: '#070c14', fontSize: '10px', color: '#64748b'
                  }}>
                    <span>🟢 Higgsfield Studio ✓</span>
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                      <span>👁️ {(70 + parseInt(clip.id) * 3).toFixed(1)}K</span>
                      <span>❤️ {120 + parseInt(clip.id) * 45}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </main>

      {/* ── Character Select Modal / Dialog Overlay ── */}
      {showCharModal && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(5, 8, 14, 0.75)',
          backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100
        }}>
          <div style={{
            background: '#0e182e', border: '1px solid #1a2840', borderRadius: '1rem',
            padding: '1.5rem', width: '380px', display: 'flex', flexDirection: 'column', gap: '1rem'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <p style={{ fontWeight: 'bold', fontSize: '14px', margin: 0, color: 'var(--gold)' }}>
                Select Soul ID (Character Reference)
              </p>
              <button onClick={() => setShowCharModal(false)} style={{ background: 'none', border: 'none', color: '#96A3B6', fontSize: '14px', cursor: 'pointer' }}>×</button>
            </div>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxHeight: '240px', overflowY: 'auto' }}>
              <div onClick={() => { setSelectedCharacterId(''); setShowCharModal(false) }} style={{
                padding: '0.65rem 0.85rem', borderRadius: '0.5rem', background: !selectedCharacterId ? 'rgba(232,185,74,0.08)' : '#070c14',
                border: '1px solid #1a2840', cursor: 'pointer', fontSize: '12px'
              }}>
                🚫 No character reference (Text-to-Video only)
              </div>
              {characters.map(char => (
                <div key={char.id} onClick={() => { setSelectedCharacterId(char.id); setShowCharModal(false) }} style={{
                  padding: '0.65rem 0.85rem', borderRadius: '0.5rem',
                  background: selectedCharacterId === char.id ? 'rgba(232,185,74,0.08)' : '#070c14',
                  border: '1px solid #1a2840', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.75rem'
                }}>
                  {char.imageFile ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={`/api/admin/videogen/characters?image=${encodeURIComponent(char.imageFile)}`} alt={char.name}
                      style={{ width: '28px', height: '28px', borderRadius: '50%', objectFit: 'cover' }} />
                  ) : (
                    <span style={{ fontSize: '1rem' }}>👤</span>
                  )}
                  <div>
                    <p style={{ fontWeight: 'bold', fontSize: '12px', margin: 0 }}>{char.name}</p>
                    <p style={{ fontSize: '10px', color: '#64748b', margin: 0 }}>{char.description.slice(0, 40)}…</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── GPU Drawer Overlay ── */}
      {showPodDrawer && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(5, 8, 14, 0.75)',
          backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100
        }}>
          <div style={{
            background: '#0e182e', border: '1px solid #1a2840', borderRadius: '1rem',
            padding: '1.5rem', width: '560px', display: 'flex', flexDirection: 'column', gap: '1.25rem'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <p style={{ fontWeight: 'bold', fontSize: '14px', margin: 0, color: 'var(--gold)' }}>
                ⚡ Compute Nodes (RunPod GPU Control)
              </p>
              <button onClick={() => setShowPodDrawer(false)} style={{ background: 'none', border: 'none', color: '#96A3B6', fontSize: '14px', cursor: 'pointer' }}>×</button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              {/* LTX Pod */}
              <div style={{ background: '#070c14', border: '1px solid #1a2840', borderRadius: '0.75rem', padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                <div>
                  <p style={{ fontWeight: 'bold', fontSize: '13px', margin: 0 }}>LTX 2.5 Node</p>
                  <p style={{ fontSize: '10px', color: '#64748b', margin: '0.15rem 0 0' }}>RTX L40S/A40 GPU</p>
                </div>
                <div style={{ fontSize: '11px', color: ltxRunning ? '#4ade80' : '#f87171', fontWeight: 'bold' }}>
                  Status: {ltxStatus.toUpperCase()}
                </div>
                {ltxStatus === 'not_deployed' || ltxStatus === 'stopped' ? (
                  <button onClick={() => deploy('ltx25')} disabled={deploying.ltx25} style={{
                    width: '100%', padding: '0.45rem', border: 'none', borderRadius: '0.3rem',
                    background: 'var(--gold)', color: '#05080e', fontWeight: 700, fontSize: '11px', cursor: 'pointer'
                  }}>
                    {deploying.ltx25 ? 'Deploying...' : 'Deploy Node'}
                  </button>
                ) : (
                  <button onClick={() => podAction('ltx25', 'stop')} disabled={actionLoading.ltx25 === 'stop'} style={{
                    width: '100%', padding: '0.45rem', border: 'none', borderRadius: '0.3rem',
                    background: '#ef4444', color: '#ffffff', fontWeight: 700, fontSize: '11px', cursor: 'pointer'
                  }}>
                    {actionLoading.ltx25 === 'stop' ? 'Stopping...' : 'Stop Node'}
                  </button>
                )}
              </div>

              {/* Minimax Pod */}
              <div style={{ background: '#070c14', border: '1px solid #1a2840', borderRadius: '0.75rem', padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                <div>
                  <p style={{ fontWeight: 'bold', fontSize: '13px', margin: 0 }}>MiniMax H3 Node</p>
                  <p style={{ fontSize: '10px', color: '#64748b', margin: '0.15rem 0 0' }}>80GB A100 GPU</p>
                </div>
                <div style={{ fontSize: '11px', color: minimaxRunning ? '#4ade80' : '#f87171', fontWeight: 'bold' }}>
                  Status: {minimaxStatus.toUpperCase()}
                </div>
                {minimaxStatus === 'not_deployed' || minimaxStatus === 'stopped' ? (
                  <button onClick={() => deploy('minimax')} disabled={deploying.minimax} style={{
                    width: '100%', padding: '0.45rem', border: 'none', borderRadius: '0.3rem',
                    background: 'var(--gold)', color: '#05080e', fontWeight: 700, fontSize: '11px', cursor: 'pointer'
                  }}>
                    {deploying.minimax ? 'Deploying...' : 'Deploy Node'}
                  </button>
                ) : (
                  <button onClick={() => podAction('minimax', 'stop')} disabled={actionLoading.minimax === 'stop'} style={{
                    width: '100%', padding: '0.45rem', border: 'none', borderRadius: '0.3rem',
                    background: '#ef4444', color: '#ffffff', fontWeight: 700, fontSize: '11px', cursor: 'pointer'
                  }}>
                    {actionLoading.minimax === 'stop' ? 'Stopping...' : 'Stop Node'}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
