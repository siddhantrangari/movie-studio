import { NextRequest, NextResponse } from 'next/server'
import { isAdminAuthenticated } from '@/lib/auth'
import { getVideoProjects, saveVideoProject, deleteVideoProject } from '@/lib/studio'

export const dynamic = 'force-dynamic'

export async function GET() {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return NextResponse.json({ projects: getVideoProjects() })
}

export async function POST(req: NextRequest) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const body = await req.json()
  if (!body.name || !body.name.trim()) {
    return NextResponse.json({ error: 'Project name is required' }, { status: 400 })
  }
  const project = saveVideoProject({
    id: body.id,
    name: body.name.trim(),
    description: body.description?.trim(),
    isPublished: body.isPublished,
  })
  return NextResponse.json({ success: true, project })
}

export async function DELETE(req: NextRequest) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'Project ID required' }, { status: 400 })
  deleteVideoProject(id)
  return NextResponse.json({ success: true })
}
