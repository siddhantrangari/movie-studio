import { NextRequest, NextResponse } from 'next/server'
import { verifyPassword, signToken, getAdminCookieOptions } from '@/lib/auth'
import { getUserByEmail } from '@/lib/users'

export async function POST(req: NextRequest) {
  try {
    const { email, password } = await req.json()

    if (!password) {
      return NextResponse.json({ error: 'Password is required' }, { status: 400 })
    }

    const targetEmail = email ? email.trim().toLowerCase() : 'admin@veostudio.com'
    const user = getUserByEmail(targetEmail)

    if (!user) {
      await new Promise((r) => setTimeout(r, 400))
      return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 })
    }

    const valid = await verifyPassword(password, user.passwordHash)
    if (!valid) {
      await new Promise((r) => setTimeout(r, 400))
      return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 })
    }

    if (user.status === 'pending') {
      return NextResponse.json(
        { error: 'Your account is pending admin approval. Please wait for an administrator to activate your account.' },
        { status: 403 }
      )
    }

    if (user.status === 'rejected') {
      return NextResponse.json(
        { error: 'Your account request was declined by an administrator.' },
        { status: 403 }
      )
    }

    const token = signToken({
      id: user.id,
      email: user.email,
      role: user.role,
      status: user.status,
    })

    const opts = getAdminCookieOptions()
    const res = NextResponse.json({ ok: true, user: { id: user.id, email: user.email, name: user.name, role: user.role } })
    res.cookies.set(opts.name, token, {
      maxAge: opts.maxAge,
      httpOnly: opts.httpOnly,
      secure: opts.secure,
      sameSite: opts.sameSite,
      path: opts.path,
    })

    return res
  } catch (err: any) {
    console.error('LOGIN ERROR:', err)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
