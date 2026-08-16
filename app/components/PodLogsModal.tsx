'use client'

import React, { useState, useEffect, useRef } from 'react'

interface PodLogsModalProps {
  podId?: string
  isOpen: boolean
  onClose: () => void
  onTerminate?: (podId: string) => void
}

interface PodInspectorData {
  podId: string
  podName: string
  gpuName: string
  status: string
  isComfyOnline: boolean
  vram: {
    totalGb: number
    freeGb: number
    usedGb: number
    usagePercent: number
  }
  uptimeSeconds: number
  costPerHr: number
  queue: {
    runningCount: number
    pendingCount: number
    historyCount: number
  }
  logs: { time: string; level: 'info' | 'ok' | 'warn' | 'error'; text: string }[]
}

export default function PodLogsModal({ podId, isOpen, onClose, onTerminate }: PodLogsModalProps) {
  const [data, setData] = useState<PodInspectorData | null>(null)
  const [loading, setLoading] = useState(true)
  const [autoScroll, setAutoScroll] = useState(true)
  const [autoRefresh, setAutoRefresh] = useState(true)
  const terminalRef = useRef<HTMLDivElement>(null)

  const fetchLogs = async () => {
    try {
      const url = podId ? `/api/videogen/pod/logs?podId=${encodeURIComponent(podId)}` : '/api/videogen/pod/logs'
      const res = await fetch(url)
      if (res.ok) {
        const json = await res.json()
        setData(json)
      }
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!isOpen) return
    fetchLogs()
    if (!autoRefresh) return
    const id = setInterval(fetchLogs, 2500)
    return () => clearInterval(id)
  }, [isOpen, podId, autoRefresh])

  useEffect(() => {
    if (autoScroll && terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight
    }
  }, [data?.logs, autoScroll])

  if (!isOpen) return null

  const activePodId = data?.podId || podId || ''
  const isOnline = data?.isComfyOnline ?? false
  const uptimeMin = Math.floor((data?.uptimeSeconds || 0) / 60)

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(3, 6, 12, 0.85)',
        backdropFilter: 'blur(10px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 200,
        padding: '1rem',
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: 'linear-gradient(135deg, #090e1a 0%, #060a12 100%)',
          border: '1px solid #1e293b',
          borderRadius: '1rem',
          width: '740px',
          maxWidth: '96vw',
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 25px 70px rgba(0,0,0,0.85), 0 0 30px rgba(37,99,235,0.15)',
          overflow: 'hidden',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            padding: '1.25rem 1.5rem',
            borderBottom: '1px solid #1a2840',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            background: 'rgba(14,23,38,0.5)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <span style={{ fontSize: '1.4rem' }}>⚡</span>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <h3 style={{ fontSize: '15px', fontWeight: 900, color: '#F2F5FA', margin: 0 }}>
                  Live GPU Pod Inspector & Console
                </h3>
                <span
                  style={{
                    fontSize: '10px',
                    fontWeight: 800,
                    padding: '0.15rem 0.5rem',
                    borderRadius: '0.3rem',
                    background: isOnline ? 'rgba(74,222,128,0.15)' : 'rgba(232,185,74,0.15)',
                    color: isOnline ? '#4ade80' : 'var(--gold)',
                    border: `1px solid ${isOnline ? 'rgba(74,222,128,0.3)' : 'rgba(232,185,74,0.3)'}`,
                  }}
                >
                  {isOnline ? '● COMFYUI READY' : '⏳ WARMING UP'}
                </span>
              </div>
              <p style={{ fontSize: '11px', color: '#94a3b8', margin: '0.15rem 0 0' }}>
                Pod ID: <span style={{ color: 'var(--gold)', fontFamily: 'monospace' }}>{activePodId || 'Detecting...'}</span> · {data?.gpuName || 'NVIDIA GPU'} · ${data?.costPerHr?.toFixed(2) || '0.69'}/hr · Uptime: {uptimeMin}m
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#94a3b8',
              fontSize: '20px',
              cursor: 'pointer',
              padding: '0.25rem',
              lineHeight: 1,
            }}
          >
            ✕
          </button>
        </div>

        {/* Real-time Hardware & Queue Metrics Bar */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
            gap: '0.75rem',
            padding: '1rem 1.5rem',
            background: '#040711',
            borderBottom: '1px solid #1a2840',
          }}
        >
          {/* VRAM Gauge */}
          <div style={{ background: '#0a101d', border: '1px solid #1a2840', borderRadius: '0.5rem', padding: '0.6rem 0.85rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: '#64748b', textTransform: 'uppercase', fontWeight: 700 }}>
              <span>GPU VRAM</span>
              <span style={{ color: '#F2F5FA' }}>{data?.vram?.usagePercent || 0}%</span>
            </div>
            <div style={{ fontSize: '13px', fontWeight: 800, color: '#c084fc', margin: '0.2rem 0' }}>
              {data?.vram?.usedGb || 0} / {data?.vram?.totalGb || 48} GB
            </div>
            <div style={{ width: '100%', height: '4px', background: '#1a2840', borderRadius: '2px', overflow: 'hidden' }}>
              <div style={{ width: `${data?.vram?.usagePercent || 0}%`, height: '100%', background: 'linear-gradient(90deg, #7c3aed, #c084fc)' }} />
            </div>
          </div>

          {/* Active Queue */}
          <div style={{ background: '#0a101d', border: '1px solid #1a2840', borderRadius: '0.5rem', padding: '0.6rem 0.85rem' }}>
            <span style={{ fontSize: '10px', color: '#64748b', textTransform: 'uppercase', fontWeight: 700 }}>Active Queue</span>
            <div style={{ fontSize: '13px', fontWeight: 800, color: (data?.queue?.runningCount || 0) > 0 ? '#4ade80' : '#94a3b8', margin: '0.2rem 0 0' }}>
              {(data?.queue?.runningCount || 0) > 0 ? '▶ 1 Rendering' : '● Idle (Ready)'}
            </div>
            <span style={{ fontSize: '10px', color: '#64748b' }}>
              {data?.queue?.pendingCount || 0} pending · {data?.queue?.historyCount || 0} completed
            </span>
          </div>

          {/* ComfyUI Direct Links */}
          <div style={{ background: '#0a101d', border: '1px solid #1a2840', borderRadius: '0.5rem', padding: '0.6rem 0.85rem', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '0.35rem' }}>
            <div style={{ display: 'flex', gap: '0.4rem' }}>
              {activePodId && (
                <a
                  href={`https://${activePodId}-8188.proxy.runpod.net`}
                  target="_blank"
                  rel="noreferrer"
                  style={{
                    flex: 1,
                    background: 'rgba(232,185,74,0.12)',
                    border: '1px solid rgba(232,185,74,0.3)',
                    color: 'var(--gold)',
                    borderRadius: '0.3rem',
                    padding: '0.35rem',
                    fontSize: '10.5px',
                    fontWeight: 700,
                    textAlign: 'center',
                    textDecoration: 'none',
                  }}
                >
                  🌐 Native ComfyUI
                </a>
              )}
            </div>
          </div>
        </div>

        {/* Live Terminal Controls */}
        <div style={{ padding: '0.6rem 1.5rem', background: '#010409', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #1a2840' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <span style={{ fontSize: '11px', fontWeight: 800, color: 'var(--gold)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              📟 Live Container & ComfyUI Log Stream
            </span>
            {loading && <span style={{ fontSize: '10px', color: '#94a3b8' }}>Refreshing...</span>}
          </div>

          <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center' }}>
            <label style={{ fontSize: '10.5px', color: '#94a3b8', display: 'flex', alignItems: 'center', gap: '0.3rem', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={autoRefresh}
                onChange={(e) => setAutoRefresh(e.target.checked)}
              />
              Auto-poll (2s)
            </label>

            <label style={{ fontSize: '10.5px', color: '#94a3b8', display: 'flex', alignItems: 'center', gap: '0.3rem', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={autoScroll}
                onChange={(e) => setAutoScroll(e.target.checked)}
              />
              Auto-scroll
            </label>

            <button
              type="button"
              onClick={fetchLogs}
              style={{
                background: 'rgba(255,255,255,0.06)',
                border: '1px solid #334155',
                color: '#cbd5e1',
                borderRadius: '0.3rem',
                padding: '0.2rem 0.5rem',
                fontSize: '10px',
                cursor: 'pointer',
              }}
            >
              🔄 Refresh
            </button>
          </div>
        </div>

        {/* Terminal Body */}
        <div
          ref={terminalRef}
          style={{
            background: '#010409',
            padding: '1rem 1.5rem',
            overflowY: 'auto',
            maxHeight: '340px',
            minHeight: '220px',
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
            fontSize: '11px',
            lineHeight: 1.6,
            display: 'flex',
            flexDirection: 'column',
            gap: '0.35rem',
          }}
        >
          {(!data?.logs || data.logs.length === 0) ? (
            <div style={{ color: '#64748b', textAlign: 'center', padding: '2rem 0' }}>
              📡 Connecting to GPU node telemetry stream...
            </div>
          ) : (
            data.logs.map((l, i) => (
              <div
                key={i}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '0.5rem',
                  color:
                    l.level === 'ok'
                      ? '#4ade80'
                      : l.level === 'warn'
                      ? '#fbbf24'
                      : l.level === 'error'
                      ? '#f87171'
                      : '#93c5fd',
                }}
              >
                <span style={{ color: '#475569', fontSize: '9.5px', userSelect: 'none', minWidth: '55px' }}>
                  {l.time}
                </span>
                <span style={{ opacity: 0.6, userSelect: 'none' }}>
                  {l.level === 'ok' ? '✓' : l.level === 'warn' ? '⚠' : l.level === 'error' ? '✖' : '›'}
                </span>
                <span style={{ wordBreak: 'break-all' }}>{l.text}</span>
              </div>
            ))
          )}
        </div>

        {/* Footer Actions */}
        <div
          style={{
            padding: '0.85rem 1.5rem',
            borderTop: '1px solid #1a2840',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            background: '#070c14',
          }}
        >
          <span style={{ fontSize: '10.5px', color: '#64748b' }}>
            5-min Inactivity Watchdog is Active · Pod will auto-terminate when idle.
          </span>

          <div style={{ display: 'flex', gap: '0.5rem' }}>
            {onTerminate && activePodId && (
              <button
                type="button"
                onClick={() => {
                  onTerminate(activePodId)
                  onClose()
                }}
                style={{
                  background: 'rgba(239, 68, 68, 0.15)',
                  border: '1px solid rgba(239, 68, 68, 0.4)',
                  color: '#ef4444',
                  borderRadius: '0.4rem',
                  padding: '0.4rem 0.75rem',
                  fontSize: '11px',
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                🛑 Terminate Pod
              </button>
            )}

            <button
              type="button"
              onClick={onClose}
              style={{
                background: '#1e293b',
                border: 'none',
                color: '#F2F5FA',
                borderRadius: '0.4rem',
                padding: '0.4rem 0.85rem',
                fontSize: '11px',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              Close Console
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
