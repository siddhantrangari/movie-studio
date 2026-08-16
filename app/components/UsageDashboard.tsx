'use client'

import { useState, useEffect, useCallback } from 'react'

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
  }
}

export default function UsageDashboard() {
  const [data, setData] = useState<UsageData | null>(null)
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'all' | 'openai_prompt' | 'gpu_compute'>('all')

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
    const id = setInterval(fetchUsage, 10_000)
    return () => clearInterval(id)
  }, [fetchUsage])

  const analytics = data?.analytics
  const runpod = data?.runpod

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
            📊 Resource Usage & Cost Monitor
          </h2>
          <p style={{ fontSize: '12px', color: '#94a3b8', margin: '0.25rem 0 0' }}>
            Real-time tracking of OpenAI prompt token consumption, model charges, and RunPod GPU compute spend.
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
          <span>🔄</span> Refresh Usage
        </button>
      </div>

      {/* KPI Cards Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1rem' }}>
        {/* Card 1: Total OpenAI Tokens */}
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

        {/* Card 2: Estimated OpenAI Cost */}
        <div style={{ background: '#0a101d', border: '1px solid #1a2840', borderRadius: '0.75rem', padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
          <span style={{ fontSize: '10px', fontWeight: 800, textTransform: 'uppercase', color: 'var(--gold, #E8B94A)', letterSpacing: '0.06em' }}>
            OpenAI Est. Cost
          </span>
          <div style={{ fontSize: '24px', fontWeight: 900, color: 'var(--gold, #E8B94A)' }}>
            ${analytics ? analytics.totalOpenAiCost.toFixed(4) : '0.0000'}
          </div>
          <div style={{ fontSize: '11px', color: '#94a3b8' }}>
            {analytics ? analytics.totalPromptGenerations : 0} prompt requests logged
          </div>
        </div>

        {/* Card 3: RunPod Cloud Balance */}
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

        {/* Card 4: Active GPU Node */}
        <div style={{ background: '#0a101d', border: '1px solid #1a2840', borderRadius: '0.75rem', padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
          <span style={{ fontSize: '10px', fontWeight: 800, textTransform: 'uppercase', color: '#64748b', letterSpacing: '0.06em' }}>
            Active GPU Node
          </span>
          <div style={{ fontSize: '15px', fontWeight: 800, color: runpod?.activePod ? '#4ade80' : '#94a3b8' }}>
            {runpod?.activePod ? runpod.activePod.gpuDisplayName : 'Offline (Stopped)'}
          </div>
          <div style={{ fontSize: '11px', color: '#94a3b8' }}>
            {runpod?.activePod
              ? `Pod: ${runpod.activePod.name} ($${runpod.activePod.costPerHr}/hr)`
              : 'Zero active hourly GPU charges'}
          </div>
        </div>
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
