import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { createResetToken, resetPasswordWithToken } from '@/lib/users'

export async function POST(req: NextRequest) {
  try {
    const { action, email, token, newPassword } = await req.json()

    if (action === 'request') {
      if (!email) {
        return NextResponse.json({ error: 'Email is required.' }, { status: 400 })
      }
      const res = createResetToken(email)
      if (!res) {
        // Return success even if email not found to avoid user enumeration
        return NextResponse.json({
          ok: true,
          message: 'If an account exists with that email, password reset instructions have been generated.',
        })
      }
      return NextResponse.json({
        ok: true,
        message: 'Password reset request recorded. Use your reset token to set a new password.',
        resetToken: res.token, // Returned for UI convenience/testing
      })
    }

    if (action === 'reset') {
      if (!token || !newPassword) {
        return NextResponse.json({ error: 'Token and new password are required.' }, { status: 400 })
      }
      if (newPassword.length < 6) {
        return NextResponse.json({ error: 'Password must be at least 6 characters long.' }, { status: 400 })
      }

      const passwordHash = await bcrypt.hash(newPassword, 10)
      const success = resetPasswordWithToken(token, passwordHash)

      if (!success) {
        return NextResponse.json({ error: 'Invalid or expired password reset token.' }, { status: 400 })
      }

      return NextResponse.json({ ok: true, message: 'Password updated successfully! You can now log in.' })
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  } catch (err: any) {
    console.error('FORGOT PASSWORD ERROR:', err)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
