import { NextRequest, NextResponse } from 'next/server'
import { isSuperAdmin, getCurrentUser } from '@/lib/auth'
import { getUsers, updateUserStatus, deleteUser } from '@/lib/users'

export async function GET() {
  const currentUser = await getCurrentUser()
  if (!currentUser || currentUser.role !== 'admin' || currentUser.status !== 'approved') {
    return NextResponse.json({ error: 'Unauthorized: Admin access required' }, { status: 403 })
  }

  return NextResponse.json({ users: getUsers(), currentUser })
}

export async function PATCH(req: NextRequest) {
  const currentUser = await getCurrentUser()
  if (!currentUser || currentUser.role !== 'admin' || currentUser.status !== 'approved') {
    return NextResponse.json({ error: 'Unauthorized: Admin access required' }, { status: 403 })
  }

  try {
    const { id, status, role } = await req.json()
    if (!id || !status) {
      return NextResponse.json({ error: 'User ID and status are required' }, { status: 400 })
    }

    const updated = updateUserStatus(id, status, role)
    if (!updated) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    return NextResponse.json({ ok: true, user: updated })
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Server error' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  const currentUser = await getCurrentUser()
  if (!currentUser || currentUser.role !== 'admin' || currentUser.status !== 'approved') {
    return NextResponse.json({ error: 'Unauthorized: Admin access required' }, { status: 403 })
  }

  try {
    const id = req.nextUrl.searchParams.get('id')
    if (!id) {
      return NextResponse.json({ error: 'User ID is required' }, { status: 400 })
    }

    if (id === currentUser.id) {
      return NextResponse.json({ error: 'Cannot delete your own admin account' }, { status: 400 })
    }

    const deleted = deleteUser(id)
    if (!deleted) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    return NextResponse.json({ ok: true })
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Server error' }, { status: 500 })
  }
}
