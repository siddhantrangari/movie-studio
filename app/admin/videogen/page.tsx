import { isAdminAuthenticated } from '@/lib/auth'
import { redirect } from 'next/navigation'
import VideoGenClient from './VideoGenClient'

export default async function VideoGenPage() {
  const auth = await isAdminAuthenticated()
  if (!auth) redirect('/admin/login')
  return <VideoGenClient />
}
