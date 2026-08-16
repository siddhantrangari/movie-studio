'use client'

import React, { createContext, useContext, useState, useCallback } from 'react'

type ToastType = 'success' | 'error' | 'info' | 'warning'

type ToastItem = {
  id: string
  type: ToastType
  title?: string
  message: string
  duration?: number
}

type ConfirmOptions = {
  title: string
  message: string
  confirmText?: string
  cancelText?: string
  type?: 'danger' | 'warning' | 'info'
  onConfirm: () => void | Promise<void>
  onCancel?: () => void
}

type ToastContextType = {
  toast: {
    success: (message: string, title?: string) => void
    error: (message: string, title?: string) => void
    info: (message: string, title?: string) => void
    warn: (message: string, title?: string) => void
  }
  confirm: (options: ConfirmOptions) => void
}

const ToastContext = createContext<ToastContextType | null>(null)

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const [confirmDialog, setConfirmDialog] = useState<ConfirmOptions | null>(null)
  const [confirmLoading, setConfirmLoading] = useState(false)

  const addToast = useCallback((type: ToastType, message: string, title?: string, duration = 4000) => {
    const id = Math.random().toString(36).substring(2, 9)
    setToasts((prev) => [...prev, { id, type, title, message, duration }])
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id))
    }, duration)
  }, [])

  const toast = {
    success: (msg: string, title = 'Success') => addToast('success', msg, title),
    error: (msg: string, title = 'Error') => addToast('error', msg, title, 6000),
    info: (msg: string, title = 'Info') => addToast('info', msg, title),
    warn: (msg: string, title = 'Warning') => addToast('warning', msg, title, 5000),
  }

  const showConfirm = useCallback((options: ConfirmOptions) => {
    setConfirmDialog(options)
  }, [])

  const handleConfirm = async () => {
    if (!confirmDialog) return
    try {
      setConfirmLoading(true)
      await confirmDialog.onConfirm()
      setConfirmDialog(null)
    } catch (e) {
      toast.error((e as Error).message || 'Action failed')
    } finally {
      setConfirmLoading(false)
    }
  }

  const handleCancel = () => {
    if (confirmDialog?.onCancel) confirmDialog.onCancel()
    setConfirmDialog(null)
  }

  return (
    <ToastContext.Provider value={{ toast, confirm: showConfirm }}>
      {children}

      {/* Toast Notification Stack */}
      <div
        style={{
          position: 'fixed',
          bottom: '24px',
          right: '24px',
          zIndex: 9999,
          display: 'flex',
          flexDirection: 'column',
          gap: '0.6rem',
          maxWidth: '380px',
          width: 'calc(100% - 48px)',
          pointerEvents: 'none',
        }}
      >
        {toasts.map((t) => {
          const isErr = t.type === 'error'
          const isWarn = t.type === 'warning'
          const isOk = t.type === 'success'

          return (
            <div
              key={t.id}
              style={{
                pointerEvents: 'auto',
                background: 'linear-gradient(135deg, rgba(14, 24, 46, 0.96), rgba(7, 12, 20, 0.98))',
                border: isErr
                  ? '1px solid rgba(248, 113, 113, 0.6)'
                  : isWarn
                  ? '1px solid rgba(232, 185, 74, 0.6)'
                  : isOk
                  ? '1px solid rgba(74, 222, 128, 0.6)'
                  : '1px solid #1a2840',
                borderRadius: '0.65rem',
                padding: '0.85rem 1rem',
                display: 'flex',
                alignItems: 'flex-start',
                gap: '0.75rem',
                boxShadow: isErr
                  ? '0 10px 30px rgba(239, 68, 68, 0.25)'
                  : '0 10px 30px rgba(0, 0, 0, 0.6)',
                backdropFilter: 'blur(12px)',
                animation: 'slideInToast 0.25s cubic-bezier(0.16, 1, 0.3, 1)',
              }}
            >
              <span style={{ fontSize: '1.2rem', lineHeight: 1 }}>
                {isErr ? '❌' : isWarn ? '⚠️' : isOk ? '✅' : 'ℹ️'}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                {t.title && (
                  <h5
                    style={{
                      margin: '0 0 0.15rem',
                      fontSize: '12px',
                      fontWeight: 800,
                      color: isErr ? '#f87171' : isWarn ? 'var(--gold, #E8B94A)' : isOk ? '#4ade80' : '#F2F5FA',
                    }}
                  >
                    {t.title}
                  </h5>
                )}
                <p style={{ margin: 0, fontSize: '11px', color: '#cbd5e1', lineHeight: 1.4 }}>
                  {t.message}
                </p>
              </div>
              <button
                onClick={() => setToasts((prev) => prev.filter((item) => item.id !== t.id))}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#64748b',
                  fontSize: '13px',
                  cursor: 'pointer',
                  padding: 0,
                }}
              >
                ×
              </button>
            </div>
          )
        })}
      </div>

      {/* Modern Confirmation Modal Dialog */}
      {confirmDialog && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(5, 8, 14, 0.82)',
            backdropFilter: 'blur(8px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 10000,
            animation: 'fadeIn 0.2s ease',
          }}
        >
          <div
            style={{
              background: '#0e182e',
              border: confirmDialog.type === 'danger' ? '1px solid rgba(248,113,113,0.5)' : '1px solid var(--gold, #E8B94A)',
              borderRadius: '1rem',
              padding: '1.5rem',
              width: '440px',
              maxWidth: '92vw',
              display: 'flex',
              flexDirection: 'column',
              gap: '1.1rem',
              boxShadow: '0 20px 60px rgba(0,0,0,0.85)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <span style={{ fontSize: '1.6rem' }}>
                {confirmDialog.type === 'danger' ? '🗑️' : '⚠️'}
              </span>
              <div>
                <h4 style={{ margin: 0, fontSize: '14px', fontWeight: 800, color: confirmDialog.type === 'danger' ? '#f87171' : 'var(--gold, #E8B94A)' }}>
                  {confirmDialog.title}
                </h4>
                <p style={{ margin: '0.25rem 0 0', fontSize: '11.5px', color: '#cbd5e1', lineHeight: 1.4 }}>
                  {confirmDialog.message}
                </p>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.6rem', marginTop: '0.4rem' }}>
              <button
                onClick={handleCancel}
                disabled={confirmLoading}
                style={{
                  background: '#070c14',
                  border: '1px solid #1a2840',
                  color: '#94a3b8',
                  borderRadius: '0.4rem',
                  padding: '0.55rem 1rem',
                  fontSize: '11.5px',
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                {confirmDialog.cancelText || 'Cancel'}
              </button>

              <button
                onClick={handleConfirm}
                disabled={confirmLoading}
                style={{
                  background: confirmDialog.type === 'danger' ? 'linear-gradient(135deg, #ef4444, #dc2626)' : 'var(--gold, #E8B94A)',
                  color: confirmDialog.type === 'danger' ? '#fff' : '#05080e',
                  border: 'none',
                  borderRadius: '0.4rem',
                  padding: '0.55rem 1.25rem',
                  fontSize: '11.5px',
                  fontWeight: 800,
                  cursor: confirmLoading ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.4rem',
                }}
              >
                {confirmLoading ? '⏳ Processing...' : (confirmDialog.confirmText || 'Confirm')}
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        @keyframes slideInToast {
          from { opacity: 0; transform: translateY(16px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
      `}</style>
    </ToastContext.Provider>
  )
}

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) {
    // Fallback if rendered outside provider
    return {
      toast: {
        success: (m: string) => console.log(m),
        error: (m: string) => console.error(m),
        info: (m: string) => console.info(m),
        warn: (m: string) => console.warn(m),
      },
      confirm: (opts: ConfirmOptions) => {
        if (window.confirm(`${opts.title}\n\n${opts.message}`)) {
          opts.onConfirm()
        }
      },
    }
  }
  return ctx
}
