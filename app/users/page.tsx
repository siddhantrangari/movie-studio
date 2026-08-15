'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

type UserItem = {
  id: string
  email: string
  name: string
  role: 'admin' | 'user'
  status: 'pending' | 'approved' | 'rejected'
  createdAt: number
  approvedAt?: number
}

export default function UserManagementPage() {
  const [users, setUsers] = useState<UserItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [actionMsg, setActionMsg] = useState('')
  const router = useRouter()

  async function fetchUsers() {
    try {
      setLoading(true)
      const res = await fetch('/api/admin/users')
      if (res.status === 401 || res.status === 403) {
        router.push('/admin/login')
        return
      }
      const data = await res.json()
      if (res.ok) {
        setUsers(data.users || [])
      } else {
        setError(data.error || 'Failed to load users')
      }
    } catch {
      setError('Error connecting to server')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchUsers()
  }, [])

  async function handleStatusChange(id: string, newStatus: 'approved' | 'rejected') {
    try {
      setActionMsg('')
      const res = await fetch('/api/admin/users', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status: newStatus }),
      })
      const data = await res.json()
      if (res.ok) {
        setActionMsg(`User status updated to ${newStatus}`)
        fetchUsers()
      } else {
        setError(data.error || 'Failed to update user')
      }
    } catch {
      setError('Error updating user status')
    }
  }

  async function handleDeleteUser(id: string, email: string) {
    if (!confirm(`Are you sure you want to delete user ${email}?`)) return
    try {
      setActionMsg('')
      const res = await fetch(`/api/admin/users?id=${id}`, {
        method: 'DELETE',
      })
      const data = await res.json()
      if (res.ok) {
        setActionMsg(`User deleted successfully`)
        fetchUsers()
      } else {
        setError(data.error || 'Failed to delete user')
      }
    } catch {
      setError('Error deleting user')
    }
  }

  return (
    <main
      style={{
        minHeight: '100vh',
        background: '#05080e',
        color: '#e2e8f0',
        padding: '2rem 1.5rem',
        fontFamily: 'sans-serif',
      }}
    >
      <div style={{ maxWidth: '1000px', margin: '0 auto' }}>
        {/* Header */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '2rem',
            borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
            paddingBottom: '1rem',
          }}
        >
          <div>
            <h1 style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--gold, #e8b94a)', margin: 0 }}>
              User Access & Permissions Management
            </h1>
            <p style={{ fontSize: '12px', color: '#64748b', margin: '0.25rem 0 0 0' }}>
              Approve, reject, or delete user accounts registered for Veo Studio.
            </p>
          </div>
          <div style={{ display: 'flex', gap: '10px' }}>
            <button
              onClick={() => router.push('/admin/videogen/movie')}
              style={{
                padding: '0.5rem 1rem',
                borderRadius: '0.5rem',
                fontSize: '12px',
                background: 'rgba(255, 255, 255, 0.05)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                color: '#cbd5e1',
                cursor: 'pointer',
              }}
            >
              🎬 Movie Builder
            </button>
          </div>
        </div>

        {/* Notifications */}
        {error && (
          <div style={{ padding: '0.75rem', borderRadius: '0.5rem', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#f87171', fontSize: '12px', marginBottom: '1rem' }}>
            🚨 {error}
          </div>
        )}
        {actionMsg && (
          <div style={{ padding: '0.75rem', borderRadius: '0.5rem', background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.3)', color: '#4ade80', fontSize: '12px', marginBottom: '1rem' }}>
            ✅ {actionMsg}
          </div>
        )}

        {/* Table Card */}
        <div
          style={{
            background: 'rgba(14, 23, 38, 0.75)',
            borderRadius: '1rem',
            border: '1px solid rgba(255, 255, 255, 0.06)',
            overflow: 'hidden',
          }}
        >
          {loading ? (
            <div style={{ padding: '3rem', textAlign: 'center', color: '#64748b', fontSize: '13px' }}>
              Loading user accounts...
            </div>
          ) : users.length === 0 ? (
            <div style={{ padding: '3rem', textAlign: 'center', color: '#64748b', fontSize: '13px' }}>
              No registered user accounts found.
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}>
              <thead>
                <tr style={{ background: 'rgba(7, 12, 20, 0.8)', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                  <th style={{ padding: '0.85rem 1rem', color: '#94a3b8', fontWeight: 600 }}>User</th>
                  <th style={{ padding: '0.85rem 1rem', color: '#94a3b8', fontWeight: 600 }}>Role</th>
                  <th style={{ padding: '0.85rem 1rem', color: '#94a3b8', fontWeight: 600 }}>Status</th>
                  <th style={{ padding: '0.85rem 1rem', color: '#94a3b8', fontWeight: 600 }}>Registered</th>
                  <th style={{ padding: '0.85rem 1rem', color: '#94a3b8', fontWeight: 600, textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                    <td style={{ padding: '0.85rem 1rem' }}>
                      <div style={{ fontWeight: 600, color: '#f8fafc' }}>{u.name}</div>
                      <div style={{ fontSize: '11px', color: '#64748b' }}>{u.email}</div>
                    </td>
                    <td style={{ padding: '0.85rem 1rem' }}>
                      <span
                        style={{
                          fontSize: '10px',
                          textTransform: 'uppercase',
                          padding: '0.2rem 0.5rem',
                          borderRadius: '4px',
                          background: u.role === 'admin' ? 'rgba(232, 185, 74, 0.15)' : 'rgba(255,255,255,0.05)',
                          color: u.role === 'admin' ? '#e8b94a' : '#94a3b8',
                          fontWeight: 700,
                        }}
                      >
                        {u.role}
                      </span>
                    </td>
                    <td style={{ padding: '0.85rem 1rem' }}>
                      <span
                        style={{
                          fontSize: '10px',
                          textTransform: 'uppercase',
                          padding: '0.2rem 0.5rem',
                          borderRadius: '4px',
                          background:
                            u.status === 'approved'
                              ? 'rgba(34, 197, 94, 0.15)'
                              : u.status === 'pending'
                              ? 'rgba(234, 179, 8, 0.15)'
                              : 'rgba(239, 68, 68, 0.15)',
                          color:
                            u.status === 'approved'
                              ? '#4ade80'
                              : u.status === 'pending'
                              ? '#facc15'
                              : '#f87171',
                          fontWeight: 700,
                        }}
                      >
                        {u.status}
                      </span>
                    </td>
                    <td style={{ padding: '0.85rem 1rem', color: '#64748b', fontSize: '11px' }}>
                      {new Date(u.createdAt).toLocaleDateString()}
                    </td>
                    <td style={{ padding: '0.85rem 1rem', textAlign: 'right' }}>
                      <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
                        {u.status !== 'approved' && (
                          <button
                            onClick={() => handleStatusChange(u.id, 'approved')}
                            style={{
                              padding: '0.35rem 0.6rem',
                              borderRadius: '0.4rem',
                              fontSize: '11px',
                              background: 'rgba(34, 197, 94, 0.2)',
                              border: '1px solid rgba(34, 197, 94, 0.4)',
                              color: '#4ade80',
                              cursor: 'pointer',
                            }}
                          >
                            Approve
                          </button>
                        )}
                        {u.status !== 'rejected' && (
                          <button
                            onClick={() => handleStatusChange(u.id, 'rejected')}
                            style={{
                              padding: '0.35rem 0.6rem',
                              borderRadius: '0.4rem',
                              fontSize: '11px',
                              background: 'rgba(239, 68, 68, 0.2)',
                              border: '1px solid rgba(239, 68, 68, 0.4)',
                              color: '#f87171',
                              cursor: 'pointer',
                            }}
                          >
                            Reject
                          </button>
                        )}
                        <button
                          onClick={() => handleDeleteUser(u.id, u.email)}
                          style={{
                            padding: '0.35rem 0.6rem',
                            borderRadius: '0.4rem',
                            fontSize: '11px',
                            background: 'rgba(255, 255, 255, 0.05)',
                            border: '1px solid rgba(255, 255, 255, 0.1)',
                            color: '#64748b',
                            cursor: 'pointer',
                          }}
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </main>
  )
}
