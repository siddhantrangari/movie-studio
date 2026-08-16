import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import fs from 'fs'

export function isR2Configured(): boolean {
  return Boolean(
    process.env.R2_ACCOUNT_ID &&
      process.env.R2_BUCKET &&
      process.env.R2_ACCESS_KEY_ID &&
      process.env.R2_SECRET_ACCESS_KEY
  )
}

function getR2Client(): { client: S3Client; bucket: string } | null {
  const accountId = process.env.R2_ACCOUNT_ID
  const bucket = process.env.R2_BUCKET
  const accessKeyId = process.env.R2_ACCESS_KEY_ID
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY

  if (!accountId || !bucket || !accessKeyId || !secretAccessKey) {
    return null
  }

  const client = new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
  })

  return { client, bucket }
}

export async function putFilm(key: string, filePath: string, contentType = 'video/mp4'): Promise<void> {
  const r2 = getR2Client()
  if (!r2) throw new Error('R2 storage is not configured')

  const fileBuffer = fs.readFileSync(filePath)
  await r2.client.send(
    new PutObjectCommand({
      Bucket: r2.bucket,
      Key: key,
      Body: fileBuffer,
      ContentType: contentType,
    })
  )
}

export async function signedUrl(
  filename: string,
  expiresInOrProjectId: number | string = 3600,
  optionsOrUserId?: { userId?: string; projectId?: string } | string
): Promise<string | null> {
  const r2 = getR2Client()
  if (!r2) return null

  let expiresIn = typeof expiresInOrProjectId === 'number' ? expiresInOrProjectId : 3600
  let userId = 'admin'
  let projectId = 'default-project'

  if (typeof expiresInOrProjectId === 'string') {
    projectId = expiresInOrProjectId
  }
  if (typeof optionsOrUserId === 'string') {
    userId = optionsOrUserId
  } else if (optionsOrUserId && typeof optionsOrUserId === 'object') {
    if (optionsOrUserId.userId) userId = optionsOrUserId.userId
    if (optionsOrUserId.projectId) projectId = optionsOrUserId.projectId
  }

  // Candidate paths to check in R2
  const candidateKeys = [
    filename,
    `films/${filename}`,
    `projects/${projectId}/${filename}`,
    `users/${userId}/projects/${projectId}/${filename}`,
  ]

  for (const key of candidateKeys) {
    try {
      const command = new GetObjectCommand({
        Bucket: r2.bucket,
        Key: key,
      })
      const url = await getSignedUrl(r2.client, command, { expiresIn })
      if (url) return url
    } catch {
      // try next key
    }
  }

  // Fallback direct sign
  const command = new GetObjectCommand({
    Bucket: r2.bucket,
    Key: filename,
  })
  return getSignedUrl(r2.client, command, { expiresIn })
}

export async function deleteFilmObject(key: string): Promise<void> {
  const r2 = getR2Client()
  if (!r2) return

  await r2.client.send(
    new DeleteObjectCommand({
      Bucket: r2.bucket,
      Key: key,
    })
  )
}

import path from 'path'

export function getLocalClipPath(filename: string): string {
  const dir = path.join(process.cwd(), 'data', 'films')
  if (!fs.existsSync(dir)) {
    try {
      fs.mkdirSync(dir, { recursive: true })
    } catch {
      // directory exists or created
    }
  }
  return path.join(dir, filename)
}

export function hasLocalClip(filename: string): boolean {
  if (!filename) return false
  const p = path.join(process.cwd(), 'data', 'films', filename)
  return fs.existsSync(p) && fs.statSync(p).size > 0
}

export async function persistClip(
  filename: string,
  buffer: Buffer,
  options?: { userId?: string; projectId?: string }
): Promise<string> {
  const localPath = getLocalClipPath(filename)
  fs.writeFileSync(localPath, buffer)
  if (isR2Configured()) {
    const userId = options?.userId || 'admin'
    const projectId = options?.projectId || 'default-project'
    try {
      // Save under canonical structured paths for per-user / per-project organisation
      await Promise.allSettled([
        putFilm(filename, localPath),
        putFilm(`films/${filename}`, localPath),
        putFilm(`projects/${projectId}/${filename}`, localPath),
        putFilm(`users/${userId}/projects/${projectId}/${filename}`, localPath),
      ])
    } catch {
      // ignore R2 upload failure if local save succeeded
    }
  }
  return localPath
}

export async function putReferenceAsset(
  filename: string,
  buffer: Buffer,
  projectId = 'default-project',
  contentType = 'image/png'
): Promise<{ key: string; filename: string; url: string }> {
  const r2 = getR2Client()
  const localDir = path.join(process.cwd(), 'data', 'references')
  if (!fs.existsSync(localDir)) fs.mkdirSync(localDir, { recursive: true })
  const localPath = path.join(localDir, filename)
  fs.writeFileSync(localPath, buffer)

  const key = `references/${projectId}/${filename}`
  if (r2) {
    await r2.client.send(
      new PutObjectCommand({
        Bucket: r2.bucket,
        Key: key,
        Body: buffer,
        ContentType: contentType,
      })
    )
  }
  const url = (await signedUrl(key, 86400 * 7)) || `/api/videogen/references/file?key=${encodeURIComponent(key)}`
  return { key, filename, url }
}

export async function listReferenceAssets(
  projectId = 'default-project'
): Promise<{ key: string; filename: string; url: string; createdAt: number }[]> {
  const r2 = getR2Client()
  const items: { key: string; filename: string; url: string; createdAt: number }[] = []

  // Check local references directory first
  const localDir = path.join(process.cwd(), 'data', 'references')
  if (fs.existsSync(localDir)) {
    const files = fs.readdirSync(localDir)
    for (const f of files) {
      if (f.startsWith('.') || !/\.(png|jpe?g|webp|gif)$/i.test(f)) continue
      const stat = fs.statSync(path.join(localDir, f))
      const key = `references/${projectId}/${f}`
      const url = (await signedUrl(key, 86400 * 7)) || (await signedUrl(f, 86400 * 7)) || ''
      items.push({
        key,
        filename: f,
        url,
        createdAt: stat.mtimeMs,
      })
    }
  }

  return items.sort((a, b) => b.createdAt - a.createdAt)
}

export async function deleteReferenceAsset(key: string): Promise<void> {
  const r2 = getR2Client()
  if (r2) {
    await r2.client.send(
      new DeleteObjectCommand({
        Bucket: r2.bucket,
        Key: key,
      })
    )
  }
  const filename = path.basename(key)
  const localPath = path.join(process.cwd(), 'data', 'references', filename)
  if (fs.existsSync(localPath)) {
    fs.unlinkSync(localPath)
  }
}
