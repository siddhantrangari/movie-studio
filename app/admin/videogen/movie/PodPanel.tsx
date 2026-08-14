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
  const [logs, setLogs] = useState<LogLine[]>([])
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState(false)
  const logRef = useRef<HTMLDivElement>(null)

  const refresh = useCallback(async () => {
    const r = await fetch('/api/admin/videogen/pod', { cache: 'no-store' })
    if (!r.ok) return
    const d = await r.json()
    setPod(d.pod)
    onPodChange?.(d.pod?.status === 'RUNNING')
  }, [onPodChange])

  useEffect(() => { refresh() }, [refresh])

  // Follow the tail as lines arrive.
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [logs])

  const run = async (action: 'up' | 'down') => {
    if (action === 'down' && !confirm('Terminate the pod? Generated clips still on it will be lost.')) return
    setBusy(true)
    setOpen(true)
    setLogs([{ level: 'info', text: action === 'up' ? 'Starting GPU…' : 'Shutting down…' }])
    try {
      const res = await fetch('/api/admin/videogen/pod', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
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

  return (
    <div style={{ background: CARD, border: `1px solid ${LINE}`, borderRadius: '1rem', padding: '1.1rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.85rem' }}>
        <span style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.1em', color: GREY, textTransform: 'uppercase' }}>
          GPU
        </span>
        <span style={{
          fontSize: '10px', fontWeight: 700, padding: '0.2rem 0.55rem', borderRadius: '9999px',
          background: running ? 'rgba(74,222,128,0.1)' : 'rgba(100,116,139,0.12)',
          color: running ? '#4ade80' : '#64748b',
          border: `1px solid ${running ? 'rgba(74,222,128,0.25)' : LINE}`,
        }}>
          {busy ? 'WORKING' : running ? 'READY' : 'OFF'}
        </span>
      </div>

      {pod && running && (
        <div style={{ fontSize: '11px', color: GREY, marginBottom: '0.75rem', lineHeight: 1.7 }}>
          <div title={`GPU $${pod.costPerHr}/hr + ${pod.diskGb}GB storage $${pod.storagePerHr}/hr`}>
            <strong style={{ color: '#F2F5FA' }}>${pod.totalPerHr}/hr</strong> billing now
            <span style={{ color: '#64748b' }}> · GPU ${pod.costPerHr} + disk ${pod.storagePerHr}</span>
          </div>
          <a href={pod.comfyui} target="_blank" rel="noopener" style={{ color: GOLD, fontWeight: 600 }}>Open ComfyUI ↗</a>
          {' · '}
          <a href={pod.jupyter} target="_blank" rel="noopener" style={{ color: GREY }}>Jupyter ↗</a>
        </div>
      )}

      {!running && !busy && (
        <p style={{ fontSize: '11px', color: GREY, lineHeight: 1.6, marginBottom: '0.75rem' }}>
          Nothing is billing. Starting takes about 5 minutes — most of it downloading models.
        </p>
      )}

      <div style={{ display: 'flex', gap: '0.5rem' }}>
        <button onClick={() => run(running ? 'down' : 'up')} disabled={busy}
          style={{
            flex: 1, padding: '0.6rem', borderRadius: '0.5rem', border: 'none',
            background: busy ? LINE : running ? 'rgba(248,113,113,0.12)' : GOLD,
            color: busy ? '#64748b' : running ? '#f87171' : '#0A1220',
            fontSize: '12px', fontWeight: 700, cursor: busy ? 'not-allowed' : 'pointer',
          }}>
          {busy ? 'Working…' : running ? 'Shut down GPU' : 'Start GPU'}
        </button>
        {logs.length > 0 && (
          <button onClick={() => setOpen(o => !o)}
            style={{
              padding: '0.6rem 0.8rem', borderRadius: '0.5rem', cursor: 'pointer',
              border: `1px solid ${LINE}`, background: 'transparent', color: GREY, fontSize: '11px', fontWeight: 700,
            }}>
            {open ? 'Hide log' : 'Log'}
          </button>
        )}
      </div>

      {open && logs.length > 0 && (
        <div ref={logRef} style={{
          marginTop: '0.75rem', maxHeight: '260px', overflowY: 'auto',
          background: '#070c14', border: `1px solid ${LINE}`, borderRadius: '0.5rem',
          padding: '0.6rem 0.7rem', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          fontSize: '10.5px', lineHeight: 1.65,
        }}>
          {logs.map((l, i) => (
            <div key={i} style={{ color: LEVEL_COLOR[l.level] ?? GREY, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
              {l.text}
            </div>
          ))}
          {busy && <div style={{ color: GOLD }}>▍</div>}
        </div>
      )}
    </div>
  )
}
