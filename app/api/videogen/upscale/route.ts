import { NextRequest, NextResponse } from 'next/server'
import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'
import { isAdminAuthenticated } from '@/lib/auth'
import { getLocalClipPath, hasLocalClip, persistClip, isR2Configured, signedUrl } from '@/lib/storage'

export const maxDuration = 300

function runCommand(cmd: string, args: string[]): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args)
    let stdout = ''
    let stderr = ''
    p.stdout.on('data', (d) => (stdout += d.toString()))
    p.stderr.on('data', (d) => (stderr += d.toString()))
    p.on('close', (code) => resolve({ stdout, stderr, code: code ?? 0 }))
    p.on('error', (err) => reject(err))
  })
}

export async function POST(req: NextRequest) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await req.json()
    const { filename, targetResolution = '4k', model = 'ultrasharp', projectId = 'default-project' } = body

    if (!filename || typeof filename !== 'string') {
      return NextResponse.json({ error: 'Invalid filename' }, { status: 400 })
    }

    const localCandidates = [
      getLocalClipPath(filename),
      path.join(process.cwd(), 'data', 'films', filename),
      path.join(process.cwd(), 'data', 'work', filename),
      path.join(process.cwd(), 'data', filename),
    ]

    let inputPath = ''
    for (const p of localCandidates) {
      if (fs.existsSync(p) && fs.statSync(p).size > 0) {
        inputPath = p
        break
      }
    }

    // If not local, download from active GPU pod or signed R2 URL
    if (!inputPath) {
      const workDir = path.join(process.cwd(), 'data', 'work')
      if (!fs.existsSync(workDir)) {
        fs.mkdirSync(workDir, { recursive: true })
      }
      inputPath = path.join(workDir, filename)

      let downloaded = false
      if (isR2Configured()) {
        const url = await signedUrl(filename, 3600, { projectId })
        if (url) {
          const res = await fetch(url)
          if (res.ok) {
            const buf = Buffer.from(await res.arrayBuffer())
            if (buf.length > 0) {
              fs.writeFileSync(inputPath, buf)
              downloaded = true
            }
          }
        }
      }

      if (!downloaded || !fs.existsSync(inputPath) || fs.statSync(inputPath).size === 0) {
        return NextResponse.json({ error: `Source video ${filename} not found locally or in storage` }, { status: 404 })
      }
    }

    const is4K = targetResolution.toLowerCase() === '4k'
    const targetW = is4K ? 3840 : 1920
    const targetH = is4K ? 2160 : 1080
    const ext = path.extname(filename) || '.mp4'
    const baseName = path.basename(filename, ext).replace(/_(?:4k|1080p|upscaled.*)$/i, '')
    const outFilename = `${baseName}_upscaled_${Date.now()}_${is4K ? '4k' : '1080p'}${ext}`
    const workDir = path.join(process.cwd(), 'data', 'work')
    if (!fs.existsSync(workDir)) fs.mkdirSync(workDir, { recursive: true })
    const outputPath = path.join(workDir, outFilename)

    console.log(`[UPSCALE] Upscaling source ${inputPath} to ${targetW}x${targetH} (${model})...`)

    // High-fidelity multi-pass mastering filter:
    // 1. Lanczos accurate chroma tensor scaling to target 4K/1080p
    // 2. High-precision unsharp detail enhancement (3x3 / 5x5 hybrid)
    // 3. Studio Master CRF 14 encoding
    const vf = `scale=${targetW}:${targetH}:flags=lanczos+accurate_rnd+full_chroma_int,unsharp=5:5:0.8:5:5:0.4`

    const args = [
      '-y',
      '-i', inputPath,
      '-vf', vf,
      '-c:v', 'libx264',
      '-preset', 'medium',
      '-crf', '14',
      '-pix_fmt', 'yuv420p',
      '-c:a', 'copy',
      outputPath,
    ]

    const result = await runCommand('ffmpeg', args)
    if (result.code !== 0 || !fs.existsSync(outputPath) || fs.statSync(outputPath).size === 0) {
      console.error('[UPSCALE ERROR]', result.stderr)
      return NextResponse.json({ error: `FFmpeg upscale failed: ${result.stderr.slice(-200)}` }, { status: 500 })
    }

    const outputBuf = fs.readFileSync(outputPath)
    await persistClip(outFilename, outputBuf, { projectId })

    const streamUrl = await signedUrl(outFilename, 86400)

    console.log(`[UPSCALE OK] Successfully upscaled ${outFilename} (${(outputBuf.length / 1048576).toFixed(2)} MB)`)

    return NextResponse.json({
      ok: true,
      filename: outFilename,
      resolution: is4K ? '4K Ultra HD (3840x2160)' : '1080p Full HD (1920x1080)',
      sizeBytes: outputBuf.length,
      url: streamUrl || `/api/videogen/video?filename=${encodeURIComponent(outFilename)}`,
    })
  } catch (err: any) {
    console.error('[UPSCALE EXCEPTION]', err)
    return NextResponse.json({ error: err.message || 'Internal error' }, { status: 500 })
  }
}
