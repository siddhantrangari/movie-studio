import jwt from 'jsonwebtoken'
import bcrypt from 'bcryptjs'
import { cookies } from 'next/headers'
import { getUserByEmail, User } from './users'

const JWT_SECRET = process.env.JWT_SECRET || 'sr_jwt_s3cr3t_change_this_before_deploy_min32chars!!'
const COOKIE_NAME = 'sr_admin_token'
const COOKIE_MAX_AGE = 60 * 60 * 8 // 8 hours

export type TokenPayload = {
  id: string
  email: string
  role: 'admin' | 'user'
  status: 'pending' | 'approved' | 'rejected'
  ts: number
}

export async function verifyPassword(password: string, hash?: string): Promise<boolean> {
  const targetHash = hash || process.env.ADMIN_PASSWORD_HASH!
  return bcrypt.compare(password, targetHash)
}

export function signToken(user: { id: string; email: string; role: 'admin' | 'user'; status: 'pending' | 'approved' | 'rejected' }): string {
  const payload: TokenPayload = {
    id: user.id,
    email: user.email,
    role: user.role,
    status: user.status,
    ts: Date.now(),
  }
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '8h' })
}

export async function decodeToken(token: string): Promise<TokenPayload | null> {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return null
    const [headerB64, payloadB64, signatureB64] = parts

    const encoder = new TextEncoder()
    const data = encoder.encode(`${headerB64}.${payloadB64}`)
    const keyData = encoder.encode(JWT_SECRET)

    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      keyData,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    )

    const base64urlToUint8Array = (base64url: string) => {
      let base64 = base64url.replace(/-/g, '+').replace(/_/g, '/')
      while (base64.length % 4) base64 += '='
      const binString = atob(base64)
      const bytes = new Uint8Array(binString.length)
      for (let i = 0; i < binString.length; i++) {
        bytes[i] = binString.charCodeAt(i)
      }
      return bytes
    }

    const signature = base64urlToUint8Array(signatureB64)
    const isValid = await crypto.subtle.verify('HMAC', cryptoKey, signature, data)
    if (!isValid) return null

    const payloadJson = atob(payloadB64.replace(/-/g, '+').replace(/_/g, '/'))
    const payload = JSON.parse(payloadJson) as TokenPayload

    return payload
  } catch {
    return null
  }
}

export async function verifyToken(token: string): Promise<boolean> {
  const payload = await decodeToken(token)
  if (!payload) return false
  return payload.status === 'approved'
}

export function getAdminCookieOptions() {
  return {
    name: COOKIE_NAME,
    maxAge: COOKIE_MAX_AGE,
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
  }
}

export async function getCurrentUser(): Promise<TokenPayload | null> {
  const cookieStore = await cookies()
  const token = cookieStore.get(COOKIE_NAME)?.value
  if (!token) return null
  return decodeToken(token)
}

export async function isAdminAuthenticated(): Promise<boolean> {
  const user = await getCurrentUser()
  if (!user) return false
  return user.status === 'approved'
}

export async function isSuperAdmin(): Promise<boolean> {
  const user = await getCurrentUser()
  if (!user) return false
  return user.role === 'admin' && user.status === 'approved'
}

export const COOKIE_NAME_EXPORT = COOKIE_NAME
