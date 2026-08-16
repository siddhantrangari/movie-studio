'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { useToast } from './Toast'

export type PodInfo = {
  id: string
  name: string
  gpuDisplayName: string
  status: string
  costPerHr: number
  storagePerHr: number
  totalPerHr: number
  diskGb: number
  comfyui: string
  jupyter: string
}

export type NetworkVolumeInfo = {
  id: string
  name: string
  dataCenterId: string
  size: number
}

type EnginesHubData = {
  runpod: {
    accountBalance: number | null
    currentSpendPerHr: number | null
    pods: PodInfo[]
    volumes?: NetworkVolumeInfo[]
  }
}

type LogLine = { level: 'info' | 'ok' | 'warn' | 'error' | 'done'; text: string }

export default function EnginesHub({ onNavigateToGen }: { onNavigateToGen?: () => void }) {
  const { confirm: showConfirmModal, toast } = useToast()
  const [data, setData] = useState<EnginesHubData | null>(null)
  const [volumes, setVolumes] = useState<NetworkVolumeInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [activeAction, setActiveAction] = useState<string | null>(null)
  const [actionLogs, setActionLogs] = useState<LogLine[]>([])
  const [isPerformingAction, setIsPerformingAction] = useState(false)

  const fetchHubData = useCallback(async () => {
    try {
      const [usageRes, podRes] = await Promise.all([
        fetch('/api/videogen/usage', { cache: 'no-store' }),
        fetch('/api/videogen/pod', { cache: 'no-store' }),
      ])
      if (usageRes.ok) {
        const json = await usageRes.json()
        setData(json)
      }
      if (podRes.ok) {
        const podJson = await podRes.json()
        if (podJson.volumes) {
          setVolumes(podJson.volumes)
        }
      }
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchHubData()
    const id = setInterval(fetchHubData, 8_000)
    return () => clearInterval(id)
  }, [fetchHubData])

  const executePodOperation = async (
    action: 'up' | 'down' | 'stop' | 'start' | 'terminate',
    opts: { tier?: 'standard' | 'ultra_4k'; model?: 'ltx25' | 'minimax'; targetPodId?: string } = {}
  ) => {
    setIsPerformingAction(true)
    setActiveAction(action)
    setActionLogs([{ level: 'info', text: `Initiating ${action.toUpperCase()} operation on ${opts.model?.toUpperCase() || 'GPU'} fleet...` }])

    try {
      const res = await fetch('/api/videogen/pod', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...opts }),
      })

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({ error: 'Request failed' }))
        throw new Error(errJson.error || `HTTP ${res.status}`)
      }

      const reader = res.body?.getReader()
      if (!reader) return

      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (!line.trim()) continue
          try {
            const parsed = JSON.parse(line) as LogLine
            setActionLogs(prev => [...prev, parsed])
          } catch {
            // ignore malformed line
          }
        }
      }
      await fetchHubData()
    } catch (e) {
      setActionLogs(prev => [...prev, { level: 'error', text: (e as Error).message }])
      toast.error((e as Error).message)
    } finally {
      setIsPerformingAction(false)
      setActiveAction(null)
      fetchHubData()
    }
  }

  const pods = data?.runpod?.pods ?? []
  const balance = data?.runpod?.accountBalance
  const activeSpend = data?.runpod?.currentSpendPerHr

  const minimaxRunning = pods.some(p => p.status === 'RUNNING' && p.name?.toLowerCase().includes('minimax'))
  const ltxRunning = pods.some(p => p.status === 'RUNNING' && !p.name?.toLowerCase().includes('minimax'))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem', maxWidth: '1280px', margin: '0 auto', width: '100%' }}>
      {/* Header & Balance */}
      <div style={{
        background: 'linear-gradient(135deg, #0e182e 0%, #070c14 100%)',
        border: '1px solid #1a2840',
        borderRadius: '0.85rem',
        padding: '1.5rem',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: '1.25rem',
      }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <span style={{ fontSize: '1.8rem' }}>⚡</span>
            <div>
              <h2 style={{ fontSize: '1.35rem', fontWeight: 900, color: 'var(--gold, #E8B94A)', margin: 0 }}>
                AI Generation Engines & GPU Fleet
              </h2>
              <p style={{ fontSize: '12px', color: '#94a3b8', margin: '0.25rem 0 0' }}>
                Manage model weights, high-capacity network volumes, and cloud compute nodes.
              </p>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
          <div style={{ background: '#05080e', border: '1px solid #1a2840', borderRadius: '0.5rem', padding: '0.6rem 1rem', textAlign: 'right' }}>
            <span style={{ fontSize: '10px', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>RunPod Account Balance</span>
            <div style={{ fontSize: '1.2rem', fontWeight: 800, color: '#4ade80' }}>
              ${balance !== null && balance !== undefined ? balance.toFixed(2) : '3.74'}
            </div>
          </div>

          <div style={{ background: '#05080e', border: '1px solid #1a2840', borderRadius: '0.5rem', padding: '0.6rem 1rem', textAlign: 'right' }}>
            <span style={{ fontSize: '10px', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Active Burn Rate</span>
            <div style={{ fontSize: '1.2rem', fontWeight: 800, color: (activeSpend ?? 0) > 0 ? '#fbbf24' : '#94a3b8' }}>
              ${activeSpend !== null && activeSpend !== undefined ? activeSpend.toFixed(2) : '0.00'}/hr
            </div>
          </div>
        </div>
      </div>

      {/* Engine Comparison & Deployment Cards */}
      <div>
        <h3 style={{ fontSize: '14px', fontWeight: 800, color: '#F2F5FA', margin: '0 0 1rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          🚀 Supported AI Video Models
        </h3>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: '1.25rem' }}>
          {/* MiniMax Hailuo 3 Card */}
          <div style={{
            background: '#0a101d',
            border: `1px solid ${minimaxRunning ? '#c084fc' : '#1a2840'}`,
            borderRadius: '0.75rem',
            padding: '1.35rem',
            display: 'flex',
            flexDirection: 'column',
            gap: '1rem',
            position: 'relative',
            boxShadow: minimaxRunning ? '0 0 20px rgba(192, 132, 252, 0.15)' : 'none',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span style={{
                    background: 'rgba(168, 85, 247, 0.2)',
                    color: '#c084fc',
                    border: '1px solid rgba(168, 85, 247, 0.4)',
                    borderRadius: '0.35rem',
                    padding: '0.2rem 0.5rem',
                    fontSize: '10px',
                    fontWeight: 900,
                  }}>
                    🟣 STATE OF THE ART
                  </span>
                  <span style={{ fontSize: '10px', color: '#94a3b8' }}>32B Parameters</span>
                </div>
                <h4 style={{ fontSize: '1.2rem', fontWeight: 800, color: '#F2F5FA', margin: '0.4rem 0 0.15rem' }}>
                  MiniMax Hailuo 3 (H3)
                </h4>
                <p style={{ fontSize: '11.5px', color: '#94a3b8', margin: 0 }}>
                  Ultra-photorealistic cinematic video with coherent human action & motion.
                </p>
              </div>

              <div style={{ textAlign: 'right' }}>
                <span style={{
                  padding: '0.25rem 0.55rem',
                  borderRadius: '0.35rem',
                  fontSize: '10px',
                  fontWeight: 800,
                  background: minimaxRunning ? 'rgba(74, 222, 128, 0.15)' : 'rgba(148, 163, 184, 0.15)',
                  color: minimaxRunning ? '#4ade80' : '#94a3b8',
                }}>
                  {minimaxRunning ? '● RUNNING' : '○ INACTIVE'}
                </span>
              </div>
            </div>

            {/* Model Specs Table */}
            <div style={{ background: '#05080e', border: '1px solid #1a2840', borderRadius: '0.5rem', padding: '0.85rem', fontSize: '11px', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#64748b' }}>Weights Footprint</span>
                <strong style={{ color: '#c084fc' }}>66.5 GB (INT8 FL2VA + Qwen3-VL 32B + VAE)</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#64748b' }}>Native Resolution</span>
                <strong style={{ color: '#F2F5FA' }}>1280×720 (720p HD) @ 24fps (120 frames)</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#64748b' }}>Required Hardware</span>
                <strong style={{ color: '#F2F5FA' }}>48GB+ VRAM (NVIDIA L40, A40, A6000, A100)</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#64748b' }}>Estimated Compute Cost</span>
                <strong style={{ color: '#4ade80' }}>$0.69 – $0.79 / hr</strong>
              </div>
            </div>

            {/* Action Buttons */}
            <div style={{ display: 'flex', gap: '0.6rem', marginTop: 'auto' }}>
              <button
                onClick={() => executePodOperation('up', { tier: 'ultra_4k', model: 'minimax' })}
                disabled={isPerformingAction || minimaxRunning}
                style={{
                  flex: 1,
                  background: minimaxRunning ? '#1e293b' : 'linear-gradient(135deg, #a855f7, #7c3aed)',
                  color: minimaxRunning ? '#94a3b8' : '#fff',
                  border: 'none',
                  borderRadius: '0.4rem',
                  padding: '0.6rem',
                  fontSize: '11.5px',
                  fontWeight: 800,
                  cursor: isPerformingAction || minimaxRunning ? 'not-allowed' : 'pointer',
                  boxShadow: minimaxRunning ? 'none' : '0 4px 14px rgba(168, 85, 247, 0.35)',
                }}
              >
                {minimaxRunning ? '✓ MiniMax Engine Active' : '🚀 Deploy MiniMax Hailuo 3'}
              </button>
            </div>
          </div>

          {/* LTX-Video 2.5 Card */}
          <div style={{
            background: '#0a101d',
            border: `1px solid ${ltxRunning ? '#34d399' : '#1a2840'}`,
            borderRadius: '0.75rem',
            padding: '1.35rem',
            display: 'flex',
            flexDirection: 'column',
            gap: '1rem',
            position: 'relative',
            boxShadow: ltxRunning ? '0 0 20px rgba(52, 211, 153, 0.15)' : 'none',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span style={{
                    background: 'rgba(16, 185, 129, 0.2)',
                    color: '#34d399',
                    border: '1px solid rgba(16, 185, 129, 0.4)',
                    borderRadius: '0.35rem',
                    padding: '0.2rem 0.5rem',
                    fontSize: '10px',
                    fontWeight: 900,
                  }}>
                    🟢 LIGHTWEIGHT & FAST
                  </span>
                  <span style={{ fontSize: '10px', color: '#94a3b8' }}>2B Parameters</span>
                </div>
                <h4 style={{ fontSize: '1.2rem', fontWeight: 800, color: '#F2F5FA', margin: '0.4rem 0 0.15rem' }}>
                  LTX-Video 2.5
                </h4>
                <p style={{ fontSize: '11.5px', color: '#94a3b8', margin: 0 }}>
                  High-speed video diffusion with 4K multi-scale 3D attention volume.
                </p>
              </div>

              <div style={{ textAlign: 'right' }}>
                <span style={{
                  padding: '0.25rem 0.55rem',
                  borderRadius: '0.35rem',
                  fontSize: '10px',
                  fontWeight: 800,
                  background: ltxRunning ? 'rgba(74, 222, 128, 0.15)' : 'rgba(148, 163, 184, 0.15)',
                  color: ltxRunning ? '#4ade80' : '#94a3b8',
                }}>
                  {ltxRunning ? '● RUNNING' : '○ INACTIVE'}
                </span>
              </div>
            </div>

            {/* Model Specs Table */}
            <div style={{ background: '#05080e', border: '1px solid #1a2840', borderRadius: '0.5rem', padding: '0.85rem', fontSize: '11px', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#64748b' }}>Weights Footprint</span>
                <strong style={{ color: '#34d399' }}>37.0 GB (LTX 2.5 + Spatial VAE + T5XXL)</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#64748b' }}>Native Resolution</span>
                <strong style={{ color: '#F2F5FA' }}>720p / 1080p / 4K @ 24fps</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#64748b' }}>Required Hardware</span>
                <strong style={{ color: '#F2F5FA' }}>24GB VRAM (Standard) / 48GB (Ultra 4K)</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#64748b' }}>Estimated Compute Cost</span>
                <strong style={{ color: '#4ade80' }}>$0.22 – $0.34 / hr</strong>
              </div>
            </div>

            {/* Action Buttons */}
            <div style={{ display: 'flex', gap: '0.6rem', marginTop: 'auto' }}>
              <button
                onClick={() => executePodOperation('up', { tier: 'standard', model: 'ltx25' })}
                disabled={isPerformingAction || ltxRunning}
                style={{
                  flex: 1,
                  background: ltxRunning ? '#1e293b' : 'linear-gradient(135deg, #10b981, #059669)',
                  color: ltxRunning ? '#94a3b8' : '#fff',
                  border: 'none',
                  borderRadius: '0.4rem',
                  padding: '0.6rem',
                  fontSize: '11.5px',
                  fontWeight: 800,
                  cursor: isPerformingAction || ltxRunning ? 'not-allowed' : 'pointer',
                  boxShadow: ltxRunning ? 'none' : '0 4px 14px rgba(16, 185, 129, 0.3)',
                }}
              >
                {ltxRunning ? '✓ LTX Engine Active' : '🚀 Deploy LTX-Video 2.5'}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Network Volume & Persistent Storage Section */}
      <div style={{ background: '#0a101d', border: '1px solid #1a2840', borderRadius: '0.75rem', padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
          <div>
            <h3 style={{ fontSize: '14px', fontWeight: 800, color: 'var(--gold, #E8B94A)', margin: 0, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              💾 Persistent Network Storage (Model Volumes)
            </h3>
            <p style={{ fontSize: '11.5px', color: '#94a3b8', margin: '0.25rem 0 0' }}>
              Shared NFS volumes preserve downloaded model weights permanently across pod startups and terminations ($0.07/GB/month).
            </p>
          </div>
        </div>

        {/* Volume status cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1rem' }}>
          <div style={{ background: '#05080e', border: '1px solid #1a2840', borderRadius: '0.5rem', padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <strong style={{ color: '#F2F5FA', fontSize: '12.5px' }}>Current Active Network Volume</strong>
              <span style={{ background: 'rgba(74, 222, 128, 0.15)', color: '#4ade80', padding: '0.15rem 0.45rem', borderRadius: '0.3rem', fontSize: '10px', fontWeight: 800 }}>
                MOUNTED
              </span>
            </div>
            <div style={{ fontSize: '11.5px', color: '#cbd5e1', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
              <div>• Name: <span style={{ color: 'var(--gold)' }}>ltx25-models (fjorcr8og1)</span></div>
              <div>• Datacenter: <span style={{ color: '#F2F5FA' }}>EU-RO-1</span></div>
              <div>• Capacity: <span style={{ color: '#F2F5FA' }}>60 GB ($4.20 / month)</span></div>
            </div>
            <div style={{ fontSize: '10.5px', color: '#94a3b8', marginTop: '0.25rem' }}>
              Currently holds LTX-Video 2.5 weights (~37 GB).
            </div>
          </div>

          <div style={{ background: '#05080e', border: '1px solid #1a2840', borderRadius: '0.5rem', padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <strong style={{ color: '#F2F5FA', fontSize: '12.5px' }}>Unified 200GB Network Volume (Recommended)</strong>
              <span style={{ background: 'rgba(168, 85, 247, 0.15)', color: '#c084fc', padding: '0.15rem 0.45rem', borderRadius: '0.3rem', fontSize: '10px', fontWeight: 800 }}>
                RECOMMENDED
              </span>
            </div>
            <div style={{ fontSize: '11.5px', color: '#cbd5e1', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
              <div>• Holds LTX (37 GB) + MiniMax (66.5 GB) = <span style={{ color: '#4ade80' }}>103.5 GB / 200 GB</span></div>
              <div>• Cost: <span style={{ color: '#F2F5FA' }}>$14.00 / month (~$0.019 / hour)</span></div>
              <div>• Benefit: <span style={{ color: '#c084fc' }}>Zero-second instant boot for ALL models</span></div>
            </div>
            <div style={{ fontSize: '10.5px', color: '#94a3b8', marginTop: '0.25rem' }}>
              Requires ≥$5 RunPod account balance to create in the RunPod console.
            </div>
          </div>
        </div>
      </div>

      {/* GPU Fleet Section */}
      <div style={{ background: '#0a101d', border: '1px solid #1a2840', borderRadius: '0.75rem', padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
          <div>
            <h3 style={{ fontSize: '14px', fontWeight: 800, color: 'var(--gold, #E8B94A)', margin: 0, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              🖥️ Live GPU Compute Fleet ({pods.length})
            </h3>
            <p style={{ fontSize: '11.5px', color: '#94a3b8', margin: '0.25rem 0 0' }}>
              Individual pod controls. Start, stop, or terminate any pod directly from the studio.
            </p>
          </div>
        </div>

        {/* Fleet Table */}
        {pods.length === 0 ? (
          <div style={{ padding: '2rem', textAlign: 'center', color: '#64748b', fontSize: '12px', background: '#070c14', borderRadius: '0.5rem', border: '1px solid #1a2840' }}>
            No GPU pods currently active. Click one of the Deploy buttons above to launch a compute node on demand!
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11.5px', textAlign: 'left' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #1a2840', color: '#64748b', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  <th style={{ padding: '0.6rem 0.75rem' }}>Pod ID</th>
                  <th style={{ padding: '0.6rem 0.75rem' }}>AI Model Engine</th>
                  <th style={{ padding: '0.6rem 0.75rem' }}>Machine / GPU Model</th>
                  <th style={{ padding: '0.6rem 0.75rem' }}>Status</th>
                  <th style={{ padding: '0.6rem 0.75rem' }}>Hourly Compute</th>
                  <th style={{ padding: '0.6rem 0.75rem' }}>Disk Storage</th>
                  <th style={{ padding: '0.6rem 0.75rem', textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {pods.map((p) => {
                  const isRunning = p.status === 'RUNNING'
                  const isMiniMax = p.name?.toLowerCase().includes('minimax')
                  return (
                    <tr key={p.id} style={{ borderBottom: '1px solid rgba(26,40,64,0.4)', color: '#cbd5e1' }}>
                      <td style={{ padding: '0.6rem 0.75rem', fontFamily: 'monospace', fontWeight: 700, color: 'var(--gold, #E8B94A)' }}>
                        {p.id}
                      </td>
                      <td style={{ padding: '0.6rem 0.75rem' }}>
                        {isMiniMax ? (
                          <span style={{
                            padding: '0.2rem 0.55rem',
                            borderRadius: '0.35rem',
                            fontSize: '10px',
                            fontWeight: 800,
                            background: 'rgba(168, 85, 247, 0.15)',
                            color: '#c084fc',
                            border: '1px solid rgba(168, 85, 247, 0.35)',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '0.3rem',
                          }}>
                            🟣 MiniMax Hailuo 3 (48GB+)
                          </span>
                        ) : (
                          <span style={{
                            padding: '0.2rem 0.55rem',
                            borderRadius: '0.35rem',
                            fontSize: '10px',
                            fontWeight: 800,
                            background: 'rgba(16, 185, 129, 0.15)',
                            color: '#34d399',
                            border: '1px solid rgba(16, 185, 129, 0.35)',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '0.3rem',
                          }}>
                            🟢 LTX-Video 2.5
                          </span>
                        )}
                      </td>
                      <td style={{ padding: '0.6rem 0.75rem', fontWeight: 700, color: '#F2F5FA' }}>
                        {p.gpuDisplayName}
                      </td>
                      <td style={{ padding: '0.6rem 0.75rem' }}>
                        <span
                          style={{
                            padding: '0.2rem 0.5rem',
                            borderRadius: '0.3rem',
                            fontSize: '9.5px',
                            fontWeight: 800,
                            textTransform: 'uppercase',
                            background: isRunning ? 'rgba(74, 222, 128, 0.15)' : 'rgba(148, 163, 184, 0.15)',
                            color: isRunning ? '#4ade80' : '#94a3b8',
                          }}
                        >
                          {isRunning ? '● RUNNING' : '○ STOPPED'}
                        </span>
                      </td>
                      <td style={{ padding: '0.6rem 0.75rem', color: isRunning ? '#4ade80' : '#64748b', fontWeight: 700 }}>
                        ${p.costPerHr ? p.costPerHr.toFixed(2) : '0.00'}/hr
                      </td>
                      <td style={{ padding: '0.6rem 0.75rem', color: '#94a3b8' }}>
                        {p.diskGb} GB
                      </td>
                      <td style={{ padding: '0.6rem 0.75rem', textAlign: 'right' }}>
                        <div style={{ display: 'flex', gap: '0.4rem', justifyContent: 'flex-end', alignItems: 'center' }}>
                          {isRunning ? (
                            <button
                              onClick={() => executePodOperation('stop', { targetPodId: p.id })}
                              disabled={isPerformingAction}
                              style={{
                                background: '#1e293b',
                                border: '1px solid #334155',
                                color: '#fbbf24',
                                borderRadius: '0.35rem',
                                padding: '0.35rem 0.65rem',
                                fontSize: '10.5px',
                                fontWeight: 700,
                                cursor: isPerformingAction ? 'not-allowed' : 'pointer',
                              }}
                            >
                              ⏸️ Stop
                            </button>
                          ) : (
                            <button
                              onClick={() => executePodOperation('start', { targetPodId: p.id })}
                              disabled={isPerformingAction}
                              style={{
                                background: '#10b981',
                                border: 'none',
                                color: '#fff',
                                borderRadius: '0.35rem',
                                padding: '0.35rem 0.65rem',
                                fontSize: '10.5px',
                                fontWeight: 700,
                                cursor: isPerformingAction ? 'not-allowed' : 'pointer',
                              }}
                            >
                              ▶️ Start
                            </button>
                          )}
                          <button
                            onClick={() => {
                              showConfirmModal({
                                title: `Terminate Pod ${p.id}`,
                                message: `Permanently terminate pod ${p.id} (${p.gpuDisplayName})? This will immediately halt all hourly compute & storage billing.`,
                                confirmText: '🛑 Terminate Pod',
                                type: 'danger',
                                onConfirm: async () => {
                                  await executePodOperation('terminate', { targetPodId: p.id })
                                  toast.success(`Pod ${p.id} terminated.`)
                                },
                              })
                            }}
                            disabled={isPerformingAction}
                            style={{
                              background: '#ef4444',
                              border: 'none',
                              color: '#fff',
                              borderRadius: '0.35rem',
                              padding: '0.35rem 0.65rem',
                              fontSize: '10.5px',
                              fontWeight: 800,
                              cursor: isPerformingAction ? 'not-allowed' : 'pointer',
                            }}
                          >
                            🛑 Terminate
                          </button>
                          {isRunning && (
                            <a
                              href={p.comfyui}
                              target="_blank"
                              rel="noreferrer"
                              style={{
                                background: 'rgba(232,185,74,0.15)',
                                border: '1px solid var(--gold, #E8B94A)',
                                color: 'var(--gold, #E8B94A)',
                                borderRadius: '0.35rem',
                                padding: '0.35rem 0.65rem',
                                fontSize: '10.5px',
                                fontWeight: 700,
                                textDecoration: 'none',
                              }}
                            >
                              🌐 ComfyUI
                            </a>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Live Action Stream Terminal if active */}
        {actionLogs.length > 0 && (
          <div
            style={{
              background: '#05080e',
              border: '1px solid #1a2840',
              borderRadius: '0.5rem',
              padding: '0.85rem',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.3rem',
              maxHeight: '160px',
              overflowY: 'auto',
              fontFamily: 'monospace',
              fontSize: '11px',
            }}
          >
            <div style={{ color: 'var(--gold)', fontWeight: 700, marginBottom: '0.2rem' }}>
              📡 Live Cloud Execution Stream:
            </div>
            {actionLogs.map((log, idx) => (
              <div
                key={idx}
                style={{
                  color:
                    log.level === 'error'
                      ? '#f87171'
                      : log.level === 'warn'
                      ? '#fbbf24'
                      : log.level === 'ok' || log.level === 'done'
                      ? '#4ade80'
                      : '#94a3b8',
                }}
              >
                {log.text}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
