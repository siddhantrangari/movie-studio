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
  idleInfo?: {
    idleSec: number
    maxIdleSec: number
    remainingSec: number
    willShutdownInSec: number
  }
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
  const [resizingVolId, setResizingVolId] = useState<string | null>(null)
  const [targetSizeGb, setTargetSizeGb] = useState<number>(200)
  const [isManagingVolume, setIsManagingVolume] = useState(false)
  const [showCreateVol, setShowCreateVol] = useState(false)
  const [newVolName, setNewVolName] = useState('studio-models')
  const [newVolSize, setNewVolSize] = useState(200)
  const [newVolDc, setNewVolDc] = useState('EU-RO-1')
  const [autoShutdownMinutes, setAutoShutdownMinutes] = useState<number>(5)

  const handleUpdateAutoShutdown = async (mins: number) => {
    try {
      setAutoShutdownMinutes(mins)
      const res = await fetch('/api/videogen/pod', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'set-auto-shutdown', minutes: mins }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Failed to update setting')
      toast.success(`🛡️ Auto-Shutdown set to ${mins} minutes of inactivity!`)
    } catch (e: any) {
      toast.error(e.message)
    }
  }

  const handleResizeVolume = async (volId: string, sizeGb: number) => {
    setIsManagingVolume(true)
    try {
      const res = await fetch('/api/videogen/pod', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'resize-volume', volumeId: volId, newSizeGb: sizeGb }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Failed to resize volume')
      toast.success(json.message || `Volume resized to ${sizeGb} GB successfully!`)
      setResizingVolId(null)
      await fetchHubData()
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setIsManagingVolume(false)
    }
  }

  const handleDeleteVolume = (volId: string, volName: string) => {
    showConfirmModal({
      title: `Delete Network Volume ${volName}?`,
      message: 'This will permanently delete this network volume and all saved model weights inside it. Are you sure?',
      confirmText: 'Delete Volume',
      type: 'danger',
      onConfirm: async () => {
        setIsManagingVolume(true)
        try {
          const res = await fetch('/api/videogen/pod', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'delete-volume', volumeId: volId }),
          })
          const json = await res.json()
          if (!res.ok) throw new Error(json.error || 'Failed to delete volume')
          toast.success('Volume deleted successfully!')
          await fetchHubData()
        } catch (e: any) {
          toast.error(e.message)
        } finally {
          setIsManagingVolume(false)
        }
      },
    })
  }

  const handleCreateVolume = async () => {
    if (!newVolName.trim()) {
      toast.error('Volume name is required')
      return
    }
    setIsManagingVolume(true)
    try {
      const res = await fetch('/api/videogen/pod', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'create-volume', volumeName: newVolName.trim(), newSizeGb: newVolSize, dataCenterId: newVolDc }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Failed to create volume')
      toast.success(json.message || 'Volume created successfully!')
      setShowCreateVol(false)
      await fetchHubData()
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setIsManagingVolume(false)
    }
  }

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
        if (podJson.autoShutdownMinutes) {
          setAutoShutdownMinutes(podJson.autoShutdownMinutes)
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

      {/* Network Volume & Persistent Storage Management Section */}
      <div style={{ background: '#0a101d', border: '1px solid #1a2840', borderRadius: '0.75rem', padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <h3 style={{ fontSize: '14px', fontWeight: 800, color: 'var(--gold, #E8B94A)', margin: 0, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                💾 Real-Time Network Volume Storage ({volumes.length || 1})
              </h3>
              <span style={{ background: 'rgba(56, 189, 248, 0.15)', color: '#38bdf8', padding: '0.15rem 0.5rem', borderRadius: '0.3rem', fontSize: '10px', fontWeight: 800 }}>
                $0.07 / GB / MO
              </span>
            </div>
            <p style={{ fontSize: '11.5px', color: '#94a3b8', margin: '0.25rem 0 0' }}>
              High-performance persistent Ceph NFS volumes shared across all GPU pods. Resize or adjust capacity on demand.
            </p>
          </div>

          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button
              onClick={() => setShowCreateVol(!showCreateVol)}
              style={{
                background: showCreateVol ? '#1e293b' : 'rgba(37, 99, 235, 0.2)',
                color: '#60a5fa',
                border: '1px solid rgba(37, 99, 235, 0.4)',
                borderRadius: '0.35rem',
                padding: '0.4rem 0.75rem',
                fontSize: '11px',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              {showCreateVol ? '✕ Cancel' : '➕ Create Extra Volume'}
            </button>
          </div>
        </div>

        {/* Create Volume Form (Expandable) */}
        {showCreateVol && (
          <div style={{ background: '#05080e', border: '1px solid #2563eb', borderRadius: '0.5rem', padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <strong style={{ color: '#F2F5FA', fontSize: '12px' }}>Provision New Network Volume</strong>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.6rem' }}>
              <div>
                <label style={{ fontSize: '10.5px', color: '#64748b', display: 'block', marginBottom: '0.2rem' }}>Volume Name</label>
                <input
                  type="text"
                  value={newVolName}
                  onChange={(e) => setNewVolName(e.target.value)}
                  style={{ width: '100%', background: '#0a101d', border: '1px solid #334155', color: '#fff', padding: '0.4rem 0.6rem', borderRadius: '0.3rem', fontSize: '11.5px' }}
                />
              </div>
              <div>
                <label style={{ fontSize: '10.5px', color: '#64748b', display: 'block', marginBottom: '0.2rem' }}>Capacity (GB)</label>
                <input
                  type="number"
                  value={newVolSize}
                  min={20}
                  step={10}
                  onChange={(e) => setNewVolSize(Number(e.target.value))}
                  style={{ width: '100%', background: '#0a101d', border: '1px solid #334155', color: '#fff', padding: '0.4rem 0.6rem', borderRadius: '0.3rem', fontSize: '11.5px' }}
                />
              </div>
              <div>
                <label style={{ fontSize: '10.5px', color: '#64748b', display: 'block', marginBottom: '0.2rem' }}>Datacenter Region</label>
                <select
                  value={newVolDc}
                  onChange={(e) => setNewVolDc(e.target.value)}
                  style={{ width: '100%', background: '#0a101d', border: '1px solid #334155', color: '#fff', padding: '0.4rem 0.6rem', borderRadius: '0.3rem', fontSize: '11.5px' }}
                >
                  <option value="EU-RO-1">EU-RO-1 (Romania — Low Latency)</option>
                  <option value="US-NJ-1">US-NJ-1 (New Jersey)</option>
                  <option value="US-CA-1">US-CA-1 (California)</option>
                  <option value="CA-MTL-1">CA-MTL-1 (Montreal)</option>
                </select>
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '0.25rem' }}>
              <button
                onClick={handleCreateVolume}
                disabled={isManagingVolume}
                style={{
                  background: 'linear-gradient(135deg, #2563eb, #1d4ed8)',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '0.35rem',
                  padding: '0.45rem 1rem',
                  fontSize: '11px',
                  fontWeight: 700,
                  cursor: isManagingVolume ? 'not-allowed' : 'pointer',
                }}
              >
                {isManagingVolume ? 'Creating...' : `Create Volume ($${(newVolSize * 0.07).toFixed(2)}/mo)`}
              </button>
            </div>
          </div>
        )}

        {/* Dynamic Volumes List */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {(volumes.length > 0 ? volumes : [
            {
              id: 'fjorcr8og1',
              name: 'ltx25-models',
              dataCenterId: 'EU-RO-1',
              size: 200,
              monthlyCost: 14.00,
              hourlyCost: 0.0192,
            }
          ]).map((vol) => {
            const isUnified = vol.id === 'fjorcr8og1' || vol.name.includes('models')
            const isResizingThis = resizingVolId === vol.id
            const currentCost = (vol.size * 0.07).toFixed(2)

            return (
              <div
                key={vol.id}
                style={{
                  background: 'linear-gradient(135deg, #070c14 0%, #0d1726 100%)',
                  border: isUnified ? '1px solid #2563eb' : '1px solid #1a2840',
                  borderRadius: '0.65rem',
                  padding: '1.15rem',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.75rem',
                }}
              >
                {/* Volume Header */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                    <span style={{ fontSize: '1.25rem' }}>🗄️</span>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <strong style={{ color: '#F2F5FA', fontSize: '13.5px' }}>{vol.name}</strong>
                        <span style={{ fontSize: '11px', color: '#64748b' }}>({vol.id})</span>
                      </div>
                      <div style={{ fontSize: '11px', color: '#94a3b8' }}>
                        Datacenter: <span style={{ color: '#F2F5FA', fontWeight: 700 }}>{vol.dataCenterId}</span> | Multi-Host NFS Ceph
                      </div>
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <span style={{
                      background: isUnified ? 'rgba(74, 222, 128, 0.15)' : 'rgba(148, 163, 184, 0.15)',
                      color: isUnified ? '#4ade80' : '#94a3b8',
                      border: `1px solid ${isUnified ? 'rgba(74, 222, 128, 0.35)' : 'rgba(148, 163, 184, 0.35)'}`,
                      padding: '0.2rem 0.55rem',
                      borderRadius: '0.35rem',
                      fontSize: '10.5px',
                      fontWeight: 800,
                    }}>
                      {isUnified ? '● UNIFIED ACTIVE (200 GB)' : '● ACTIVE'}
                    </span>

                    <button
                      onClick={() => {
                        setResizingVolId(isResizingThis ? null : vol.id)
                        setTargetSizeGb(vol.size)
                      }}
                      disabled={isManagingVolume}
                      style={{
                        background: isResizingThis ? '#334155' : 'rgba(232, 185, 74, 0.15)',
                        color: 'var(--gold, #E8B94A)',
                        border: '1px solid rgba(232, 185, 74, 0.35)',
                        borderRadius: '0.35rem',
                        padding: '0.25rem 0.6rem',
                        fontSize: '10.5px',
                        fontWeight: 700,
                        cursor: 'pointer',
                      }}
                    >
                      {isResizingThis ? '✕ Close' : '⚙️ Resize Volume'}
                    </button>

                    {!isUnified && (
                      <button
                        onClick={() => handleDeleteVolume(vol.id, vol.name)}
                        disabled={isManagingVolume}
                        style={{
                          background: 'rgba(239, 68, 68, 0.12)',
                          color: '#f87171',
                          border: '1px solid rgba(239, 68, 68, 0.3)',
                          borderRadius: '0.35rem',
                          padding: '0.25rem 0.55rem',
                          fontSize: '10.5px',
                          fontWeight: 700,
                          cursor: 'pointer',
                        }}
                      >
                        🗑️
                      </button>
                    )}
                  </div>
                </div>

                {/* Inline Resize Slider / Selector */}
                {isResizingThis && (
                  <div style={{ background: '#05080e', border: '1px dashed var(--gold)', borderRadius: '0.5rem', padding: '0.85rem', display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: '11px', fontWeight: 800, color: 'var(--gold)' }}>
                        Resize {vol.name} Capacity
                      </span>
                      <span style={{ fontSize: '11.5px', fontWeight: 800, color: '#4ade80' }}>
                        {targetSizeGb} GB = ${(targetSizeGb * 0.07).toFixed(2)} / month (~${((targetSizeGb * 0.07) / 730).toFixed(4)}/hr)
                      </span>
                    </div>

                    <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                      {[100, 150, 200, 250, 300, 500].map((preset) => (
                        <button
                          key={preset}
                          onClick={() => setTargetSizeGb(preset)}
                          style={{
                            background: targetSizeGb === preset ? 'var(--gold)' : '#0a101d',
                            color: targetSizeGb === preset ? '#000' : '#cbd5e1',
                            border: `1px solid ${targetSizeGb === preset ? 'var(--gold)' : '#334155'}`,
                            borderRadius: '0.3rem',
                            padding: '0.25rem 0.6rem',
                            fontSize: '10.5px',
                            fontWeight: 700,
                            cursor: 'pointer',
                          }}
                        >
                          {preset} GB (${(preset * 0.07).toFixed(2)}/mo)
                        </button>
                      ))}
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '0.2rem' }}>
                      <button
                        onClick={() => handleResizeVolume(vol.id, targetSizeGb)}
                        disabled={isManagingVolume || targetSizeGb === vol.size}
                        style={{
                          background: targetSizeGb === vol.size ? '#1e293b' : 'linear-gradient(135deg, #10b981, #059669)',
                          color: targetSizeGb === vol.size ? '#64748b' : '#fff',
                          border: 'none',
                          borderRadius: '0.35rem',
                          padding: '0.4rem 0.9rem',
                          fontSize: '11px',
                          fontWeight: 800,
                          cursor: targetSizeGb === vol.size || isManagingVolume ? 'not-allowed' : 'pointer',
                        }}
                      >
                        {isManagingVolume ? 'Applying...' : `✓ Save New Size (${targetSizeGb} GB)`}
                      </button>
                    </div>
                  </div>
                )}

                {/* Capacity breakdown cards */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.65rem' }}>
                  <div style={{ background: '#05080e', padding: '0.65rem 0.85rem', borderRadius: '0.4rem', border: '1px solid #1a2840' }}>
                    <div style={{ fontSize: '10px', color: '#64748b', textTransform: 'uppercase', fontWeight: 700 }}>Total Volume Capacity</div>
                    <div style={{ fontSize: '13px', color: '#F2F5FA', fontWeight: 800, marginTop: '0.15rem' }}>{vol.size} GB (${currentCost} / month)</div>
                    <div style={{ fontSize: '10px', color: '#94a3b8' }}>~${(Number(currentCost) / 30).toFixed(2)} / day (~${((Number(currentCost) / 730)).toFixed(4)} / hr)</div>
                  </div>

                  <div style={{ background: '#05080e', padding: '0.65rem 0.85rem', borderRadius: '0.4rem', border: '1px solid #1a2840' }}>
                    <div style={{ fontSize: '10px', color: '#64748b', textTransform: 'uppercase', fontWeight: 700 }}>Stored Model Weights</div>
                    <div style={{ fontSize: '13px', color: '#34d399', fontWeight: 800, marginTop: '0.15rem' }}>
                      {isUnified ? '103.5 GB / ' + vol.size + ' GB (~52%)' : '~37 GB / ' + vol.size + ' GB'}
                    </div>
                    <div style={{ fontSize: '10px', color: '#94a3b8' }}>
                      {isUnified ? 'LTX 2.5 (37 GB) + MiniMax H3 (66.5 GB)' : 'Dedicated model weights'}
                    </div>
                  </div>

                  <div style={{ background: '#05080e', padding: '0.65rem 0.85rem', borderRadius: '0.4rem', border: '1px solid #1a2840' }}>
                    <div style={{ fontSize: '10px', color: '#64748b', textTransform: 'uppercase', fontWeight: 700 }}>Sharing & Billing</div>
                    <div style={{ fontSize: '13px', color: '#c084fc', fontWeight: 800, marginTop: '0.15rem' }}>Simultaneous Multi-Mount</div>
                    <div style={{ fontSize: '10px', color: '#94a3b8' }}>Zero duplicate fees across pods</div>
                  </div>
                </div>
              </div>
            )
          })}
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

          {/* Auto-Shutdown Settings */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', background: '#05080e', border: '1px solid #1a2840', borderRadius: '0.5rem', padding: '0.4rem 0.8rem' }}>
            <span style={{ fontSize: '12px' }}>🛡️</span>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <span style={{ fontSize: '9.5px', color: '#64748b', textTransform: 'uppercase', fontWeight: 700 }}>Inactivity Protection</span>
              <span style={{ fontSize: '11px', color: '#4ade80', fontWeight: 700 }}>Auto-Terminate After:</span>
            </div>
            <select
              value={autoShutdownMinutes}
              onChange={(e) => handleUpdateAutoShutdown(Number(e.target.value))}
              style={{
                background: '#0a101d',
                border: '1px solid #2563eb',
                color: '#fff',
                padding: '0.25rem 0.5rem',
                borderRadius: '0.35rem',
                fontSize: '11px',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              <option value={3}>3 Minutes (Ultra Fast)</option>
              <option value={5}>5 Minutes (Recommended)</option>
              <option value={10}>10 Minutes</option>
              <option value={15}>15 Minutes</option>
              <option value={30}>30 Minutes</option>
            </select>
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
                  <th style={{ padding: '0.6rem 0.75rem' }}>Inactivity Protection</th>
                  <th style={{ padding: '0.6rem 0.75rem' }}>Hourly Compute</th>
                  <th style={{ padding: '0.6rem 0.75rem' }}>Disk Storage</th>
                  <th style={{ padding: '0.6rem 0.75rem', textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {pods.map((p) => {
                  const isRunning = p.status === 'RUNNING'
                  const isMiniMax = p.name?.toLowerCase().includes('minimax')
                  const idle = p.idleInfo
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
                      <td style={{ padding: '0.6rem 0.75rem' }}>
                        {isRunning ? (
                          <span style={{
                            padding: '0.2rem 0.5rem',
                            borderRadius: '0.3rem',
                            fontSize: '9.5px',
                            fontWeight: 700,
                            background: 'rgba(59, 130, 246, 0.12)',
                            color: '#60a5fa',
                            border: '1px solid rgba(59, 130, 246, 0.25)',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '0.3rem',
                          }}>
                            🛡️ {idle ? `Auto-terminates in ${Math.floor((idle.remainingSec || 0) / 60)}m ${(idle.remainingSec || 0) % 60}s` : `Active (${autoShutdownMinutes}m watchdog)`}
                          </span>
                        ) : (
                          <span style={{ fontSize: '10px', color: '#64748b' }}>—</span>
                        )}
                      </td>
                      <td style={{ padding: '0.6rem 0.75rem', color: isRunning ? '#4ade80' : '#64748b', fontWeight: 700 }}>
                        ${p.totalPerHr ? p.totalPerHr.toFixed(2) : (p.costPerHr ? p.costPerHr.toFixed(2) : '0.00')}/hr
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
