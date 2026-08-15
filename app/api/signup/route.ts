import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { createUser, getUserByEmail } from '@/lib/users'

export async function POST(req: NextRequest) {
  try {
    const { email, password, name } = await req.json()

    if (!email || !password) {
      return NextResponse.json({ error: 'Email and password are required.' }, { status: 400 })
    }

    if (password.length < 6) {
      return NextResponse.json({ error: 'Password must be at least 6 characters long.' }, { status: 400 })
    }

    const existing = getUserByEmail(email)
    if (existing) {
      return NextResponse.json({ error: 'An account with this email already exists.' }, { status: 409 })
    }

    const passwordHash = await bcrypt.hash(password, 10)
    const user = createUser(email, passwordHash, name || email.split('@')[0])

    if (user.status === 'approved') {
      return NextResponse.json({
        ok: true,
        message: 'Admin account created and activated successfully!',
        status: user.status,
      })
    }

    return NextResponse.json({
      ok: true,
      message: 'Account created! Your account is currently pending administrator approval before you can log in.',
      status: user.status,
    })
  } catch (err: any) {
    console.error('SIGNUP ERROR:', err)
    return NextResponse.json({ error: err.message || 'Server error during account creation' }, { status: 500 })
  }
}
