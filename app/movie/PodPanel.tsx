'use client'

import { useState, useEffect, useRef, useCallback } from 'react'

type LogLine = { level: 'info' | 'ok' | 'warn' | 'error' | 'done'; text: string }
type Pod = {
  id: string; status: string
  costPerHr: number; storagePerHr: number; totalPerHr: number; diskGb: number
  comfyui: string; jupyter: string
} | null

const GOLD = '#E8B94A'
const CARD = '#121F35'
const LINE = '#1a2840'
const GREY = '#96A3B6'

const LEVEL_COLOR: Record<string, string> = {
  info: '#94a3b8', ok: '#4ade80', warn: '#fbbf24', error: '#f87171', done: '#4ade80',
}

export default function PodPanel({ onPodChange }: { onPodChange?: (running: boolean) => void }) {
  const [pod, setPod] = useState<Pod>(null)
  const [account, setAccount] = useState<{ balance: number; spendPerHr: number } | null>(null)
  const [logs, setLogs] = useState<LogLine[]>([])
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState(false)
  const [tier, setTier] = useState<'standard' | 'ultra_4k'>('standard')
  const logRef = useRef<HTMLDivElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)

  const refresh = useCallback(async () => {
    const r = await fetch('/api/videogen/pod', { cache: 'no-store' })
    if (!r.ok) return
    const d = await r.json()
    setPod(d.pod)
    setAccount(d.account ?? null)
    onPodChange?.(d.pod?.status === 'RUNNING')
  }, [onPodChange])

  useEffect(() => { refresh() }, [refresh])

  // Auto-poll every 15 s when not actively streaming logs, so a stale
  // "GPU OFFLINE" after a successful boot corrects itself without a page reload.
  useEffect(() => {
    if (busy) return
    const id = setInterval(refresh, 15_000)
    return () => clearInterval(id)
  }, [busy, refresh])

  // Follow the tail as lines arrive.
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [logs])

  const run = async (action: 'up' | 'down') => {
    if (action === 'down' && !confirm('Terminate the pod? Generated clips still on it will be lost.')) return
    setBusy(true)
    setOpen(true)
    setLogs([{ level: 'info', text: action === 'up' ? `Starting ${tier === 'ultra_4k' ? 'Ultra 4K (48GB+)' : 'Standard (24GB)'} GPU…` : 'Shutting down…' }])
    try {
      const res = await fetch('/api/videogen/pod', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, tier }),
      })
      if (!res.body) throw new Error('No response stream')

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const parts = buf.split('\n')
        buf = parts.pop() ?? ''
        for (const p of parts) {
          if (!p.trim()) continue
          try {
            const line = JSON.parse(p) as LogLine
            if (line.level === 'done') { refresh(); continue }
            setLogs(prev => [...prev, line])
          } catch { /* partial frame */ }
        }
      }
      await refresh()
    } catch (e) {
      setLogs(prev => [...prev, { level: 'error', text: (e as Error).message }])
    } finally {
      setBusy(false)
    }
  }

  const running = pod?.status === 'RUNNING'
  const label = busy ? 'GPU WORKING' : running ? 'GPU READY' : 'GPU OFFLINE'
  const tone = busy ? GOLD : running ? '#4ade80' : '#f87171'

  // Close when clicking outside, the way a menu should behave.
  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      {/* Anchors to the right on desktop, but the badge sits near the left edge
          on a phone, where right-anchoring pushes the panel off-screen. */}
      <style>{`
        .ms-pop { right: 0; }
        @media (max-width: 640px) { .ms-pop { right: auto; left: 0; } }
      `}</style>
      <button onClick={() => setOpen(o => !o)}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: '6px', cursor: 'pointer',
          fontSize: '10px', fontWeight: 700, padding: '0.3rem 0.65rem', borderRadius: '9999px',
          background: `${tone}1a`, color: tone, border: `1px solid ${tone}40`,
          whiteSpace: 'nowrap',
        }}>
        <span style={{ fontSize: '11px', lineHeight: 1 }}>●</span>
        {label}
        {running && pod && <span style={{ opacity: 0.75, fontWeight: 600 }}>${pod.totalPerHr}/hr</span>}
        {account && (
          <span style={{ color: account.balance < 2 ? '#f87171' : GREY, fontWeight: 600 }}>
            ${account.balance.toFixed(2)}
          </span>
        )}
        <span style={{ opacity: 0.6, fontSize: '8px' }}>{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="ms-pop" style={{
          position: 'absolute', top: 'calc(100% + 8px)', zIndex: 60,
          width: 'min(420px, calc(100vw - 2rem))',
          background: CARD, border: `1px solid ${LINE}`, borderRadius: '0.75rem',
          padding: '1rem', boxShadow: '0 18px 50px rgba(0,0,0,0.55)',
        }}>
          {pod && running ? (
            <div style={{ fontSize: '11px', color: GREY, marginBottom: '0.75rem', lineHeight: 1.7 }}>
              <div title={`GPU $${pod.costPerHr}/hr + ${pod.diskGb}GB storage $${pod.storagePerHr}/hr`}>
                <strong style={{ color: '#F2F5FA' }}>${pod.totalPerHr}/hr</strong> billing now
                <span style={{ color: '#64748b' }}> · GPU ${pod.costPerHr} + disk ${pod.storagePerHr}</span>
              </div>
              <a href={pod.comfyui} target="_blank" rel="noopener" style={{ color: GOLD, fontWeight: 600 }}>Open ComfyUI ↗</a>
              {' · '}
              <a href={pod.jupyter} target="_blank" rel="noopener" style={{ color: GREY }}>Jupyter ↗</a>
            </div>
          ) : (
            <p style={{ fontSize: '11px', color: GREY, lineHeight: 1.6, marginBottom: '0.75rem' }}>
              {busy ? 'Working — you can close this, it keeps running.'
                    : 'Nothing is billing. Starting takes about 5 minutes, mostly downloading models.'}
            </p>
          )}

          {account && (
            <div style={{
              display: 'flex', justifyContent: 'space-between', fontSize: '11px',
              padding: '0.5rem 0.6rem', marginBottom: '0.75rem', borderRadius: '0.4rem',
              background: '#070c14', border: `1px solid ${LINE}`,
            }}>
              <span style={{ color: GREY }}>RunPod balance</span>
              <span style={{ color: account.balance < 2 ? '#f87171' : '#F2F5FA', fontWeight: 700 }}>
                ${account.balance.toFixed(2)}
                {(() => {
                  const rate = pod && running && pod.totalPerHr > 0
                    ? pod.totalPerHr
                    : (account.spendPerHr > 0.1 ? account.spendPerHr : (pod?.totalPerHr || 0.69))
                  if (!rate || rate <= 0) return null
                  const hoursLeft = account.balance / rate
                  return (
                    <span style={{ color: GREY, fontWeight: 500 }}>
                      {' '}· {hoursLeft < 1 ? `${Math.round(hoursLeft * 60)}m` : `${hoursLeft.toFixed(1)}h`} GPU left
                    </span>
                  )
                })()}
              </span>
            </div>
          )}

          {!running && (
            <div style={{
              display: 'flex', flexDirection: 'column', gap: '0.4rem', padding: '0.5rem 0.6rem',
              marginBottom: '0.75rem', borderRadius: '0.4rem', background: '#070c14', border: `1px solid ${LINE}`,
            }}>
              <span style={{ fontSize: '9.5px', color: '#94a3b8', fontWeight: 700, textTransform: 'uppercase' }}>GPU Tier:</span>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '11px', cursor: 'pointer', color: tier === 'standard' ? GOLD : '#cbd5e1' }}>
                <input type="radio" name="studioGpuTier" checked={tier === 'standard'} onChange={() => setTier('standard')} />
                <span><strong>Standard (24GB)</strong> · RTX 3090/4090 (720p/1080p)</span>
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '11px', cursor: 'pointer', color: tier === 'ultra_4k' ? GOLD : '#cbd5e1' }}>
                <input type="radio" name="studioGpuTier" checked={tier === 'ultra_4k'} onChange={() => setTier('ultra_4k')} />
                <span><strong>Ultra 4K (48GB/80GB)</strong> · A6000/A40/L40S/A100 (4K direct)</span>
              </label>
            </div>
          )}

          <button onClick={() => run(running ? 'down' : 'up')} disabled={busy}
            style={{
              width: '100%', padding: '0.6rem', borderRadius: '0.5rem', border: 'none',
              background: busy ? LINE : running ? 'rgba(248,113,113,0.12)' : GOLD,
              color: busy ? '#64748b' : running ? '#f87171' : '#0A1220',
              fontSize: '12px', fontWeight: 700, cursor: busy ? 'not-allowed' : 'pointer',
            }}>
            {busy ? 'Working…' : running ? 'Shut down GPU' : `Start ${tier === 'ultra_4k' ? 'Ultra 4K (48GB+)' : 'Standard (24GB)'} GPU`}
          </button>

          {logs.length > 0 && (
            <div ref={logRef} style={{
              marginTop: '0.75rem', maxHeight: '240px', overflowY: 'auto',
              background: '#070c14', border: `1px solid ${LINE}`, borderRadius: '0.5rem',
              padding: '0.6rem 0.7rem', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
              fontSize: '10.5px', lineHeight: 1.65, overflowWrap: 'anywhere',
            }}>
              {logs.map((l, i) => (
                <div key={i} style={{ color: LEVEL_COLOR[l.level] ?? GREY, whiteSpace: 'pre-wrap' }}>{l.text}</div>
              ))}
              {busy && <div style={{ color: GOLD }}>▍</div>}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
