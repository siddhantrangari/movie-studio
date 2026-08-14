import { NextRequest, NextResponse } from 'next/server'
import { isAdminAuthenticated } from '@/lib/auth'
import { bringUp, tearDown, findPod, type LogLine } from '@/lib/podops'

// Bringing a pod up includes a ~4 minute download.
export const maxDuration = 900
export const dynamic = 'force-dynamic'

export async function GET() {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const pod = await findPod()
  return NextResponse.json({
    pod: pod
      ? {
          id: pod.id,
          status: pod.desiredStatus,
          costPerHr: pod.costPerHr,
          comfyui: `https://${pod.id}-8188.proxy.runpod.net`,
          jupyter: `https://${pod.id}-8888.proxy.runpod.net`,
        }
      : null,
  })
}

/**
 * Streams lifecycle progress as newline-delimited JSON so the UI can show the
 * log as it happens instead of staring at a spinner for four minutes.
 */
export async function POST(req: NextRequest) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { action } = await req.json()
  if (!['up', 'down'].includes(action)) {
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  }

  const source: AsyncGenerator<LogLine> = action === 'up' ? bringUp() : tearDown()
  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      const send = (line: LogLine) =>
        controller.enqueue(encoder.encode(JSON.stringify(line) + '\n'))
      try {
        for await (const line of source) send(line)
      } catch (e) {
        send({ level: 'error', text: (e as Error).message })
      } finally {
        controller.close()
      }
    },
  })

  return new NextResponse(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-store, no-transform',
      Connection: 'keep-alive',
      // Nginx buffers proxied responses by default, which would defeat streaming.
      'X-Accel-Buffering': 'no',
    },
  })
}
