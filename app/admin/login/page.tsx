'use client'

import { useState, FormEvent } from 'react'
import { useRouter } from 'next/navigation'

export default function AdminLogin() {
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')

    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      })

      if (res.ok) {
        router.push('/admin/dashboard')
      } else {
        setError('Access Denied: Invalid Credentials')
        setPassword('')
      }
    } catch {
      setError('Server Error. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main 
      className="grid-bg"
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1.5rem',
        background: 'var(--navy)',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* Background Glow Orbs */}
      <div className="orb animate-pulse-glow" style={{ top: '25%', left: '25%', width: '40vw', height: '40vw', background: 'var(--gold)', opacity: 0.04 }} />

      <div 
        className="glow-card"
        style={{
          width: '100%',
          maxWidth: '380px',
          borderRadius: '1.25rem',
          border: '1px solid rgba(255, 255, 255, 0.06)',
          background: 'rgba(14, 23, 38, 0.75)',
          backdropFilter: 'blur(16px)',
          padding: '2.5rem 2rem',
          boxShadow: '0 20px 50px rgba(0, 0, 0, 0.5)',
          position: 'relative',
          zIndex: 10,
        }}
      >
        {/* Top Status Header */}
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '1.5rem' }}>
          <span style={{
            fontSize: '9px',
            fontFamily: 'monospace',
            textTransform: 'uppercase',
            letterSpacing: '0.12em',
            padding: '0.25rem 0.6rem',
            borderRadius: '9999px',
            background: 'rgba(232, 185, 74, 0.08)',
            border: '1px solid rgba(232, 185, 74, 0.2)',
            color: 'var(--gold)',
            display: 'flex',
            alignItems: 'center',
            gap: '5px',
          }}>
            <span className="ping-dot" style={{ width: '5px', height: '5px' }}></span>
            Secured Admin Terminal
          </span>
        </div>

        {/* Brand Header */}
        <div style={{ textAlign: 'center', marginBottom: '2.25rem' }}>
          <h2 style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 700,
            fontSize: '1.25rem',
            color: 'var(--white)',
            letterSpacing: '0.05em',
          }}>
            SIDDHANT RANGARI
          </h2>
          <p style={{
            fontSize: '10px',
            color: '#64748b',
            textTransform: 'uppercase',
            fontWeight: 600,
            marginTop: '0.25rem',
            letterSpacing: '0.08em',
          }}>
            Identity Access Control
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div>
            <input
              type="password"
              placeholder="Enter Access Key"
              value={password}
              onChange={e => setPassword(e.target.value)}
              autoComplete="current-password"
              style={{
                width: '100%',
                padding: '0.85rem 1rem',
                borderRadius: '0.75rem',
                fontSize: '13px',
                outline: 'none',
                background: '#070c14',
                border: '1px solid #1a2840',
                color: 'var(--white)',
                transition: 'all 0.3s',
                fontFamily: 'monospace',
                letterSpacing: '0.1em',
              }}
              onFocus={(e) => (e.target.style.borderColor = 'var(--gold)')}
              onBlur={(e) => (e.target.style.borderColor = '#1a2840')}
            />
          </div>

          {error && (
            <p style={{
              fontSize: '11px',
              color: '#f87171',
              fontFamily: 'monospace',
              margin: '0',
              textAlign: 'center',
            }}>
              🚨 {error}
            </p>
          )}

          <button 
            type="submit" 
            disabled={loading}
            style={{
              width: '100%',
              padding: '0.85rem',
              borderRadius: '0.75rem',
              fontWeight: 700,
              fontSize: '13px',
              border: 'none',
              background: 'var(--gold)',
              color: 'var(--navy)',
              cursor: 'pointer',
              transition: 'all 0.25s',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 4px 12px rgba(232, 185, 74, 0.15)',
            }}
            onMouseEnter={(e) => {
              if (!loading) {
                e.currentTarget.style.transform = 'translateY(-1px)';
                e.currentTarget.style.boxShadow = '0 6px 16px rgba(232, 185, 74, 0.25)';
              }
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'none';
              e.currentTarget.style.boxShadow = '0 4px 12px rgba(232, 185, 74, 0.15)';
            }}
          >
            {loading ? 'Decrypting Access Key...' : 'Establish Session'}
          </button>
        </form>

        <p style={{ marginTop: '2rem', textAlign: 'center', fontSize: '11px' }}>
          <a href="/" style={{ color: '#64748b', transition: 'color 0.2s' }} onMouseEnter={(e) => (e.currentTarget.style.color = '#ffffff')} onMouseLeave={(e) => (e.currentTarget.style.color = '#64748b')}>
            ← Return to Main Deck
          </a>
        </p>
      </div>
    </main>
  )
}
