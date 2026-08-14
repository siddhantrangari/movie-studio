import jwt from 'jsonwebtoken'
import bcrypt from 'bcryptjs'
import { cookies } from 'next/headers'

const JWT_SECRET = process.env.JWT_SECRET!
const COOKIE_NAME = 'sr_admin_token'
const COOKIE_MAX_AGE = 60 * 60 * 8 // 8 hours

export async function verifyPassword(password: string): Promise<boolean> {
  const hash = process.env.ADMIN_PASSWORD_HASH!
  return bcrypt.compare(password, hash)
}

export function signToken(): string {
  return jwt.sign({ role: 'admin', ts: Date.now() }, JWT_SECRET, { expiresIn: '8h' })
}

export async function verifyToken(token: string): Promise<boolean> {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return false
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

    const isValid = await crypto.subtle.verify(
      'HMAC',
      cryptoKey,
      signature,
      data
    )

    if (!isValid) return false

    const payloadJson = atob(payloadB64.replace(/-/g, '+').replace(/_/g, '/'))
    const payload = JSON.parse(payloadJson)
    
    if (payload.exp && Date.now() >= payload.exp * 1000) {
      return false
    }

    return true
  } catch {
    return false
  }
}

export function getAdminCookieOptions() {
  return {
    name: COOKIE_NAME,
    maxAge: COOKIE_MAX_AGE,
    httpOnly: true,       // NOT accessible via JS / DevTools
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
  }
}

export async function isAdminAuthenticated(): Promise<boolean> {
  const cookieStore = await cookies()
  const token = cookieStore.get(COOKIE_NAME)?.value
  if (!token) return false
  return await verifyToken(token)
}

export const COOKIE_NAME_EXPORT = COOKIE_NAME
