import { isAdminAuthenticated } from '@/lib/auth'
import { redirect } from 'next/navigation'
import MovieClient from './MovieClient'

export default async function MoviePage() {
  const auth = await isAdminAuthenticated()
  if (!auth) redirect('/login')
  return <MovieClient />
}
