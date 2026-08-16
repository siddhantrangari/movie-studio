import { NextRequest, NextResponse } from 'next/server'
import { isAdminAuthenticated } from '@/lib/auth'
import { isR2Configured, putFilm, signedUrl } from '@/lib/storage'
import { exec } from 'child_process'
import { promisify } from 'util'
import * as fs from 'fs'
import * as path from 'path'
import os from 'os'

const execAsync = promisify(exec)

export const maxDuration = 300

export async function POST(req: NextRequest) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const {
      title = 'Master 4K Music Video',
      projectId = 'default-project',
      scenes = [], // Array of { order, videoUrl, filename, startSec, durationSec }
      songAudioUrl = '',
      songAudioBase64 = '',
    } = await req.json()

    if (!Array.isArray(scenes) || scenes.length === 0) {
      return NextResponse.json({ error: 'No video scenes provided for assembly' }, { status: 400 })
    }

    const readyScenes = scenes.filter((s: any) => s.videoUrl || s.filename)
    if (readyScenes.length === 0) {
      return NextResponse.json({ error: 'At least one completed scene video is required' }, { status: 400 })
    }

    const tmpDir = path.join(os.tmpdir(), `music_video_${Date.now()}`)
    fs.mkdirSync(tmpDir, { recursive: true })

    const localClips: string[] = []

    // Download or copy all scene video parts
    for (let i = 0; i < readyScenes.length; i++) {
      const sc = readyScenes[i]
      const clipPath = path.join(tmpDir, `scene_${i}.mp4`)
      if (sc.videoUrl && (sc.videoUrl.startsWith('http://') || sc.videoUrl.startsWith('https://'))) {
        const resp = await fetch(sc.videoUrl)
        if (!resp.ok) throw new Error(`Failed to fetch scene video: ${sc.videoUrl}`)
        const arrayBuf = await resp.arrayBuffer()
        fs.writeFileSync(clipPath, Buffer.from(arrayBuf))
      } else if (sc.filename) {
        const localCandidate = path.join(process.cwd(), 'data', 'videos', sc.filename)
        if (fs.existsSync(localCandidate)) {
          fs.copyFileSync(localCandidate, clipPath)
        } else {
          throw new Error(`Scene video file not found locally: ${sc.filename}`)
        }
      }
      localClips.push(clipPath)
    }

    // Save audio file if provided
    let audioPath: string | null = null
    if (songAudioBase64 && songAudioBase64.startsWith('data:audio/')) {
      const match = songAudioBase64.match(/^data:audio\/(.+);base64,(.+)$/)
      if (match && match[2]) {
        audioPath = path.join(tmpDir, 'master_audio.mp3')
        fs.writeFileSync(audioPath, Buffer.from(match[2], 'base64'))
      }
    } else if (songAudioUrl && (songAudioUrl.startsWith('http://') || songAudioUrl.startsWith('https://'))) {
      const resp = await fetch(songAudioUrl)
      if (resp.ok) {
        audioPath = path.join(tmpDir, 'master_audio.mp3')
        const arrayBuf = await resp.arrayBuffer()
        fs.writeFileSync(audioPath, Buffer.from(arrayBuf))
      }
    }

    // Create concat list file
    const concatListPath = path.join(tmpDir, 'clips.txt')
    const concatContent = localClips.map((p) => `file '${p}'`).join('\n')
    fs.writeFileSync(concatListPath, concatContent)

    const outFilename = `music_video_4k_${Date.now()}.mp4`
    const outPath = path.join(tmpDir, outFilename)

    // Build FFmpeg command for seamless 4K assembly
    let ffmpegCmd = ''
    if (audioPath) {
      ffmpegCmd = `ffmpeg -y -f concat -safe 0 -i "${concatListPath}" -i "${audioPath}" -map 0:v -map 1:a -vf "scale=3840:2160:flags=lanczos,unsharp=5:5:0.8:5:5:0.0" -c:v libx264 -preset slow -crf 14 -pix_fmt yuv420p -c:a aac -b:a 320k -shortest "${outPath}"`
    } else {
      ffmpegCmd = `ffmpeg -y -f concat -safe 0 -i "${concatListPath}" -vf "scale=3840:2160:flags=lanczos,unsharp=5:5:0.8:5:5:0.0" -c:v libx264 -preset slow -crf 14 -pix_fmt yuv420p -c:a aac -b:a 320k "${outPath}"`
    }

    await execAsync(ffmpegCmd)

    const stats = fs.statSync(outPath)
    let videoUrl = `/api/videogen/assemble?file=${encodeURIComponent(outFilename)}`

    // Upload to R2
    const r2Key = `films/${projectId}/${outFilename}`
    if (isR2Configured()) {
      await putFilm(r2Key, outPath)
      const signed = await signedUrl(r2Key, 86400 * 7)
      if (signed) videoUrl = signed
    }

    // Save locally to data/films
    const localFilmsDir = path.join(process.cwd(), 'data', 'films')
    if (!fs.existsSync(localFilmsDir)) fs.mkdirSync(localFilmsDir, { recursive: true })
    fs.copyFileSync(outPath, path.join(localFilmsDir, outFilename))

    // Cleanup temp
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    } catch {}

    return NextResponse.json({
      success: true,
      filename: outFilename,
      r2Key,
      videoUrl,
      sizeBytes: stats.size,
      title,
      scenesCount: readyScenes.length,
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Assembly failed' }, { status: 500 })
  }
}
