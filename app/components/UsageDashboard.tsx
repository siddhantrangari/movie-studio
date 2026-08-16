'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useToast } from './Toast'

type UsageRecord = {
  id: string
  timestamp: string
  category: 'openai_prompt' | 'gpu_compute' | 'video_gen'
  type: string
  model: string
  promptTokens?: number
  completionTokens?: number
  totalTokens?: number
  durationSeconds?: number
  costUsd: number
  details: string
}

type PodInfo = {
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

type UsageData = {
  analytics: {
    totalOpenAiTokens: number
    totalOpenAiPromptTokens: number
    totalOpenAiCompTokens: number
    totalOpenAiCost: number
    totalPromptGenerations: number
    totalGpuCost: number
    totalVideoGenerations: number
    modelBreakdown: Record<string, { count: number; tokens: number; cost: number }>
    recentRecords: UsageRecord[]
  }
  runpod: {
    accountBalance: number | null
    currentSpendPerHr: number | null
    activePod: {
      id: string
      name: string
      gpuDisplayName: string
      costPerHr: number
      status: string
    } | null
    pods: PodInfo[]
  }
}

type LogLine = { level: 'info' | 'ok' | 'warn' | 'error' | 'done'; text: string }

export default function UsageDashboard() {
  const { confirm: showConfirmModal, toast } = useToast()
  const [data, setData] = useState<UsageData | null>(null)
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'all' | 'openai_prompt' | 'gpu_compute'>('all')

  // Pod operation states
  const [activeAction, setActiveAction] = useState<string | null>(null)
  const [actionLogs, setActionLogs] = useState<LogLine[]>([])
  const [isPerformingAction, setIsPerformingAction] = useState(false)
  const [conflictPrompt, setConflictPrompt] = useState<{
    targetTier: 'standard' | 'ultra_4k'
    existingPod: PodInfo
  } | null>(null)

  const logEndRef = useRef<HTMLDivElement>(null)

  const fetchUsage = useCallback(async () => {
    try {
      const res = await fetch('/api/videogen/usage', { cache: 'no-store' })
      if (res.ok) {
        const json = await res.json()
        setData(json)
      }
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchUsage()
    const id = setInterval(fetchUsage, 8_000)
    return () => clearInterval(id)
  }, [fetchUsage])

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [actionLogs])

  // Stream pod operations
  const executePodOperation = async (
    action: 'up' | 'down' | 'stop' | 'start' | 'terminate',
    opts: { tier?: 'standard' | 'ultra_4k'; terminatePodId?: string; targetPodId?: string } = {}
  ) => {
    setIsPerformingAction(true)
    setActiveAction(action)
    setActionLogs([{ level: 'info', text: `Initiating ${action.toUpperCase()} action on GPU fleet...` }])

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
        const { value, done } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const rawLine of lines) {
          if (!rawLine.trim()) continue
          try {
            const parsed: LogLine = JSON.parse(rawLine)
            if (parsed.level === 'done') {
              // Operation completed
            } else {
              setActionLogs((prev) => [...prev, parsed])
            }
          } catch {
            // raw string fallback
          }
        }
      }

      await fetchUsage()
    } catch (e) {
      setActionLogs((prev) => [...prev, { level: 'error', text: (e as Error).message }])
    } finally {
      setIsPerformingAction(false)
      setActiveAction(null)
      fetchUsage()
    }
  }

  const handleDeployClick = (tier: 'standard' | 'ultra_4k') => {
    const runningPod = data?.runpod?.pods?.find((p) => p.status === 'RUNNING')
    if (runningPod) {
      setConflictPrompt({ targetTier: tier, existingPod: runningPod })
      return
    }
    executePodOperation('up', { tier })
  }

  const analytics = data?.analytics
  const runpod = data?.runpod
  const pods = runpod?.pods ?? []

  const filteredRecords = (analytics?.recentRecords ?? []).filter((r) => {
    if (filter === 'all') return true
    return r.category === filter
  })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem', maxWidth: '1280px', margin: '0 auto', width: '100%' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h2 style={{ fontSize: '20px', fontWeight: 800, color: 'var(--gold, #E8B94A)', margin: 0, letterSpacing: '0.02em' }}>
            📊 GPU Pod Management & Resource Monitor
          </h2>
          <p style={{ fontSize: '12px', color: '#94a3b8', margin: '0.25rem 0 0' }}>
            Direct control of RunPod GPU instances, hourly compute burn, and OpenAI prompt token ledger.
          </p>
        </div>

        <button
          onClick={fetchUsage}
          disabled={loading}
          style={{
            background: '#0e182e',
            border: '1px solid #1a2840',
            color: '#cbd5e1',
            borderRadius: '0.5rem',
            padding: '0.5rem 0.85rem',
            fontSize: '11px',
            fontWeight: 700,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '0.4rem',
          }}
        >
          <span>🔄</span> Refresh Fleet
        </button>
      </div>

      {/* KPI Cards Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1rem' }}>
        {/* Card 1: RunPod Cloud Balance */}
        <div style={{ background: '#0a101d', border: '1px solid #1a2840', borderRadius: '0.75rem', padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
          <span style={{ fontSize: '10px', fontWeight: 800, textTransform: 'uppercase', color: '#4ade80', letterSpacing: '0.06em' }}>
            RunPod Cloud Balance
          </span>
          <div style={{ fontSize: '24px', fontWeight: 900, color: '#4ade80' }}>
            {runpod?.accountBalance !== null && runpod?.accountBalance !== undefined
              ? `$${runpod.accountBalance.toFixed(2)}`
              : '—'}
          </div>
          <div style={{ fontSize: '11px', color: '#94a3b8' }}>
            Current burn: ${runpod?.currentSpendPerHr?.toFixed(2) || '0.00'}/hr
          </div>
        </div>

        {/* Card 2: Active GPU Node */}
        <div style={{ background: '#0a101d', border: '1px solid #1a2840', borderRadius: '0.75rem', padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
          <span style={{ fontSize: '10px', fontWeight: 800, textTransform: 'uppercase', color: 'var(--gold, #E8B94A)', letterSpacing: '0.06em' }}>
            Active Primary GPU
          </span>
          <div style={{ fontSize: '16px', fontWeight: 800, color: runpod?.activePod ? '#4ade80' : '#94a3b8' }}>
            {runpod?.activePod ? runpod.activePod.gpuDisplayName : 'Offline (No active pods)'}
          </div>
          <div style={{ fontSize: '11px', color: '#94a3b8' }}>
            {runpod?.activePod
              ? `Pod: ${runpod.activePod.name} ($${runpod.activePod.costPerHr}/hr)`
              : 'Zero active hourly compute charges'}
          </div>
        </div>

        {/* Card 3: Total OpenAI Tokens */}
        <div style={{ background: '#0a101d', border: '1px solid #1a2840', borderRadius: '0.75rem', padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
          <span style={{ fontSize: '10px', fontWeight: 800, textTransform: 'uppercase', color: '#64748b', letterSpacing: '0.06em' }}>
            Total OpenAI Tokens
          </span>
          <div style={{ fontSize: '24px', fontWeight: 900, color: '#F2F5FA' }}>
            {analytics ? analytics.totalOpenAiTokens.toLocaleString() : '—'}
          </div>
          <div style={{ fontSize: '11px', color: '#94a3b8' }}>
            📥 {analytics ? analytics.totalOpenAiPromptTokens.toLocaleString() : 0} in · 📤 {analytics ? analytics.totalOpenAiCompTokens.toLocaleString() : 0} out
          </div>
        </div>

        {/* Card 4: Estimated OpenAI Cost */}
        <div style={{ background: '#0a101d', border: '1px solid #1a2840', borderRadius: '0.75rem', padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
          <span style={{ fontSize: '10px', fontWeight: 800, textTransform: 'uppercase', color: 'var(--gold, #E8B94A)', letterSpacing: '0.06em' }}>
            OpenAI Model Spend
          </span>
          <div style={{ fontSize: '24px', fontWeight: 900, color: 'var(--gold, #E8B94A)' }}>
            ${analytics ? analytics.totalOpenAiCost.toFixed(4) : '0.0000'}
          </div>
          <div style={{ fontSize: '11px', color: '#94a3b8' }}>
            {analytics ? analytics.totalPromptGenerations : 0} prompt requests logged
          </div>
        </div>
      </div>

      {/* Conflict Dialog Modal when a pod is already running */}
      {conflictPrompt && (
        <div
          style={{
            background: '#121F35',
            border: '2px solid var(--gold, #E8B94A)',
            borderRadius: '0.75rem',
            padding: '1.5rem',
            display: 'flex',
            flexDirection: 'column',
            gap: '1rem',
            boxShadow: '0 10px 40px rgba(0,0,0,0.6)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <span style={{ fontSize: '1.5rem' }}>⚠️</span>
            <div>
              <h3 style={{ fontSize: '14px', fontWeight: 800, color: 'var(--gold, #E8B94A)', margin: 0 }}>
                Active GPU Pod Running
              </h3>
              <p style={{ fontSize: '11.5px', color: '#cbd5e1', margin: '0.2rem 0 0' }}>
                You already have a running node: <strong>{conflictPrompt.existingPod.gpuDisplayName}</strong> (ID: {conflictPrompt.existingPod.id}) billing at ${conflictPrompt.existingPod.costPerHr}/hr.
              </p>
            </div>
          </div>

          <p style={{ fontSize: '11.5px', color: '#94a3b8', margin: 0 }}>
            How would you like to proceed with deploying the <strong>{conflictPrompt.targetTier === 'ultra_4k' ? 'Ultra 4K (48GB/80GB)' : 'Standard (24GB)'}</strong> pod?
          </p>

          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
            <button
              onClick={() => {
                const targetTier = conflictPrompt.targetTier
                const termId = conflictPrompt.existingPod.id
                setConflictPrompt(null)
                executePodOperation('up', { tier: targetTier, terminatePodId: termId })
              }}
              style={{
                background: 'linear-gradient(135deg, #ef4444, #b91c1c)',
                color: '#fff',
                border: 'none',
                borderRadius: '0.4rem',
                padding: '0.65rem 1.25rem',
                fontSize: '11.5px',
                fontWeight: 800,
                cursor: 'pointer',
              }}
            >
              🛑 Terminate Running Pod & Deploy New Tier
            </button>

            <button
              onClick={() => {
                const targetTier = conflictPrompt.targetTier
                setConflictPrompt(null)
                executePodOperation('up', { tier: targetTier })
              }}
              style={{
                background: 'var(--gold, #E8B94A)',
                color: '#05080e',
                border: 'none',
                borderRadius: '0.4rem',
                padding: '0.65rem 1.25rem',
                fontSize: '11.5px',
                fontWeight: 800,
                cursor: 'pointer',
              }}
            >
              ⚡ Keep Running Pod & Deploy Alongside
            </button>

            <button
              onClick={() => setConflictPrompt(null)}
              style={{
                background: '#070c14',
                color: '#94a3b8',
                border: '1px solid #1a2840',
                borderRadius: '0.4rem',
                padding: '0.65rem 1rem',
                fontSize: '11.5px',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* GPU Fleet Management & Deploy Center */}
      <div style={{ background: '#0a101d', border: '1px solid #1a2840', borderRadius: '0.75rem', padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
          <div>
            <h3 style={{ fontSize: '14px', fontWeight: 800, color: 'var(--gold, #E8B94A)', margin: 0, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              🖥️ RunPod GPU Fleet & Compute Nodes
            </h3>
            <p style={{ fontSize: '11px', color: '#94a3b8', margin: '0.2rem 0 0' }}>
              Deploy, start, stop, and terminate dedicated GPU instances.
            </p>
          </div>

          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <button
              onClick={() => handleDeployClick('standard')}
              disabled={isPerformingAction}
              style={{
                background: 'linear-gradient(135deg, #1e3a8a, #0e182e)',
                border: '1px solid #3b82f6',
                color: '#93c5fd',
                borderRadius: '0.4rem',
                padding: '0.55rem 0.9rem',
                fontSize: '11px',
                fontWeight: 800,
                cursor: isPerformingAction ? 'not-allowed' : 'pointer',
              }}
            >
              🚀 Deploy Standard (24GB VRAM)
            </button>

            <button
              onClick={() => handleDeployClick('ultra_4k')}
              disabled={isPerformingAction}
              style={{
                background: 'linear-gradient(135deg, #E8B94A, #d97706)',
                color: '#05080e',
                border: 'none',
                borderRadius: '0.4rem',
                padding: '0.55rem 0.9rem',
                fontSize: '11px',
                fontWeight: 900,
                cursor: isPerformingAction ? 'not-allowed' : 'pointer',
              }}
            >
              🔥 Deploy Ultra 4K (48GB/80GB VRAM)
            </button>
          </div>
        </div>

        {/* Live Pods Table */}
        {pods.length === 0 ? (
          <div style={{ background: '#070c14', border: '1px dashed #1a2840', borderRadius: '0.5rem', padding: '2.5rem', textAlign: 'center', color: '#64748b' }}>
            <p style={{ fontSize: '1.5rem', margin: 0 }}>⚡</p>
            <p style={{ fontSize: '13px', fontWeight: 700, marginTop: '0.5rem', color: '#cbd5e1' }}>No GPU Pods currently provisioned on RunPod.</p>
            <p style={{ fontSize: '11px', color: '#64748b', margin: '0.2rem 0 0' }}>Deploy a Standard (24GB) or Ultra 4K (48GB/80GB) node above to start generating videos.</p>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11.5px', textAlign: 'left' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #1a2840', color: '#64748b', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  <th style={{ padding: '0.6rem 0.75rem' }}>Pod Name / ID</th>
                  <th style={{ padding: '0.6rem 0.75rem' }}>GPU Model</th>
                  <th style={{ padding: '0.6rem 0.75rem' }}>Status</th>
                  <th style={{ padding: '0.6rem 0.75rem' }}>Compute Rate</th>
                  <th style={{ padding: '0.6rem 0.75rem' }}>Storage</th>
                  <th style={{ padding: '0.6rem 0.75rem', textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {pods.map((p) => {
                  const isRunning = p.status === 'RUNNING'
                  return (
                    <tr key={p.id} style={{ borderBottom: '1px solid rgba(26,40,64,0.4)', color: '#cbd5e1' }}>
                      <td style={{ padding: '0.6rem 0.75rem', fontWeight: 700, color: '#F2F5FA' }}>
                        <div>{p.name}</div>
                        <div style={{ fontSize: '10px', color: '#64748b' }}>{p.id}</div>
                      </td>
                      <td style={{ padding: '0.6rem 0.75rem', fontWeight: 700, color: 'var(--gold, #E8B94A)' }}>
                        {p.gpuDisplayName}
                      </td>
                      <td style={{ padding: '0.6rem 0.75rem' }}>
                        <span style={{
                          padding: '0.2rem 0.5rem',
                          borderRadius: '0.3rem',
                          fontSize: '10px',
                          fontWeight: 800,
                          background: isRunning ? 'rgba(74,222,128,0.15)' : 'rgba(248,113,113,0.15)',
                          color: isRunning ? '#4ade80' : '#f87171',
                          border: isRunning ? '1px solid rgba(74,222,128,0.3)' : '1px solid rgba(248,113,113,0.3)',
                        }}>
                          {p.status}
                        </span>
                      </td>
                      <td style={{ padding: '0.6rem 0.75rem', fontWeight: 700 }}>
                        ${p.costPerHr.toFixed(2)}/hr
                      </td>
                      <td style={{ padding: '0.6rem 0.75rem', color: '#94a3b8' }}>
                        {p.diskGb} GB (${p.storagePerHr.toFixed(3)}/hr)
                      </td>
                      <td style={{ padding: '0.6rem 0.75rem', textAlign: 'right' }}>
                        <div style={{ display: 'flex', gap: '0.4rem', justifyContent: 'flex-end' }}>
                          {isRunning ? (
                            <button
                              onClick={() => executePodOperation('stop', { targetPodId: p.id })}
                              disabled={isPerformingAction}
                              style={{
                                background: '#0e182e',
                                border: '1px solid rgba(248,113,113,0.4)',
                                color: '#f87171',
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
                                background: '#0e182e',
                                border: '1px solid #4ade80',
                                color: '#4ade80',
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
                                message: `Permanently terminate and destroy pod ${p.id} (${p.gpuDisplayName})? This will halt all hourly compute & storage billing.`,
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
                                background: '#070c14',
                                border: '1px solid #1a2840',
                                color: '#cbd5e1',
                                borderRadius: '0.35rem',
                                padding: '0.35rem 0.55rem',
                                fontSize: '10.5px',
                                textDecoration: 'none',
                                fontWeight: 600,
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
            <div style={{ fontSize: '10px', color: 'var(--gold, #E8B94A)', fontWeight: 800, textTransform: 'uppercase', marginBottom: '0.2rem' }}>
              ⚡ Operation Log Stream {isPerformingAction && '(Active…)'}
            </div>
            {actionLogs.map((l, idx) => (
              <div
                key={idx}
                style={{
                  color: l.level === 'ok' ? '#4ade80' : l.level === 'warn' ? 'var(--gold)' : l.level === 'error' ? '#f87171' : '#cbd5e1',
                }}
              >
                {l.text}
              </div>
            ))}
            <div ref={logEndRef} />
          </div>
        )}
      </div>

      {/* Model Breakdown Section */}
      {analytics && Object.keys(analytics.modelBreakdown).length > 0 && (
        <div style={{ background: '#0a101d', border: '1px solid #1a2840', borderRadius: '0.75rem', padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <h3 style={{ fontSize: '13px', fontWeight: 800, color: 'var(--gold, #E8B94A)', margin: 0, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            OpenAI Model Consumption Breakdown
          </h3>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.75rem' }}>
            {Object.entries(analytics.modelBreakdown).map(([modelName, stats]) => (
              <div key={modelName} style={{ background: '#070c14', border: '1px solid #1a2840', borderRadius: '0.5rem', padding: '0.85rem' }}>
                <p style={{ fontWeight: 800, fontSize: '12px', color: '#fff', margin: 0 }}>⚡ {modelName}</p>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '0.4rem', fontSize: '11px', color: '#94a3b8' }}>
                  <span>Requests:</span>
                  <span style={{ color: '#F2F5FA', fontWeight: 700 }}>{stats.count}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '0.2rem', fontSize: '11px', color: '#94a3b8' }}>
                  <span>Tokens:</span>
                  <span style={{ color: '#F2F5FA', fontWeight: 700 }}>{stats.tokens.toLocaleString()}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '0.2rem', fontSize: '11px', color: '#94a3b8' }}>
                  <span>Est. Cost:</span>
                  <span style={{ color: 'var(--gold, #E8B94A)', fontWeight: 700 }}>${stats.cost.toFixed(5)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Activity Log Table */}
      <div style={{ background: '#0a101d', border: '1px solid #1a2840', borderRadius: '0.75rem', padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
          <h3 style={{ fontSize: '13px', fontWeight: 800, color: 'var(--gold, #E8B94A)', margin: 0, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Recent Consumption Activity Ledger
          </h3>

          <div style={{ display: 'flex', gap: '0.35rem', background: '#070c14', padding: '0.25rem', borderRadius: '0.4rem', border: '1px solid #1a2840' }}>
            {(
              [
                { id: 'all', label: 'All Activity' },
                { id: 'openai_prompt', label: 'AI Prompts' },
                { id: 'gpu_compute', label: 'GPU Sessions' },
              ] as const
            ).map((t) => (
              <button
                key={t.id}
                onClick={() => setFilter(t.id)}
                style={{
                  background: filter === t.id ? 'var(--gold, #E8B94A)' : 'transparent',
                  color: filter === t.id ? '#05080e' : '#94a3b8',
                  border: 'none',
                  borderRadius: '0.3rem',
                  padding: '0.25rem 0.55rem',
                  fontSize: '10.5px',
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {filteredRecords.length === 0 ? (
          <div style={{ padding: '2rem', textAlign: 'center', color: '#64748b', fontSize: '12px' }}>
            No consumption records logged yet. Try generating a prompt in the AI Director drawer!
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11.5px', textAlign: 'left' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #1a2840', color: '#64748b', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  <th style={{ padding: '0.6rem 0.75rem' }}>Timestamp</th>
                  <th style={{ padding: '0.6rem 0.75rem' }}>Type</th>
                  <th style={{ padding: '0.6rem 0.75rem' }}>Model / Hardware</th>
                  <th style={{ padding: '0.6rem 0.75rem' }}>Details</th>
                  <th style={{ padding: '0.6rem 0.75rem' }}>Tokens / Duration</th>
                  <th style={{ padding: '0.6rem 0.75rem', textAlign: 'right' }}>Est. Cost</th>
                </tr>
              </thead>
              <tbody>
                {filteredRecords.map((rec) => (
                  <tr key={rec.id} style={{ borderBottom: '1px solid rgba(26,40,64,0.4)', color: '#cbd5e1' }}>
                    <td style={{ padding: '0.6rem 0.75rem', color: '#64748b', whiteSpace: 'nowrap' }}>
                      {new Date(rec.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                    </td>
                    <td style={{ padding: '0.6rem 0.75rem', whiteSpace: 'nowrap' }}>
                      <span style={{
                        padding: '0.2rem 0.45rem',
                        borderRadius: '0.3rem',
                        fontSize: '9.5px',
                        fontWeight: 800,
                        textTransform: 'uppercase',
                        background: rec.category === 'openai_prompt' ? 'rgba(232,185,74,0.1)' : 'rgba(74,222,128,0.1)',
                        color: rec.category === 'openai_prompt' ? 'var(--gold, #E8B94A)' : '#4ade80',
                      }}>
                        {rec.type}
                      </span>
                    </td>
                    <td style={{ padding: '0.6rem 0.75rem', fontWeight: 700, color: '#F2F5FA', whiteSpace: 'nowrap' }}>
                      {rec.model}
                    </td>
                    <td style={{ padding: '0.6rem 0.75rem', maxWidth: '360px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {rec.details}
                    </td>
                    <td style={{ padding: '0.6rem 0.75rem', color: '#94a3b8', whiteSpace: 'nowrap' }}>
                      {rec.totalTokens ? `${rec.totalTokens.toLocaleString()} tokens` : '—'}
                    </td>
                    <td style={{ padding: '0.6rem 0.75rem', textAlign: 'right', fontWeight: 800, color: 'var(--gold, #E8B94A)', whiteSpace: 'nowrap' }}>
                      ${rec.costUsd.toFixed(5)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
