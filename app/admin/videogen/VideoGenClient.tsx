'use client'

import { useState, useEffect, useCallback } from 'react'
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

const LTX_SETUP_CMD =
  'cd /workspace && rm -f runpod-slim/ComfyUI/models/checkpoints/ltx-2.3* runpod-slim/ComfyUI/models/text_encoders/gemma_3* 2>/dev/null; ' +
  'pip install -U "huggingface_hub[cli]" && ' +
  'huggingface-cli download Lightricks/LTX-2.5 ltx-2.5-22b-dev-fp8.safetensors --repo-type model --local-dir runpod-slim/ComfyUI/models/checkpoints/ && ' +
  'huggingface-cli download Lightricks/LTX-2.5 ltxvideo-v0.9.7-vae-bf16.safetensors --repo-type model --local-dir runpod-slim/ComfyUI/models/vae/ && ' +
  'huggingface-cli download Lightricks/LTX-2.5 ltxv_spatial_upscaler_0.9.7_bf16.safetensors --repo-type model --local-dir runpod-slim/ComfyUI/models/upscale_models/ && ' +
  'huggingface-cli download Lightricks/LTX-2.5 ltxv_temporal_upscaler.safetensors --repo-type model --local-dir runpod-slim/ComfyUI/models/upscale_models/ && ' +
  'huggingface-cli download Comfy-Org/gemma-4 gemma4_e2b_it_bf16.safetensors --repo-type model --local-dir runpod-slim/ComfyUI/models/text_encoders/ && ' +
  'echo "All LTX 2.5 models ready!"'

const CLIPS = [
  {
    id: '01',
    name: 'Hero Shot',
    tag: 'Product Close-Up',
    duration: '8s',
    prompt:
      'Cinematic close-up of a luxurious gold diamond necklace rotating slowly on black velvet, warm studio lighting, macro lens detail showing every facet and reflection, 8K photorealistic quality, slow motion, luxury product photography.',
  },
  {
    id: '02',
    name: 'Model Wearing',
    tag: 'Lifestyle Shot',
    duration: '10s',
    prompt:
      'Beautiful Indian woman with elegant posture wearing a stunning gold and diamond necklace, soft natural window light catching the gems, slow pan from face to jewellery, cinematic depth of field, luxury fashion editorial style.',
  },
  {
    id: '03',
    name: 'Craftsmanship',
    tag: 'Artisan Detail',
    duration: '8s',
    prompt:
      'Skilled artisan jeweller hands with fine tools delicately setting a diamond into a gold ring, warm workshop lamp light, extreme macro close-up of stone being placed, bokeh background, cinematic slow motion, sense of precision.',
  },
  {
    id: '04',
    name: 'Unboxing',
    tag: 'Brand Experience',
    duration: '8s',
    prompt:
      'Cinematic slow-motion unboxing of a premium black jewellery box, satin ribbon untying, box opening to reveal a sparkling diamond ring on white cushion, soft ambient light with golden reflections, overhead shot transitioning to close-up.',
  },
  {
    id: '05',
    name: 'Lifestyle Moment',
    tag: 'Social Proof',
    duration: '8s',
    prompt:
      'Happy Indian woman touching her gold necklace gently, smiling with confidence, soft bokeh outdoor background with golden hour light, cinematic medium shot, natural and aspirational, luxury lifestyle feel.',
  },
  {
    id: '06',
    name: 'Collection Reveal',
    tag: 'Product Range',
    duration: '10s',
    prompt:
      'Wide aerial shot slowly descending on a full jewellery collection — necklaces, rings, earrings — laid out symmetrically on black marble, studio lighting with golden highlights on each piece, cinematic product photography, elegant and luxurious.',
  },
  {
    id: '07',
    name: 'End Card',
    tag: 'Brand Outro',
    duration: '6s',
    prompt:
      'Elegant gold jewellery set displayed on dark velvet with scattered rose petals, soft backlighting creating a halo glow, jewellery slowly rotating, cinematic fade-in from black, premium luxury atmosphere, golden hour warmth.',
  },
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


function getStatus(pod: PodData, deploying: boolean) {
  if (deploying) return 'deploying'
  if (!pod) return 'not_deployed'
  if (pod.desiredStatus === 'RUNNING' && pod.runtime) return 'running'
  if (pod.desiredStatus === 'RUNNING' && !pod.runtime) return 'starting'
  if (pod.desiredStatus === 'EXITED') return 'stopped'
  return 'unknown'
}

function StatusBadge({ status }: { status: string }) {
  const cfg: Record<string, { color: string; bg: string; border: string; label: string; pulse: boolean }> = {
    running:      { color: '#4ade80', bg: 'rgba(74,222,128,0.08)',  border: 'rgba(74,222,128,0.25)',  label: 'RUNNING',       pulse: true },
    starting:     { color: '#fbbf24', bg: 'rgba(251,191,36,0.08)', border: 'rgba(251,191,36,0.25)', label: 'STARTING…',     pulse: true },
    deploying:    { color: '#e8b94a', bg: 'rgba(232,185,74,0.08)', border: 'rgba(232,185,74,0.25)', label: 'DEPLOYING…',    pulse: true },
    stopped:      { color: '#64748b', bg: 'rgba(100,116,139,0.08)', border: 'rgba(100,116,139,0.2)', label: 'STOPPED',       pulse: false },
    not_deployed: { color: '#334155', bg: 'rgba(30,40,60,0.4)',    border: '#1a2840',               label: 'NOT DEPLOYED',  pulse: false },
    unknown:      { color: '#64748b', bg: 'rgba(100,116,139,0.08)', border: 'rgba(100,116,139,0.2)', label: 'UNKNOWN',       pulse: false },
  }
  const c = cfg[status] ?? cfg.unknown
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: '6px',
      fontSize: '10px', fontWeight: 700, padding: '0.25rem 0.65rem',
      borderRadius: '9999px', background: c.bg, border: `1px solid ${c.border}`, color: c.color,
    }}>
      {c.pulse && (
        <span style={{
          width: '5px', height: '5px', borderRadius: '50%',
          background: c.color, display: 'inline-block', position: 'relative',
          flexShrink: 0,
        }} className="ping-dot" />
      )}
      {c.label}
    </span>
  )
}

function CopyButton({ text, id, copied, onCopy }: {
  text: string; id: string; copied: string | null; onCopy: (text: string, id: string) => void
}) {
  const done = copied === id
  return (
    <button
      onClick={() => onCopy(text, id)}
      style={{
        fontSize: '11px', padding: '0.3rem 0.7rem', cursor: 'pointer', fontWeight: 700,
        borderRadius: '0.375rem', border: 'none', transition: 'all 0.2s',
        background: done ? 'rgba(74,222,128,0.15)' : 'rgba(232,185,74,0.1)',
        color: done ? '#4ade80' : 'var(--gold)',
      }}>
      {done ? '✓ Copied' : 'Copy'}
    </button>
  )
}

function PodCard({
  model, pod, deploying, actionLoading, onDeploy, onAction, copied, onCopy, blockedBy,
}: {
  model: Model
  pod: PodData
  deploying: boolean
  actionLoading: string | null
  onDeploy: (m: Model) => void
  onAction: (m: Model, a: string) => void
  copied: string | null
  onCopy: (text: string, id: string) => void
  blockedBy: string | null   // name of the other pod that must finish first
}) {
  const isLtx = model === 'ltx25'
  const title = isLtx ? 'LTX 2.5' : 'MiniMax H3'
  const vram = isLtx ? '48GB L40S / A40 / A6000' : '48–80GB A100 / A40 / A6000'
  const status = getStatus(pod, deploying)
  const podId = pod?.id
  const comfyuiUrl = podId ? `https://${podId}-8188.proxy.runpod.net` : null
  const jupyterUrl = podId ? `https://${podId}-8888.proxy.runpod.net` : null
  const gpuName = pod?.machine?.gpuDisplayName || pod?.gpuTypeId || '—'

  return (
    <div style={{
      borderRadius: '1rem', padding: '1.5rem',
      background: 'var(--navy-card)', border: '1px solid #1a2840',
      display: 'flex', flexDirection: 'column', gap: '1.25rem',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <p style={{ fontSize: '10px', color: 'var(--gold)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.35rem' }}>
            {isLtx ? '🎬' : '🤖'} {title}
          </p>
          <p style={{ fontSize: '11px', color: 'var(--grey)' }}>{vram}</p>
        </div>
        <StatusBadge status={status} />
      </div>

      {/* GPU / Cost info */}
      {pod && (
        <div style={{ display: 'flex', gap: '2rem', padding: '0.75rem', background: '#0a1220', borderRadius: '0.5rem', border: '1px solid #1a2840' }}>
          <div>
            <p style={{ fontSize: '9px', color: 'var(--grey)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>GPU</p>
            <p style={{ fontSize: '13px', color: 'var(--white)', fontWeight: 600, marginTop: '0.2rem' }}>{gpuName}</p>
          </div>
          {pod.costPerHr && (
            <div>
              <p style={{ fontSize: '9px', color: 'var(--grey)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Cost</p>
              <p style={{ fontSize: '13px', color: 'var(--gold)', fontWeight: 600, marginTop: '0.2rem' }}>${pod.costPerHr}/hr</p>
            </div>
          )}
          {podId && (
            <div>
              <p style={{ fontSize: '9px', color: 'var(--grey)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Pod ID</p>
              <p style={{ fontSize: '11px', color: '#64748b', fontFamily: 'monospace', marginTop: '0.2rem' }}>{podId.slice(0, 10)}…</p>
            </div>
          )}
        </div>
      )}

      {/* ComfyUI + Jupyter links */}
      {status === 'running' && (
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <a href={comfyuiUrl!} target="_blank" rel="noopener" style={{
            flex: 1, textAlign: 'center', padding: '0.65rem',
            background: 'var(--gold)', color: 'var(--navy)',
            borderRadius: '0.5rem', fontSize: '12px', fontWeight: 700, textDecoration: 'none',
          }}>
            Open ComfyUI ↗
          </a>
          <a href={jupyterUrl!} target="_blank" rel="noopener" style={{
            flex: 1, textAlign: 'center', padding: '0.65rem',
            border: '1px solid #1a2840', color: 'var(--grey)',
            borderRadius: '0.5rem', fontSize: '12px', fontWeight: 600, textDecoration: 'none',
          }}>
            Jupyter Terminal ↗
          </a>
        </div>
      )}

      {/* LTX model setup */}
      {isLtx && status === 'running' && (
        <div style={{ padding: '0.875rem', background: '#070c14', borderRadius: '0.5rem', border: '1px dashed #1a3050' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
            <span style={{ fontSize: '10px', color: 'var(--gold)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              Step 1 — Download Models (Jupyter Terminal)
            </span>
            <CopyButton text={LTX_SETUP_CMD} id="ltx-setup" copied={copied} onCopy={onCopy} />
          </div>
          <p style={{ fontSize: '10px', color: '#64748b', lineHeight: 1.6 }}>
            Cleans old 2.3 models → downloads 5 LTX 2.5 files (~45GB, ~15 min)
          </p>
        </div>
      )}

      {/* MiniMax auto-download note */}
      {!isLtx && (status === 'running' || status === 'starting') && (
        <div style={{ padding: '0.75rem', background: 'rgba(74,222,128,0.04)', borderRadius: '0.5rem', border: '1px solid rgba(74,222,128,0.15)' }}>
          <p style={{ fontSize: '11px', color: '#4ade80', fontWeight: 600 }}>Models auto-downloading (~42GB)</p>
          <p style={{ fontSize: '10px', color: '#64748b', marginTop: '0.2rem' }}>Check Jupyter terminal for progress — takes 15–30 min on first boot.</p>
        </div>
      )}

      {/* Divider */}
      <div style={{ borderTop: '1px solid #1a2840' }} />

      {/* Action buttons */}
      <div style={{ display: 'flex', gap: '0.5rem' }}>
        {status === 'not_deployed' && (
          blockedBy ? (
            <div style={{
              flex: 1, padding: '0.65rem', textAlign: 'center',
              background: 'rgba(100,116,139,0.06)', border: '1px dashed #334155',
              borderRadius: '0.5rem', fontSize: '12px', color: '#64748b', fontWeight: 600,
            }}>
              🔒 Finish {blockedBy} first
            </div>
          ) : (
            <button onClick={() => onDeploy(model)} style={{
              flex: 1, padding: '0.65rem', border: 'none', cursor: 'pointer',
              background: 'var(--gold)', color: 'var(--navy)',
              borderRadius: '0.5rem', fontSize: '13px', fontWeight: 700,
            }}>
              Deploy Pod
            </button>
          )
        )}

        {(status === 'deploying') && (
          <div style={{
            flex: 1, padding: '0.65rem', textAlign: 'center',
            background: 'rgba(232,185,74,0.06)', border: '1px solid rgba(232,185,74,0.2)',
            borderRadius: '0.5rem', fontSize: '12px', color: 'var(--gold)', fontWeight: 600,
          }}>
            Trying GPUs…
          </div>
        )}

        {status === 'starting' && (
          <div style={{
            flex: 1, padding: '0.65rem', textAlign: 'center',
            background: 'rgba(251,191,36,0.06)', border: '1px solid rgba(251,191,36,0.2)',
            borderRadius: '0.5rem', fontSize: '12px', color: '#fbbf24', fontWeight: 600,
          }}>
            Pod starting (check back in ~2 min)…
          </div>
        )}

        {status === 'stopped' && (
          <button onClick={() => onAction(model, 'start')} disabled={!!actionLoading} style={{
            flex: 1, padding: '0.65rem', cursor: actionLoading ? 'not-allowed' : 'pointer',
            background: 'rgba(74,222,128,0.08)', color: '#4ade80',
            border: '1px solid rgba(74,222,128,0.2)',
            borderRadius: '0.5rem', fontSize: '12px', fontWeight: 700,
          }}>
            {actionLoading === 'start' ? 'Resuming…' : 'Resume Pod'}
          </button>
        )}

        {status === 'running' && (
          <button onClick={() => onAction(model, 'stop')} disabled={!!actionLoading} style={{
            flex: 1, padding: '0.65rem', cursor: actionLoading ? 'not-allowed' : 'pointer',
            background: 'rgba(251,191,36,0.06)', color: '#fbbf24',
            border: '1px solid rgba(251,191,36,0.2)',
            borderRadius: '0.5rem', fontSize: '12px', fontWeight: 600,
          }}>
            {actionLoading === 'stop' ? 'Stopping…' : 'Stop (Keep Volume)'}
          </button>
        )}

        {pod && (
          <button onClick={() => onAction(model, 'terminate')} disabled={!!actionLoading} style={{
            padding: '0.65rem 0.875rem', cursor: actionLoading ? 'not-allowed' : 'pointer',
            background: 'rgba(248,113,113,0.06)', color: '#f87171',
            border: '1px solid rgba(248,113,113,0.15)',
            borderRadius: '0.5rem', fontSize: '12px', fontWeight: 600,
          }}>
            {actionLoading === 'terminate' ? '…' : 'Terminate'}
          </button>
        )}
      </div>
    </div>
  )
}

function JobCard({ job, onRetry }: { job: Job; onRetry: (j: Job) => void }) {
  const elapsed = Math.round((Date.now() - job.startedAt) / 1000)
  const videoUrl =
    job.filename &&
    `/api/admin/videogen/video?filename=${encodeURIComponent(job.filename)}&subfolder=${encodeURIComponent(job.subfolder ?? 'gen')}`

  return (
    <div style={{
      borderRadius: '0.75rem', padding: '1rem 1.25rem',
      background: 'var(--navy-card)', border: '1px solid #1a2840',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', marginBottom: '0.6rem' }}>
        <div style={{ minWidth: 0 }}>
          <p style={{ fontWeight: 700, fontSize: '13px', color: 'var(--white)' }}>{job.label}</p>
          <p style={{
            fontSize: '11px', color: 'var(--grey)', marginTop: '0.2rem',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '46ch',
          }}>
            {job.prompt}
          </p>
        </div>
        <StatusBadge status={
          job.state === 'done' ? 'running'
          : job.state === 'error' ? 'not_deployed'
          : 'starting'
        } />
      </div>

      {(job.state === 'queued' || job.state === 'running') && (
        <p style={{ fontSize: '11px', color: '#fbbf24' }}>
          {job.state === 'queued' ? 'Queued' : 'Generating'} · {elapsed}s elapsed · ~{job.seconds}s clip
        </p>
      )}

      {job.state === 'error' && (
        <div>
          <p style={{ fontSize: '11px', color: '#f87171', lineHeight: 1.5, marginBottom: '0.5rem' }}>{job.error}</p>
          <button onClick={() => onRetry(job)} style={{
            fontSize: '11px', padding: '0.3rem 0.7rem', cursor: 'pointer', fontWeight: 700,
            borderRadius: '0.375rem', border: '1px solid rgba(232,185,74,0.25)',
            background: 'transparent', color: 'var(--gold)',
          }}>Retry</button>
        </div>
      )}

      {job.state === 'done' && videoUrl && (
        <div>
          <video src={videoUrl} controls loop playsInline style={{
            width: '100%', borderRadius: '0.5rem', background: '#000',
            border: '1px solid #1a2840', maxHeight: '340px',
          }} />
          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.6rem' }}>
            <a href={`${videoUrl}&download=1`} download style={{
              fontSize: '11px', padding: '0.35rem 0.8rem', fontWeight: 700,
              borderRadius: '0.375rem', background: 'rgba(232,185,74,0.1)',
              color: 'var(--gold)', textDecoration: 'none',
            }}>Download MP4</a>
            <button onClick={() => onRetry(job)} style={{
              fontSize: '11px', padding: '0.35rem 0.8rem', cursor: 'pointer', fontWeight: 600,
              borderRadius: '0.375rem', border: '1px solid #1a2840',
              background: 'transparent', color: 'var(--grey)',
            }}>Regenerate</button>
          </div>
        </div>
      )}
    </div>
  )
}

export default function VideoGenClient() {
  const [pods, setPods] = useState<{ ltx: PodData; minimax: PodData }>({ ltx: null, minimax: null })
  const [initialLoading, setInitialLoading] = useState(true)
  const [deploying, setDeploying] = useState<Record<Model, boolean>>({ ltx25: false, minimax: false })
  const [actionLoading, setActionLoading] = useState<Record<Model, string | null>>({ ltx25: null, minimax: null })
  const [copied, setCopied] = useState<string | null>(null)
  const [deployError, setDeployError] = useState<Record<Model, string | null>>({ ltx25: null, minimax: null })

  // ── Generation ──
  const [jobs, setJobs] = useState<Job[]>([])
  const [genPrompt, setGenPrompt] = useState('')
  const [genSeconds, setGenSeconds] = useState(4)
  const [genRes, setGenRes] = useState(0)
  const [genError, setGenError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/videogen', { cache: 'no-store' })
      if (!res.ok) return
      const data = await res.json()
      setPods(data)
    } catch {
      // silent fail — will retry
    } finally {
      setInitialLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchStatus()
    const interval = setInterval(fetchStatus, 8000)
    return () => clearInterval(interval)
  }, [fetchStatus])

  const deploy = async (model: Model) => {
    setDeploying(prev => ({ ...prev, [model]: true }))
    setDeployError(prev => ({ ...prev, [model]: null }))
    try {
      const res = await fetch('/api/admin/videogen', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model }),
      })
      const data = await res.json()
      if (!res.ok || data.error) throw new Error(data.error)
      await fetchStatus()
    } catch (e: unknown) {
      setDeployError(prev => ({ ...prev, [model]: (e as Error).message }))
    } finally {
      setDeploying(prev => ({ ...prev, [model]: false }))
    }
  }

  const podAction = async (model: Model, action: string) => {
    if (action === 'terminate' && !window.confirm(
      `Terminate ${model === 'ltx25' ? 'LTX 2.5' : 'MiniMax H3'} pod?\n\nThis deletes all downloaded models — you'll need to re-download them next time.`
    )) return

    setActionLoading(prev => ({ ...prev, [model]: action }))
    try {
      await fetch(`/api/admin/videogen/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model }),
      })
      await fetchStatus()
    } catch {
      // silent
    } finally {
      setActionLoading(prev => ({ ...prev, [model]: null }))
    }
  }

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(id)
      setTimeout(() => setCopied(null), 2000)
    })
  }

  // Submit a clip to ComfyUI and track it as a job.
  const generate = useCallback(async (opts: { prompt: string; label: string; seconds: number; resIdx?: number }) => {
    setGenError(null)
    setSubmitting(true)
    const r = RESOLUTIONS[opts.resIdx ?? genRes]
    try {
      const res = await fetch('/api/admin/videogen/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: opts.prompt,
          seconds: opts.seconds,
          width: r.w,
          height: r.h,
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
  }, [genRes])

  // Poll only while something is actually in flight.
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
        // transient — next tick retries
      }
    }

    tick()
    const iv = setInterval(tick, 5000)
    return () => { cancelled = true; clearInterval(iv) }
  }, [pendingKey])

  const ltxStatus = getStatus(pods.ltx, deploying.ltx25)
  const minimaxStatus = getStatus(pods.minimax, deploying.minimax)
  const ltxRunning = ltxStatus === 'running'
  const minimaxRunning = minimaxStatus === 'running'
  // One-at-a-time rule: block the other pod while one is active
  const ltxActive = ['running', 'starting', 'deploying'].includes(ltxStatus)
  const minimaxActive = ['running', 'starting', 'deploying'].includes(minimaxStatus)

  return (
    <main className="grid-bg" style={{ background: 'var(--navy)', minHeight: '100vh', paddingBottom: '4rem' }}>

      {/* Top bar */}
      <header style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '1.25rem 2rem', borderBottom: '1px solid #1a2840', background: '#0a1220',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <Link href="/admin/dashboard" style={{ color: 'var(--grey)', fontSize: '12px', textDecoration: 'none' }}
            className="hover-white-transition">
            ← Dashboard
          </Link>
          <span style={{ color: '#1a2840' }}>|</span>
          <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, color: 'var(--gold)', fontSize: '1.05rem', letterSpacing: '0.02em' }}>
            🎬 Video Generation
          </span>
          <span style={{ color: '#1a2840' }}>|</span>
          <Link href="/admin/videogen/studio" style={{
            fontSize: '12px', textDecoration: 'none', fontWeight: 700, color: 'var(--gold)',
            padding: '0.3rem 0.8rem', borderRadius: '0.4rem',
            border: '1px solid rgba(232,185,74,0.25)', background: 'rgba(232,185,74,0.06)',
          }}>
            🎥 Movie Studio →
          </Link>
          <span style={{ color: '#1a2840' }}>|</span>
          <Link href="/admin/videogen/canvas" style={{
            fontSize: '12px', textDecoration: 'none', fontWeight: 700, color: 'var(--gold)',
            padding: '0.3rem 0.8rem', borderRadius: '0.4rem',
            border: '1px solid rgba(232,185,74,0.25)', background: 'rgba(232,185,74,0.06)',
          }}>
            🌌 Canvas Mode →
          </Link>
        </div>
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
          {(ltxRunning || minimaxRunning) && (
            <span style={{ fontSize: '10px', color: '#4ade80', fontWeight: 700 }}>
              ● PODS RUNNING — Stop when done to save cost
            </span>
          )}
          <button
            onClick={fetchStatus}
            style={{
              fontSize: '11px', padding: '0.35rem 0.75rem', cursor: 'pointer',
              border: '1px solid #1a2840', color: 'var(--grey)', background: 'transparent',
              borderRadius: '0.375rem', fontWeight: 600,
            }}>
            Refresh
          </button>
        </div>
      </header>

      <div style={{ padding: '2rem', maxWidth: '72rem', margin: '0 auto' }}>

        {/* Loading */}
        {initialLoading && (
          <div style={{ textAlign: 'center', padding: '4rem', color: 'var(--grey)', fontSize: '13px' }}>
            Loading pod status…
          </div>
        )}

        {!initialLoading && (
          <>
            {/* GPU Pods */}
            <div style={{ marginBottom: '2.5rem' }}>
              <p style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--grey)', marginBottom: '1rem' }}>
                GPU PODS
              </p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1rem' }}>
                <PodCard
                  model="ltx25"
                  pod={pods.ltx}
                  deploying={deploying.ltx25}
                  actionLoading={actionLoading.ltx25}
                  onDeploy={deploy}
                  onAction={podAction}
                  copied={copied}
                  onCopy={copyToClipboard}
                  blockedBy={minimaxActive ? 'MiniMax H3' : null}
                />
                <PodCard
                  model="minimax"
                  pod={pods.minimax}
                  deploying={deploying.minimax}
                  actionLoading={actionLoading.minimax}
                  onDeploy={deploy}
                  onAction={podAction}
                  copied={copied}
                  onCopy={copyToClipboard}
                  blockedBy={ltxActive ? 'LTX 2.5' : null}
                />
              </div>
              {deployError.ltx25 && (
                <p style={{ fontSize: '11px', color: '#f87171', marginTop: '0.75rem' }}>LTX 2.5: {deployError.ltx25}</p>
              )}
              {deployError.minimax && (
                <p style={{ fontSize: '11px', color: '#f87171', marginTop: '0.75rem' }}>MiniMax H3: {deployError.minimax}</p>
              )}
            </div>

            {/* ── Generate Studio ── */}
            <div style={{ marginBottom: '2.5rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                <p style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--grey)' }}>
                  GENERATE
                </p>
                {!ltxRunning && (
                  <span style={{ fontSize: '11px', color: '#fbbf24' }}>Start the LTX 2.5 pod to generate</span>
                )}
              </div>

              <div style={{
                padding: '1.25rem 1.5rem', borderRadius: '1rem',
                background: 'var(--navy-card)', border: '1px solid #1a2840',
                opacity: ltxRunning ? 1 : 0.5, pointerEvents: ltxRunning ? 'auto' : 'none',
              }}>
                <textarea
                  value={genPrompt}
                  onChange={e => setGenPrompt(e.target.value)}
                  placeholder="Describe your shot — e.g. Cinematic close-up of a gold diamond necklace rotating slowly on black velvet, warm studio lighting, macro detail, 8K photorealistic"
                  rows={3}
                  style={{
                    width: '100%', padding: '0.85rem 1rem', borderRadius: '0.6rem',
                    background: '#070c14', border: '1px solid #1a2840', color: 'var(--white)',
                    fontSize: '13px', lineHeight: 1.6, resize: 'vertical', outline: 'none',
                    fontFamily: 'var(--font-body)',
                  }}
                  onFocus={e => (e.target.style.borderColor = 'var(--gold)')}
                  onBlur={e => (e.target.style.borderColor = '#1a2840')}
                />

                <div style={{ display: 'flex', gap: '1rem', marginTop: '0.85rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                  <div>
                    <label style={{ fontSize: '10px', color: 'var(--grey)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700, display: 'block', marginBottom: '0.3rem' }}>
                      Duration
                    </label>
                    <select value={genSeconds} onChange={e => setGenSeconds(Number(e.target.value))} style={{
                      padding: '0.5rem 0.75rem', borderRadius: '0.5rem', background: '#070c14',
                      border: '1px solid #1a2840', color: 'var(--white)', fontSize: '12px', outline: 'none',
                    }}>
                      {[2, 3, 4, 5, 6, 8, 10].map(s => <option key={s} value={s}>{s} seconds</option>)}
                    </select>
                  </div>

                  <div>
                    <label style={{ fontSize: '10px', color: 'var(--grey)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700, display: 'block', marginBottom: '0.3rem' }}>
                      Resolution
                    </label>
                    <select value={genRes} onChange={e => setGenRes(Number(e.target.value))} style={{
                      padding: '0.5rem 0.75rem', borderRadius: '0.5rem', background: '#070c14',
                      border: '1px solid #1a2840', color: 'var(--white)', fontSize: '12px', outline: 'none',
                    }}>
                      {RESOLUTIONS.map((r, i) => <option key={r.label} value={i}>{r.label}</option>)}
                    </select>
                  </div>

                  <button
                    onClick={() => genPrompt.trim() && generate({ prompt: genPrompt, label: 'Custom shot', seconds: genSeconds })}
                    disabled={submitting || !genPrompt.trim()}
                    style={{
                      padding: '0.6rem 1.5rem', borderRadius: '0.5rem', border: 'none',
                      background: genPrompt.trim() ? 'var(--gold)' : '#1a2840',
                      color: genPrompt.trim() ? 'var(--navy)' : '#64748b',
                      fontSize: '13px', fontWeight: 700,
                      cursor: submitting || !genPrompt.trim() ? 'not-allowed' : 'pointer',
                      marginLeft: 'auto',
                    }}>
                    {submitting ? 'Submitting…' : 'Generate Video'}
                  </button>
                </div>

                <p style={{ fontSize: '10px', color: '#64748b', marginTop: '0.75rem' }}>
                  LTX 2.5 generates video <strong style={{ color: 'var(--grey)' }}>with native audio</strong>. A 4s clip at 704×384 takes ~55s on the RTX 3090.
                </p>

                {genError && (
                  <p style={{ fontSize: '11px', color: '#f87171', marginTop: '0.6rem' }}>{genError}</p>
                )}
              </div>

              {/* Job queue */}
              {jobs.length > 0 && (
                <div style={{ marginTop: '1rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <p style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--grey)' }}>
                      RESULTS ({jobs.length})
                    </p>
                    <button onClick={() => setJobs(js => js.filter(j => j.state !== 'done' && j.state !== 'error'))}
                      style={{
                        fontSize: '10px', padding: '0.25rem 0.6rem', cursor: 'pointer',
                        border: '1px solid #1a2840', color: 'var(--grey)', background: 'transparent',
                        borderRadius: '0.35rem', fontWeight: 600,
                      }}>
                      Clear finished
                    </button>
                  </div>
                  {jobs.map(j => (
                    <JobCard key={j.id} job={j}
                      onRetry={job => generate({ prompt: job.prompt, label: job.label, seconds: job.seconds })} />
                  ))}
                </div>
              )}
            </div>

            {/* How it works */}
            <div style={{ marginBottom: '2.5rem', padding: '1.25rem 1.5rem', background: 'var(--navy-card)', borderRadius: '1rem', border: '1px solid #1a2840' }}>
              <p style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--grey)', marginBottom: '1rem' }}>WORKFLOW</p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem' }}>
                {[
                  { step: '1', title: 'Deploy Pod', desc: 'Click Deploy — script tries GPUs until one is free', color: '#e8b94a' },
                  { step: '2', title: 'Download Models', desc: 'LTX: copy setup command → paste in Jupyter. MiniMax: auto-downloads.', color: '#60a5fa' },
                  { step: '3', title: 'Open ComfyUI', desc: 'Click "Open ComfyUI" — load an LTX 2.5 workflow template', color: '#c084fc' },
                  { step: '4', title: 'Generate & Download', desc: 'Paste prompt → Run. Download video → stitch with ffmpeg', color: '#4ade80' },
                  { step: '5', title: 'Stop Pod', desc: 'Click Stop when done. Volume preserved, no GPU charges.', color: '#f87171' },
                ].map(s => (
                  <div key={s.step} style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-start' }}>
                    <span style={{
                      width: '20px', height: '20px', borderRadius: '50%', flexShrink: 0,
                      background: `${s.color}20`, border: `1px solid ${s.color}50`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: '10px', fontWeight: 700, color: s.color,
                    }}>{s.step}</span>
                    <div>
                      <p style={{ fontSize: '12px', fontWeight: 700, color: 'var(--white)', marginBottom: '0.2rem' }}>{s.title}</p>
                      <p style={{ fontSize: '11px', color: 'var(--grey)', lineHeight: 1.5 }}>{s.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Jewellery Ad Prompts */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                <p style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--grey)' }}>
                  JEWELLERY AD PROMPTS — 7 Clips (~1 min total)
                </p>
                <button
                  onClick={() => CLIPS.forEach((c, i) => setTimeout(() => generate({
                    prompt: c.prompt,
                    label: `${c.id} · ${c.name}`,
                    seconds: parseInt(c.duration),
                  }), i * 900))}
                  disabled={!ltxRunning || submitting}
                  style={{
                    fontSize: '11px', padding: '0.4rem 0.9rem', fontWeight: 700,
                    borderRadius: '0.4rem', border: '1px solid rgba(232,185,74,0.3)',
                    background: 'rgba(232,185,74,0.08)',
                    color: ltxRunning ? 'var(--gold)' : '#64748b',
                    cursor: ltxRunning && !submitting ? 'pointer' : 'not-allowed',
                  }}>
                  Generate All 7 →
                </button>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                {CLIPS.map(clip => (
                  <div key={clip.id} style={{
                    borderRadius: '0.75rem', padding: '1.25rem 1.5rem',
                    background: 'var(--navy-card)', border: '1px solid #1a2840',
                    display: 'flex', gap: '1.5rem', alignItems: 'flex-start',
                  }}>
                    <div style={{ flexShrink: 0, textAlign: 'center', paddingTop: '0.2rem' }}>
                      <span style={{ fontFamily: 'var(--font-display)', fontSize: '1.5rem', fontWeight: 700, color: 'var(--gold)' }}>
                        {clip.id}
                      </span>
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem', flexWrap: 'wrap' }}>
                        <span style={{ fontWeight: 700, fontSize: '14px', color: 'var(--white)' }}>{clip.name}</span>
                        <span style={{ fontSize: '10px', padding: '0.15rem 0.5rem', borderRadius: '0.25rem', background: '#1a2840', color: 'var(--grey)', fontWeight: 600 }}>
                          {clip.tag}
                        </span>
                        <span style={{ fontSize: '10px', color: 'var(--grey)' }}>{clip.duration}</span>
                      </div>
                      <p style={{
                        fontSize: '12px', color: '#94a3b8', lineHeight: 1.65,
                        fontFamily: 'monospace', background: '#070c14',
                        padding: '0.75rem', borderRadius: '0.5rem',
                        border: '1px solid #1a2840', wordBreak: 'break-word',
                      }}>
                        {clip.prompt}
                      </p>
                    </div>
                    <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                      <button
                        onClick={() => generate({
                          prompt: clip.prompt,
                          label: `${clip.id} · ${clip.name}`,
                          seconds: parseInt(clip.duration),
                        })}
                        disabled={!ltxRunning || submitting}
                        style={{
                          fontSize: '11px', padding: '0.3rem 0.7rem', fontWeight: 700,
                          borderRadius: '0.375rem', border: 'none', whiteSpace: 'nowrap',
                          background: ltxRunning ? 'var(--gold)' : '#1a2840',
                          color: ltxRunning ? 'var(--navy)' : '#64748b',
                          cursor: ltxRunning && !submitting ? 'pointer' : 'not-allowed',
                        }}>
                        Generate
                      </button>
                      <CopyButton text={clip.prompt} id={`clip-${clip.id}`} copied={copied} onCopy={copyToClipboard} />
                    </div>
                  </div>
                ))}
              </div>

              {/* Stitch note */}
              <div style={{ marginTop: '1.25rem', padding: '1rem 1.25rem', background: '#0a1220', borderRadius: '0.75rem', border: '1px solid #1a2840' }}>
                <p style={{ fontSize: '12px', fontWeight: 700, color: 'var(--white)', marginBottom: '0.5rem' }}>After generating all 7 clips:</p>
                <p style={{ fontSize: '11px', color: 'var(--grey)', lineHeight: 1.7 }}>
                  1. In ComfyUI → right-click output video → Save<br />
                  2. Name them <code style={{ color: 'var(--gold)', background: '#0d1926', padding: '0.1rem 0.35rem', borderRadius: '0.25rem' }}>01_hero_shot.mp4</code>, <code style={{ color: 'var(--gold)', background: '#0d1926', padding: '0.1rem 0.35rem', borderRadius: '0.25rem' }}>02_model_wearing.mp4</code> … <code style={{ color: 'var(--gold)', background: '#0d1926', padding: '0.1rem 0.35rem', borderRadius: '0.25rem' }}>07_end_card.mp4</code><br />
                  3. Move them into <code style={{ color: 'var(--gold)', background: '#0d1926', padding: '0.1rem 0.35rem', borderRadius: '0.25rem' }}>utility-scripts/projects/runpod-video-gen/clips/</code><br />
                  4. Run <code style={{ color: 'var(--gold)', background: '#0d1926', padding: '0.1rem 0.35rem', borderRadius: '0.25rem' }}>./stitch_ad.sh</code> → outputs <code style={{ color: 'var(--gold)', background: '#0d1926', padding: '0.1rem 0.35rem', borderRadius: '0.25rem' }}>jewellery_ad_final.mp4</code> (~55s with 1s crossfades)
                </p>
              </div>
            </div>
          </>
        )}
      </div>
    </main>
  )
}
