import { isAdminAuthenticated } from '@/lib/auth'
import { redirect } from 'next/navigation'
import StudioClient from './StudioClient'

export default async function StudioPage() {
  const auth = await isAdminAuthenticated()
  if (!auth) redirect('/admin/login')
  return <StudioClient />
}
