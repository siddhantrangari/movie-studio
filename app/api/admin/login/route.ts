import { NextRequest, NextResponse } from 'next/server'
import { verifyPassword, signToken, getAdminCookieOptions } from '@/lib/auth'

export async function POST(req: NextRequest) {
  try {
    const { password } = await req.json()

    if (!password) {
      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 })
    }

    const valid = await verifyPassword(password)

    if (!valid) {
      // Always same error — don't reveal whether user/pass is wrong
      await new Promise(r => setTimeout(r, 800)) // timing attack mitigation
      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 })
    }

    const token = signToken()
    const opts = getAdminCookieOptions()

    const res = NextResponse.json({ ok: true })
    res.cookies.set(opts.name, token, {
      maxAge: opts.maxAge,
      httpOnly: opts.httpOnly,
      secure: opts.secure,
      sameSite: opts.sameSite,
      path: opts.path,
    })

    return res
  } catch {
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
