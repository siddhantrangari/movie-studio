'use client'

import { useState, FormEvent } from 'react'
import { useRouter } from 'next/navigation'

type AuthMode = 'login' | 'signup' | 'forgot'

export default function AdminLogin() {
  const [mode, setMode] = useState<AuthMode>('login')

  // Form states
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [showPassword, setShowPassword] = useState(false)

  // Forgot password states
  const [forgotStep, setForgotStep] = useState<'request' | 'reset'>('request')
  const [resetToken, setResetToken] = useState('')
  const [newPassword, setNewPassword] = useState('')

  // UI state
  const [error, setError] = useState('')
  const [successMsg, setSuccessMsg] = useState('')
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  async function handleLogin(e: FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    setSuccessMsg('')

    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })

      const data = await res.json()

      if (res.ok) {
        router.push('/movie')
      } else {
        setError(data.error || 'Access Denied: Invalid Credentials')
      }
    } catch {
      setError('Server Connection Error. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  async function handleSignup(e: FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    setSuccessMsg('')

    try {
      const res = await fetch('/api/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, name }),
      })

      const data = await res.json()

      if (res.ok) {
        setSuccessMsg(data.message)
        if (data.status === 'approved') {
          setTimeout(() => router.push('/movie'), 1500)
        } else {
          setMode('login')
          setPassword('')
        }
      } else {
        setError(data.error || 'Registration failed.')
      }
    } catch {
      setError('Server Error during registration.')
    } finally {
      setLoading(false)
    }
  }

  async function handleForgotRequest(e: FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    setSuccessMsg('')

    try {
      const res = await fetch('/api/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'request', email }),
      })

      const data = await res.json()
      if (res.ok) {
        setSuccessMsg(data.message)
        if (data.resetToken) {
          setResetToken(data.resetToken)
          setForgotStep('reset')
        }
      } else {
        setError(data.error || 'Failed to request reset.')
      }
    } catch {
      setError('Server Error.')
    } finally {
      setLoading(false)
    }
  }

  async function handleForgotReset(e: FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    setSuccessMsg('')

    try {
      const res = await fetch('/api/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reset', token: resetToken, newPassword }),
      })

      const data = await res.json()
      if (res.ok) {
        setSuccessMsg(data.message)
        setTimeout(() => {
          setMode('login')
          setForgotStep('request')
          setPassword('')
        }, 1500)
      } else {
        setError(data.error || 'Failed to update password.')
      }
    } catch {
      setError('Server Error.')
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
        background: '#05080e',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* Glow Orbs */}
      <div
        className="orb animate-pulse-glow"
        style={{
          top: '25%',
          left: '25%',
          width: '40vw',
          height: '40vw',
          background: 'var(--gold)',
          opacity: 0.04,
        }}
      />

      <div
        className="glow-card"
        style={{
          width: '100%',
          maxWidth: '420px',
          borderRadius: '1.25rem',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          background: 'rgba(14, 23, 38, 0.85)',
          backdropFilter: 'blur(20px)',
          padding: '2.5rem 2rem',
          boxShadow: '0 25px 60px rgba(0, 0, 0, 0.6)',
          position: 'relative',
          zIndex: 10,
        }}
      >
        {/* Header Badge */}
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '1.25rem' }}>
          <span
            style={{
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
              gap: '6px',
            }}
          >
            <span className="ping-dot" style={{ width: '5px', height: '5px' }}></span>
            🌌 Veo Studio Cinema Engine
          </span>
        </div>

        {/* Brand Header */}
        <div style={{ textAlign: 'center', marginBottom: '1.75rem' }}>
          <h2
            style={{
              fontFamily: 'var(--font-display)',
              fontWeight: 700,
              fontSize: '1.5rem',
              color: 'var(--gold)',
              letterSpacing: '0.06em',
            }}
          >
            VEO STUDIO
          </h2>
          <p
            style={{
              fontSize: '11px',
              color: '#64748b',
              textTransform: 'uppercase',
              fontWeight: 600,
              marginTop: '0.25rem',
              letterSpacing: '0.08em',
            }}
          >
            {mode === 'login' && 'Sign in to access your cinema workspace'}
            {mode === 'signup' && 'Create your Studio account'}
            {mode === 'forgot' && 'Reset your password'}
          </p>
        </div>

        {/* Auth Mode Tabs */}
        <div
          style={{
            display: 'flex',
            background: 'rgba(7, 12, 20, 0.8)',
            borderRadius: '0.75rem',
            padding: '3px',
            marginBottom: '1.5rem',
            border: '1px solid rgba(255, 255, 255, 0.05)',
          }}
        >
          <button
            type="button"
            onClick={() => {
              setMode('login')
              setError('')
              setSuccessMsg('')
            }}
            style={{
              flex: 1,
              padding: '0.5rem',
              fontSize: '11px',
              fontWeight: 700,
              borderRadius: '0.5rem',
              border: 'none',
              cursor: 'pointer',
              background: mode === 'login' ? 'var(--gold)' : 'transparent',
              color: mode === 'login' ? '#070c14' : '#94a3b8',
              transition: 'all 0.2s',
            }}
          >
            Sign In
          </button>
          <button
            type="button"
            onClick={() => {
              setMode('signup')
              setError('')
              setSuccessMsg('')
            }}
            style={{
              flex: 1,
              padding: '0.5rem',
              fontSize: '11px',
              fontWeight: 700,
              borderRadius: '0.5rem',
              border: 'none',
              cursor: 'pointer',
              background: mode === 'signup' ? 'var(--gold)' : 'transparent',
              color: mode === 'signup' ? '#070c14' : '#94a3b8',
              transition: 'all 0.2s',
            }}
          >
            Create Account
          </button>
        </div>

        {/* Notifications */}
        {error && (
          <div
            style={{
              padding: '0.75rem 1rem',
              borderRadius: '0.75rem',
              background: 'rgba(239, 68, 68, 0.1)',
              border: '1px solid rgba(239, 68, 68, 0.3)',
              color: '#f87171',
              fontSize: '11px',
              marginBottom: '1.25rem',
              textAlign: 'center',
              lineHeight: '1.4',
            }}
          >
            🚨 {error}
          </div>
        )}

        {successMsg && (
          <div
            style={{
              padding: '0.75rem 1rem',
              borderRadius: '0.75rem',
              background: 'rgba(34, 197, 94, 0.1)',
              border: '1px solid rgba(34, 197, 94, 0.3)',
              color: '#4ade80',
              fontSize: '11px',
              marginBottom: '1.25rem',
              textAlign: 'center',
              lineHeight: '1.4',
            }}
          >
            ✅ {successMsg}
          </div>
        )}

        {/* LOGIN FORM */}
        {mode === 'login' && (
          <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div>
              <label style={{ display: 'block', fontSize: '10px', color: '#94a3b8', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Email Address
              </label>
              <input
                type="email"
                placeholder="name@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                style={{
                  width: '100%',
                  padding: '0.75rem 1rem',
                  borderRadius: '0.75rem',
                  fontSize: '13px',
                  outline: 'none',
                  background: '#070c14',
                  border: '1px solid #1a2840',
                  color: 'var(--white)',
                  transition: 'all 0.3s',
                }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '10px', color: '#94a3b8', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Password
              </label>
              <div style={{ position: 'relative' }}>
                <input
                  type={showPassword ? 'text' : 'password'}
                  placeholder="••••••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  style={{
                    width: '100%',
                    padding: '0.75rem 2.5rem 0.75rem 1rem',
                    borderRadius: '0.75rem',
                    fontSize: '13px',
                    outline: 'none',
                    background: '#070c14',
                    border: '1px solid #1a2840',
                    color: 'var(--white)',
                    transition: 'all 0.3s',
                  }}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  style={{
                    position: 'absolute',
                    right: '10px',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    background: 'none',
                    border: 'none',
                    color: '#64748b',
                    cursor: 'pointer',
                    fontSize: '13px',
                  }}
                >
                  {showPassword ? '🙈' : '👁️'}
                </button>
              </div>
            </div>

            <div style={{ textAlign: 'right' }}>
              <button
                type="button"
                onClick={() => {
                  setMode('forgot')
                  setError('')
                  setSuccessMsg('')
                }}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#64748b',
                  fontSize: '11px',
                  cursor: 'pointer',
                }}
              >
                Forgot password?
              </button>
            </div>

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
                color: '#070c14',
                cursor: 'pointer',
                transition: 'all 0.25s',
                boxShadow: '0 4px 12px rgba(232, 185, 74, 0.15)',
              }}
            >
              {loading ? 'Authenticating...' : 'Connect to Studio'}
            </button>
          </form>
        )}

        {/* SIGNUP FORM */}
        {mode === 'signup' && (
          <form onSubmit={handleSignup} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div>
              <label style={{ display: 'block', fontSize: '10px', color: '#94a3b8', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Full Name
              </label>
              <input
                type="text"
                placeholder="Alex Mercer"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                style={{
                  width: '100%',
                  padding: '0.75rem 1rem',
                  borderRadius: '0.75rem',
                  fontSize: '13px',
                  outline: 'none',
                  background: '#070c14',
                  border: '1px solid #1a2840',
                  color: 'var(--white)',
                }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '10px', color: '#94a3b8', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Email Address
              </label>
              <input
                type="email"
                placeholder="alex@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                style={{
                  width: '100%',
                  padding: '0.75rem 1rem',
                  borderRadius: '0.75rem',
                  fontSize: '13px',
                  outline: 'none',
                  background: '#070c14',
                  border: '1px solid #1a2840',
                  color: 'var(--white)',
                }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '10px', color: '#94a3b8', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Password
              </label>
              <div style={{ position: 'relative' }}>
                <input
                  type={showPassword ? 'text' : 'password'}
                  placeholder="At least 6 characters"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  style={{
                    width: '100%',
                    padding: '0.75rem 2.5rem 0.75rem 1rem',
                    borderRadius: '0.75rem',
                    fontSize: '13px',
                    outline: 'none',
                    background: '#070c14',
                    border: '1px solid #1a2840',
                    color: 'var(--white)',
                  }}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  style={{
                    position: 'absolute',
                    right: '10px',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    background: 'none',
                    border: 'none',
                    color: '#64748b',
                    cursor: 'pointer',
                    fontSize: '13px',
                  }}
                >
                  {showPassword ? '🙈' : '👁️'}
                </button>
              </div>
            </div>

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
                color: '#070c14',
                cursor: 'pointer',
                marginTop: '0.5rem',
              }}
            >
              {loading ? 'Creating Account...' : 'Request Account Access'}
            </button>
          </form>
        )}

        {/* FORGOT PASSWORD FORM */}
        {mode === 'forgot' && (
          <div>
            {forgotStep === 'request' ? (
              <form onSubmit={handleForgotRequest} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '10px', color: '#94a3b8', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    Registered Email Address
                  </label>
                  <input
                    type="email"
                    placeholder="name@company.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    style={{
                      width: '100%',
                      padding: '0.75rem 1rem',
                      borderRadius: '0.75rem',
                      fontSize: '13px',
                      outline: 'none',
                      background: '#070c14',
                      border: '1px solid #1a2840',
                      color: 'var(--white)',
                    }}
                  />
                </div>
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
                    color: '#070c14',
                    cursor: 'pointer',
                  }}
                >
                  {loading ? 'Generating...' : 'Request Reset Token'}
                </button>
              </form>
            ) : (
              <form onSubmit={handleForgotReset} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '10px', color: '#94a3b8', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    Reset Token
                  </label>
                  <input
                    type="text"
                    value={resetToken}
                    onChange={(e) => setResetToken(e.target.value)}
                    required
                    style={{
                      width: '100%',
                      padding: '0.75rem 1rem',
                      borderRadius: '0.75rem',
                      fontSize: '13px',
                      outline: 'none',
                      background: '#070c14',
                      border: '1px solid #1a2840',
                      color: 'var(--white)',
                      fontFamily: 'monospace',
                    }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '10px', color: '#94a3b8', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    New Password
                  </label>
                  <input
                    type="password"
                    placeholder="New password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    required
                    style={{
                      width: '100%',
                      padding: '0.75rem 1rem',
                      borderRadius: '0.75rem',
                      fontSize: '13px',
                      outline: 'none',
                      background: '#070c14',
                      border: '1px solid #1a2840',
                      color: 'var(--white)',
                    }}
                  />
                </div>

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
                    color: '#070c14',
                    cursor: 'pointer',
                  }}
                >
                  {loading ? 'Updating...' : 'Set New Password'}
                </button>
              </form>
            )}

            <div style={{ textAlign: 'center', marginTop: '1rem' }}>
              <button
                type="button"
                onClick={() => setMode('login')}
                style={{ background: 'none', border: 'none', color: '#64748b', fontSize: '11px', cursor: 'pointer' }}
              >
                ← Back to Login
              </button>
            </div>
          </div>
        )}

        <p style={{ marginTop: '1.75rem', textAlign: 'center', fontSize: '11px' }}>
          <a
            href="/"
            style={{ color: '#64748b', transition: 'color 0.2s', textDecoration: 'none' }}
            onMouseEnter={(e) => (e.currentTarget.style.color = '#ffffff')}
            onMouseLeave={(e) => (e.currentTarget.style.color = '#64748b')}
          >
            ← Return to Home
          </a>
        </p>
      </div>
    </main>
  )
}
