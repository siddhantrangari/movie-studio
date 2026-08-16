import UsageDashboard from '../components/UsageDashboard'
import Link from 'next/link'

export default function DashboardPage() {
  return (
    <div style={{ minHeight: '100vh', background: '#05080e', color: '#F2F5FA', padding: '2rem' }}>
      <div style={{ maxWidth: '1280px', margin: '0 auto 1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Link
          href="/"
          style={{
            fontSize: '12px',
            color: 'var(--gold, #E8B94A)',
            textDecoration: 'none',
            fontWeight: 700,
            display: 'flex',
            alignItems: 'center',
            gap: '0.4rem',
            background: 'rgba(232,185,74,0.06)',
            border: '1px solid rgba(232,185,74,0.2)',
            padding: '0.4rem 0.8rem',
            borderRadius: '0.4rem',
          }}
        >
          ← Back to Cinema Studio
        </Link>
      </div>

      <UsageDashboard />
    </div>
  )
}
