import { Pool, QueryResult, QueryResultRow } from 'pg'
import fs from 'fs'
import path from 'path'

const connectionString =
  process.env.DATABASE_URL ||
  'postgresql://studio_admin:StudioSecurePass2026!@127.0.0.1:5435/movie_studio'

let poolInstance: Pool | null = null

export function getPool(): Pool {
  if (!poolInstance) {
    poolInstance = new Pool({
      connectionString,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    })

    poolInstance.on('error', (err) => {
      console.error('Unexpected error on idle PostgreSQL client:', err)
    })
  }
  return poolInstance
}

export async function query<T extends QueryResultRow = any>(
  text: string,
  params?: any[]
): Promise<QueryResult<T>> {
  const pool = getPool()
  const start = Date.now()
  try {
    const res = await pool.query<T>(text, params)
    return res
  } catch (err) {
    console.error('PostgreSQL query error:', { text, error: (err as Error).message })
    throw err
  }
}

let dbInitialized = false

export async function initDb(): Promise<boolean> {
  if (dbInitialized) return true
  try {
    const schemaPath = path.join(process.cwd(), 'lib', 'schema.sql')
    if (fs.existsSync(schemaPath)) {
      const sql = fs.readFileSync(schemaPath, 'utf8')
      await query(sql)
      dbInitialized = true
      return true
    }
  } catch (e) {
    console.warn('Database initialization skipped or offline:', (e as Error).message)
  }
  return false
}
