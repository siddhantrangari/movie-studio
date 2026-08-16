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
  resolution?: string
  clipSeconds?: number
  gpuModel?: string
  gpuHourlyRate?: number
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
    totalGpuRenderSeconds: number
    totalVideoGenerations: number
    totalPlatformCost: number
    unitEconomics?: {
      avgRenderSecondsPerClip: number
      avgGpuCostPerClip: number
      avgPromptTokensPerGen: number
      avgPromptCostPerGen: number
      avgTotalCostPerClip: number
      estCostPer1MinMovie: number
      estCostPer1HourFilm: number
    }
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

  const handleDeployClick = (tier: 'standard' | 'ultra_4k' | 'minimax') => {
    if (tier === 'minimax') {
      const runningMiniMax = data?.runpod?.pods?.find((p) => p.status === 'RUNNING' && p.name?.includes('minimax'))
      if (runningMiniMax) {
        toast.info(`MiniMax Hailuo 3 pod ${runningMiniMax.id} is already running.`)
        return
      }
      executePodOperation('up', { tier: 'ultra_4k', model: 'minimax' } as any)
      return
    }
    const runningPod = data?.runpod?.pods?.find((p) => p.status === 'RUNNING' && !p.name?.includes('minimax'))
    if (runningPod) {
      setConflictPrompt({ targetTier: tier, existingPod: runningPod })
      return
    }
    executePodOperation('up', { tier, model: 'ltx25' } as any)
  }

  // Infrastructure Simulator state
  const [simClips, setSimClips] = useState(2500)
  const [simTier, setSimTier] = useState<'standard' | 'ultra_4k'>('standard')
  const [simSeconds, setSimSeconds] = useState(6)

  const analytics = data?.analytics
  const runpod = data?.runpod
  const pods = runpod?.pods ?? []
  const unitEco = analytics?.unitEconomics

  const filteredRecords = (analytics?.recentRecords ?? []).filter((r) => {
    if (filter === 'all') return true
    return r.category === filter
  })

  // Simulator calculations
  const simRenderSecondsPerClip = simTier === 'ultra_4k' ? 58.0 : (unitEco?.avgRenderSecondsPerClip ?? 42.0)
  const simHourlyRate = simTier === 'ultra_4k' ? 1.64 : 0.34
  const simTotalGpuHours = Number(((simClips * simRenderSecondsPerClip) / 3600).toFixed(1))
  const simMonthlyGpuCost = Number((simTotalGpuHours * simHourlyRate).toFixed(2))
  const simMonthlyAiCost = Number((simClips * (unitEco?.avgPromptCostPerGen ?? 0.0022)).toFixed(2))
  const simTotalMonthlyCost = Number((simMonthlyGpuCost + simMonthlyAiCost).toFixed(2))
  const simCostPerClip = Number((simTotalMonthlyCost / Math.max(1, simClips)).toFixed(4))
  const simCostPer1Min = Number((simCostPerClip * 10).toFixed(3))
  const simCostPer1Hour = Number((simCostPer1Min * 60).toFixed(2))
  const simRequiredNodes = Math.max(1, Math.ceil((simTotalGpuHours / 30) / 20)) // 20h active cycle/day

  const exportTelemetryCsv = () => {
    const headers = ['Timestamp', 'Category', 'Type', 'Model_or_Hardware', 'Details', 'Duration_Secs', 'Clip_Secs', 'Tokens', 'Cost_USD']
    const rows = (analytics?.recentRecords ?? []).map((r) => [
      `"${r.timestamp}"`,
      `"${r.category}"`,
      `"${r.type}"`,
      `"${r.model || r.gpuModel || ''}"`,
      `"${(r.details || '').replace(/"/g, '""')}"`,
      r.durationSeconds ?? '',
      r.clipSeconds ?? '',
      r.totalTokens ?? '',
      r.costUsd.toFixed(5),
    ])

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map((e) => e.join(','))].join('\n')
    const encodedUri = encodeURI(csvContent)
    const link = document.createElement('a')
    link.setAttribute('href', encodedUri)
    link.setAttribute('download', `studio_gpu_telemetry_${Date.now()}.csv`)
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    toast.success('Telemetry CSV exported successfully!')
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem', maxWidth: '1280px', margin: '0 auto', width: '100%' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h2 style={{ fontSize: '20px', fontWeight: 800, color: 'var(--gold, #E8B94A)', margin: 0, letterSpacing: '0.02em' }}>
            📊 GPU Infrastructure, Telemetry & Cost Forecasting
          </h2>
          <p style={{ fontSize: '12px', color: '#94a3b8', margin: '0.25rem 0 0' }}>
            Live RunPod node fleet, generation latency tracking, unit economics, and infrastructure capacity simulator.
          </p>
        </div>

        <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center' }}>
          <button
            onClick={exportTelemetryCsv}
            style={{
              background: 'rgba(232,185,74,0.15)',
              border: '1px solid var(--gold, #E8B94A)',
              color: 'var(--gold, #E8B94A)',
              borderRadius: '0.5rem',
              padding: '0.5rem 0.85rem',
              fontSize: '11px',
              fontWeight: 800,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '0.4rem',
            }}
          >
            <span>📥</span> Export Telemetry (CSV)
          </button>

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
      </div>

      {/* KPI Cards Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem' }}>
        {/* Card 1: RunPod Cloud Balance */}
        <div style={{ background: '#0a101d', border: '1px solid #1a2840', borderRadius: '0.75rem', padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
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
        <div style={{ background: '#0a101d', border: '1px solid #1a2840', borderRadius: '0.75rem', padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
          <span style={{ fontSize: '10px', fontWeight: 800, textTransform: 'uppercase', color: 'var(--gold, #E8B94A)', letterSpacing: '0.06em' }}>
            Active GPU Node
          </span>
          <div style={{ fontSize: '15px', fontWeight: 800, color: runpod?.activePod ? '#4ade80' : '#94a3b8' }}>
            {runpod?.activePod ? runpod.activePod.gpuDisplayName : 'Offline (Zero Burn)'}
          </div>
          <div style={{ fontSize: '11px', color: '#94a3b8' }}>
            {runpod?.activePod
              ? `Pod: ${runpod.activePod.name} ($${runpod.activePod.costPerHr}/hr)`
              : 'Zero active hourly compute charges'}
          </div>
        </div>

        {/* Card 3: Avg Generation Latency */}
        <div style={{ background: '#0a101d', border: '1px solid #1a2840', borderRadius: '0.75rem', padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
          <span style={{ fontSize: '10px', fontWeight: 800, textTransform: 'uppercase', color: '#60a5fa', letterSpacing: '0.06em' }}>
            Avg GPU Render Time / Shot
          </span>
          <div style={{ fontSize: '24px', fontWeight: 900, color: '#60a5fa' }}>
            {unitEco?.avgRenderSecondsPerClip ?? 42}s
          </div>
          <div style={{ fontSize: '11px', color: '#94a3b8' }}>
            ~{unitEco?.avgRenderSecondsPerClip ? (unitEco.avgRenderSecondsPerClip / 6).toFixed(1) : 7.0}s GPU time per 1s video
          </div>
        </div>

        {/* Card 4: Avg Total Cost / Shot */}
        <div style={{ background: '#0a101d', border: '1px solid #1a2840', borderRadius: '0.75rem', padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
          <span style={{ fontSize: '10px', fontWeight: 800, textTransform: 'uppercase', color: 'var(--gold, #E8B94A)', letterSpacing: '0.06em' }}>
            Avg Unit Cost / Clip
          </span>
          <div style={{ fontSize: '24px', fontWeight: 900, color: 'var(--gold, #E8B94A)' }}>
            ${unitEco?.avgTotalCostPerClip ? unitEco.avgTotalCostPerClip.toFixed(4) : '0.0058'}
          </div>
          <div style={{ fontSize: '11px', color: '#94a3b8' }}>
            GPU: ${unitEco?.avgGpuCostPerClip?.toFixed(4) || '0.0040'} + AI: ${unitEco?.avgPromptCostPerGen?.toFixed(4) || '0.0018'}
          </div>
        </div>
      </div>

      {/* 🔮 Predictive Infrastructure & Scaling Cost Forecaster */}
      <div style={{ background: '#0a101d', border: '1px solid var(--gold, #E8B94A)', borderRadius: '0.75rem', padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.25rem', boxShadow: '0 10px 40px rgba(0,0,0,0.5)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span style={{ fontSize: '1.3rem' }}>🔮</span>
              <h3 style={{ fontSize: '15px', fontWeight: 900, color: 'var(--gold, #E8B94A)', margin: 0, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Infrastructure Capacity & Running Cost Forecaster
              </h3>
            </div>
            <p style={{ fontSize: '12px', color: '#cbd5e1', margin: '0.3rem 0 0' }}>
              Simulate future infrastructure costs, GPU node counts, and full movie production budgets based on your target scale.
            </p>
          </div>

          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            {(
              [
                { label: '100 Clips (Pilot)', count: 100 },
                { label: '1,000 Clips (Studio)', count: 1000 },
                { label: '10,000 Clips (Scale)', count: 10000 },
                { label: '50,000 Clips (Enterprise)', count: 50000 },
              ] as const
            ).map((preset) => (
              <button
                key={preset.count}
                onClick={() => setSimClips(preset.count)}
                style={{
                  background: simClips === preset.count ? 'var(--gold, #E8B94A)' : '#070c14',
                  color: simClips === preset.count ? '#05080e' : '#cbd5e1',
                  border: '1px solid #1a2840',
                  borderRadius: '0.4rem',
                  padding: '0.35rem 0.65rem',
                  fontSize: '11px',
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>

        {/* Interactive Controls Bar */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1.25rem', background: '#070c14', padding: '1.25rem', borderRadius: '0.65rem', border: '1px solid #1a2840' }}>
          {/* Slider: Monthly Target Generations */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', fontWeight: 800 }}>
              <span style={{ color: '#94a3b8' }}>Target Video Clips / Month:</span>
              <span style={{ color: 'var(--gold, #E8B94A)' }}>{simClips.toLocaleString()} clips</span>
            </div>
            <input
              type="range"
              min="50"
              max="50000"
              step="50"
              value={simClips}
              onChange={(e) => setSimClips(Number(e.target.value))}
              style={{ width: '100%', accentColor: 'var(--gold, #E8B94A)', cursor: 'pointer' }}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '9.5px', color: '#64748b' }}>
              <span>50 clips</span>
              <span>25,000 clips</span>
              <span>50,000 clips</span>
            </div>
          </div>

          {/* Select: GPU Hardware Tier */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
            <label style={{ fontSize: '11px', fontWeight: 800, color: '#94a3b8' }}>Hardware Tier / GPU Target:</label>
            <select
              value={simTier}
              onChange={(e) => setSimTier(e.target.value as 'standard' | 'ultra_4k')}
              style={{
                background: '#0e182e',
                border: '1px solid #1a2840',
                borderRadius: '0.4rem',
                color: '#fff',
                padding: '0.45rem',
                fontSize: '11.5px',
                fontWeight: 700,
              }}
            >
              <option value="standard">⚡ Standard 24GB (RTX 4090 / L40S @ $0.34/hr)</option>
              <option value="ultra_4k">🔥 Ultra 4K 80GB (NVIDIA A100 / SXM4 @ $1.64/hr)</option>
            </select>
          </div>

          {/* Select: Average Clip Seconds */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
            <label style={{ fontSize: '11px', fontWeight: 800, color: '#94a3b8' }}>Avg Clip Duration:</label>
            <select
              value={simSeconds}
              onChange={(e) => setSimSeconds(Number(e.target.value))}
              style={{
                background: '#0e182e',
                border: '1px solid #1a2840',
                borderRadius: '0.4rem',
                color: '#fff',
                padding: '0.45rem',
                fontSize: '11.5px',
                fontWeight: 700,
              }}
            >
              <option value={6}>6 Seconds (Standard Cinematics)</option>
              <option value={8}>8 Seconds (Extended Narrative)</option>
              <option value={10}>10 Seconds (Full Scene Transition)</option>
            </select>
          </div>
        </div>

        {/* Prediction Results Matrix */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.85rem' }}>
          <div style={{ background: '#070c14', border: '1px solid #1a2840', borderRadius: '0.5rem', padding: '1rem' }}>
            <div style={{ fontSize: '10px', color: '#94a3b8', textTransform: 'uppercase', fontWeight: 800 }}>Projected GPU Hours</div>
            <div style={{ fontSize: '20px', fontWeight: 900, color: '#60a5fa', marginTop: '0.2rem' }}>
              {simTotalGpuHours.toLocaleString()} hrs
            </div>
            <div style={{ fontSize: '10.5px', color: '#64748b', marginTop: '0.2rem' }}>
              ~{(simTotalGpuHours / 30).toFixed(1)} GPU hrs / day
            </div>
          </div>

          <div style={{ background: '#070c14', border: '1px solid #1a2840', borderRadius: '0.5rem', padding: '1rem' }}>
            <div style={{ fontSize: '10px', color: '#94a3b8', textTransform: 'uppercase', fontWeight: 800 }}>Monthly GPU Cloud Cost</div>
            <div style={{ fontSize: '20px', fontWeight: 900, color: '#4ade80', marginTop: '0.2rem' }}>
              ${simMonthlyGpuCost.toLocaleString()}
            </div>
            <div style={{ fontSize: '10.5px', color: '#64748b', marginTop: '0.2rem' }}>
              @ ${simHourlyRate}/hr compute rate
            </div>
          </div>

          <div style={{ background: '#070c14', border: '1px solid #1a2840', borderRadius: '0.5rem', padding: '1rem' }}>
            <div style={{ fontSize: '10px', color: '#94a3b8', textTransform: 'uppercase', fontWeight: 800 }}>Monthly AI Script Tokens</div>
            <div style={{ fontSize: '20px', fontWeight: 900, color: '#c084fc', marginTop: '0.2rem' }}>
              ${simMonthlyAiCost.toLocaleString()}
            </div>
            <div style={{ fontSize: '10.5px', color: '#64748b', marginTop: '0.2rem' }}>
              ~{((simClips * 1850) / 1000000).toFixed(2)}M GPT-5.6 Luna tokens
            </div>
          </div>

          <div style={{ background: '#070c14', border: '1px solid var(--gold, #E8B94A)', borderRadius: '0.5rem', padding: '1rem' }}>
            <div style={{ fontSize: '10px', color: 'var(--gold, #E8B94A)', textTransform: 'uppercase', fontWeight: 800 }}>Total Monthly Run Cost</div>
            <div style={{ fontSize: '22px', fontWeight: 900, color: 'var(--gold, #E8B94A)', marginTop: '0.2rem' }}>
              ${simTotalMonthlyCost.toLocaleString()}
            </div>
            <div style={{ fontSize: '10.5px', color: '#cbd5e1', marginTop: '0.2rem' }}>
              ${simCostPerClip.toFixed(4)} / video clip
            </div>
          </div>
        </div>

        {/* Film Production Unit Economics Box */}
        <div style={{ background: 'rgba(232,185,74,0.06)', border: '1px dashed var(--gold, #E8B94A)', borderRadius: '0.65rem', padding: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
          <div>
            <div style={{ fontSize: '12px', fontWeight: 800, color: 'var(--gold, #E8B94A)' }}>
              🎬 Full Movie Production Unit Economics:
            </div>
            <div style={{ fontSize: '11px', color: '#cbd5e1', marginTop: '0.2rem' }}>
              • <strong>1-Minute Master Film</strong> (10 shots + AI Script + Audio): <span style={{ color: '#4ade80', fontWeight: 800 }}>${simCostPer1Min.toFixed(3)}</span>
              &nbsp;&nbsp;|&nbsp;&nbsp;
              • <strong>1-Hour Continuous Feature Movie</strong> (600 shots): <span style={{ color: '#4ade80', fontWeight: 800 }}>${simCostPer1Hour.toFixed(2)}</span>
            </div>
          </div>

          <div style={{ fontSize: '11px', color: '#94a3b8' }}>
            Recommended Concurrency: <strong style={{ color: '#F2F5FA' }}>{simRequiredNodes} Pod{simRequiredNodes > 1 ? 's' : ''}</strong> (Handles {Math.round(simClips / 30)} clips/day)
          </div>
        </div>
      </div>

      {/* GPU Fleet Section */}
      <div style={{ background: '#0a101d', border: '1px solid #1a2840', borderRadius: '0.75rem', padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
              <h3 style={{ fontSize: '14px', fontWeight: 800, color: 'var(--gold, #E8B94A)', margin: 0, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                🖥️ RunPod GPU Fleet & Compute Nodes ({pods.length})
              </h3>
              <span style={{ fontSize: '10.5px', color: '#94a3b8', background: '#070c14', padding: '0.2rem 0.5rem', borderRadius: '0.35rem', border: '1px solid #1a2840' }}>
                Auto-syncing
              </span>
            </div>
            <p style={{ fontSize: '11px', color: '#64748b', margin: '0.25rem 0 0' }}>
              Individual pod controls. Start, stop, or terminate any pod without entering the cloud console.
            </p>
          </div>

          {/* Quick Deploy Buttons */}
          <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
            <button
              onClick={() => handleDeployClick('standard')}
              disabled={isPerformingAction}
              style={{
                background: 'linear-gradient(135deg, #10b981, #059669)',
                color: '#fff',
                border: 'none',
                borderRadius: '0.4rem',
                padding: '0.5rem 0.85rem',
                fontSize: '11px',
                fontWeight: 800,
                cursor: isPerformingAction ? 'not-allowed' : 'pointer',
                boxShadow: '0 4px 12px rgba(16, 185, 129, 0.3)',
              }}
            >
              🚀 Deploy LTX Standard (24GB)
            </button>

            <button
              onClick={() => handleDeployClick('ultra_4k')}
              disabled={isPerformingAction}
              style={{
                background: 'linear-gradient(135deg, #f59e0b, #d97706)',
                color: '#05080e',
                border: 'none',
                borderRadius: '0.4rem',
                padding: '0.5rem 0.85rem',
                fontSize: '11px',
                fontWeight: 900,
                cursor: isPerformingAction ? 'not-allowed' : 'pointer',
                boxShadow: '0 4px 12px rgba(245, 158, 11, 0.3)',
              }}
            >
              🔥 Deploy LTX Ultra 4K (48GB)
            </button>

            <button
              onClick={() => handleDeployClick('minimax')}
              disabled={isPerformingAction}
              style={{
                background: 'linear-gradient(135deg, #a855f7, #7c3aed)',
                color: '#fff',
                border: 'none',
                borderRadius: '0.4rem',
                padding: '0.5rem 0.85rem',
                fontSize: '11px',
                fontWeight: 900,
                cursor: isPerformingAction ? 'not-allowed' : 'pointer',
                boxShadow: '0 4px 12px rgba(168, 85, 247, 0.35)',
              }}
            >
              🟣 Deploy MiniMax Hailuo 3 (48GB+)
            </button>
          </div>
        </div>

        {/* Fleet Table */}
        {pods.length === 0 ? (
          <div style={{ padding: '2rem', textAlign: 'center', color: '#64748b', fontSize: '12px', background: '#070c14', borderRadius: '0.5rem', border: '1px solid #1a2840' }}>
            No GPU pods deployed on your RunPod account. Click one of the buttons above to deploy on demand!
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

      {/* Activity & Telemetry Log Table */}
      <div style={{ background: '#0a101d', border: '1px solid #1a2840', borderRadius: '0.75rem', padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
          <div>
            <h3 style={{ fontSize: '13px', fontWeight: 800, color: 'var(--gold, #E8B94A)', margin: 0, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Recent Generation Telemetry & Consumption Ledger
            </h3>
            <p style={{ fontSize: '11px', color: '#64748b', margin: '0.2rem 0 0' }}>
              Exact render duration, GPU hardware, and calculated costs for all generated clips and AI prompts.
            </p>
          </div>

          <div style={{ display: 'flex', gap: '0.35rem', background: '#070c14', padding: '0.25rem', borderRadius: '0.4rem', border: '1px solid #1a2840' }}>
            {(
              [
                { id: 'all', label: 'All Telemetry' },
                { id: 'gpu_compute', label: '🎬 GPU Video Renders' },
                { id: 'openai_prompt', label: '🧠 AI Prompts' },
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
            No telemetry records logged yet. Generate video clips or prompts to populate this ledger!
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11.5px', textAlign: 'left' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #1a2840', color: '#64748b', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  <th style={{ padding: '0.6rem 0.75rem' }}>Timestamp</th>
                  <th style={{ padding: '0.6rem 0.75rem' }}>Category</th>
                  <th style={{ padding: '0.6rem 0.75rem' }}>Model / GPU</th>
                  <th style={{ padding: '0.6rem 0.75rem' }}>Shot Details / Prompt</th>
                  <th style={{ padding: '0.6rem 0.75rem' }}>GPU Time / Tokens</th>
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
                        {rec.type || rec.category}
                      </span>
                    </td>
                    <td style={{ padding: '0.6rem 0.75rem', fontWeight: 700, color: '#F2F5FA', whiteSpace: 'nowrap' }}>
                      {rec.model || rec.gpuModel || 'LTX-Video 2.5'}
                    </td>
                    <td style={{ padding: '0.6rem 0.75rem', maxWidth: '360px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {rec.details}
                    </td>
                    <td style={{ padding: '0.6rem 0.75rem', color: '#94a3b8', whiteSpace: 'nowrap' }}>
                      {rec.durationSeconds ? `⏱️ ${rec.durationSeconds}s GPU render` : rec.totalTokens ? `🧠 ${rec.totalTokens.toLocaleString()} tokens` : '—'}
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
