import { NextRequest, NextResponse } from 'next/server'
import { isAdminAuthenticated } from '@/lib/auth'
import { listReferenceAssets, putReferenceAsset, deleteReferenceAsset } from '@/lib/storage'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const projectId = req.nextUrl.searchParams.get('projectId') || 'default-project'
  try {
    const references = await listReferenceAssets(projectId)
    return NextResponse.json({ success: true, references })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Failed to list references' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const body = await req.json()
    const { image, filename, projectId } = body
    if (!image || typeof image !== 'string') {
      return NextResponse.json({ error: 'Image base64 data required' }, { status: 400 })
    }

    const matches = image.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/)
    if (!matches || !matches[2]) {
      return NextResponse.json({ error: 'Invalid base64 data' }, { status: 400 })
    }

    const mime = matches[1] || 'image/png'
    const buf = Buffer.from(matches[2], 'base64')
    const fname = filename || `ref_${Date.now()}.png`
    const saved = await putReferenceAsset(fname, buf, projectId || 'default-project', mime)

    return NextResponse.json({ success: true, reference: saved })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Failed to upload reference' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const key = req.nextUrl.searchParams.get('key')
  if (!key) {
    return NextResponse.json({ error: 'key is required' }, { status: 400 })
  }
  try {
    await deleteReferenceAsset(key)
    return NextResponse.json({ success: true })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Failed to delete reference' }, { status: 500 })
  }
}
