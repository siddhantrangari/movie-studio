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

export async function signedUrl(key: string, expiresIn = 3600): Promise<string | null> {
  const r2 = getR2Client()
  if (!r2) return null

  const command = new GetObjectCommand({
    Bucket: r2.bucket,
    Key: key,
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

export async function persistClip(filename: string, buffer: Buffer): Promise<string> {
  const localPath = getLocalClipPath(filename)
  fs.writeFileSync(localPath, buffer)
  if (isR2Configured()) {
    try {
      await putFilm(filename, localPath)
    } catch {
      // ignore R2 upload failure if local save succeeded
    }
  }
  return localPath
}
