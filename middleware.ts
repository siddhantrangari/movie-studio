import { NextRequest, NextResponse } from 'next/server'
import { verifyToken } from './lib/auth'

const COOKIE_NAME = 'sr_admin_token'
const PROTECTED_ROUTES = ['/movie', '/studio', '/canvas', '/dashboard', '/users']

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  if (PROTECTED_ROUTES.some(p => pathname.startsWith(p))) {
    const token = req.cookies.get(COOKIE_NAME)?.value
    if (!token || !(await verifyToken(token))) {
      const loginUrl = new URL('/login', req.url)
      loginUrl.searchParams.set('from', pathname)
      return NextResponse.redirect(loginUrl)
    }
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/movie/:path*', '/studio/:path*', '/canvas/:path*', '/dashboard/:path*', '/users/:path*'],
}
