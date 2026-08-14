import { NextRequest, NextResponse } from 'next/server'
import { verifyPassword, signToken, getAdminCookieOptions } from '@/lib/auth'

export async function POST(req: NextRequest) {
  try {
    const { password } = await req.json()

    console.log("LOGIN DEBUG: input password =", password)
    console.log("LOGIN DEBUG: process.env.ADMIN_PASSWORD_HASH =", process.env.ADMIN_PASSWORD_HASH)

    if (!password) {
      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 })
    }

    const valid = await verifyPassword(password)
    console.log("LOGIN DEBUG: password is valid =", valid)

    if (!valid) {
      await new Promise(r => setTimeout(r, 800))
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
  } catch (err: any) {
    console.error("LOGIN ERROR:", err)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
