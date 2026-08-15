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
