import fs from 'fs'
import path from 'path'
import crypto from 'crypto'

export type UserRole = 'admin' | 'user'
export type UserStatus = 'pending' | 'approved' | 'rejected'

export type User = {
  id: string
  email: string
  name: string
  passwordHash: string
  role: UserRole
  status: UserStatus
  createdAt: number
  approvedAt?: number
  resetToken?: string
  resetTokenExpiry?: number
}

export type PublicUser = Omit<User, 'passwordHash' | 'resetToken' | 'resetTokenExpiry'>

const DATA_DIR = path.join(process.cwd(), 'data')
const USERS_FILE = path.join(DATA_DIR, 'users.json')

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true })
  }
}

function readUsersRaw(): User[] {
  try {
    ensureDataDir()
    if (!fs.existsSync(USERS_FILE)) {
      return seedInitialAdmin()
    }
    const data = fs.readFileSync(USERS_FILE, 'utf8')
    const users: User[] = JSON.parse(data)
    if (!users || users.length === 0) {
      return seedInitialAdmin()
    }
    return users
  } catch {
    return seedInitialAdmin()
  }
}

function writeUsersRaw(users: User[]) {
  ensureDataDir()
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2))
}

function seedInitialAdmin(): User[] {
  const hash =
    process.env.ADMIN_PASSWORD_HASH ||
    '$2b$12$L1UHHLFDmjFMSVzJgX/vk.P6n1Gz6OWuQIesEY2R3dOBm9QTMEm6G' // fallback siddhant@admin123

  const defaultAdmin: User = {
    id: 'admin_primary',
    email: 'admin@veostudio.com',
    name: 'Administrator',
    passwordHash: hash,
    role: 'admin',
    status: 'approved',
    createdAt: Date.now(),
    approvedAt: Date.now(),
  }

  const users = [defaultAdmin]
  try {
    ensureDataDir()
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2))
  } catch {
    // Write failed
  }
  return users
}

export function toPublicUser(user: User): PublicUser {
  const { passwordHash, resetToken, resetTokenExpiry, ...publicUser } = user
  return publicUser
}

export async function getUsersAsync(): Promise<PublicUser[]> {
  try {
    const { query } = await import('./db')
    const res = await query('SELECT * FROM users ORDER BY created_at DESC')
    if (res.rows.length > 0) {
      return res.rows.map((r) => ({
        id: r.id,
        email: r.email,
        name: r.name,
        role: r.role as UserRole,
        status: r.status as UserStatus,
        createdAt: Number(r.created_at),
        approvedAt: r.approved_at ? Number(r.approved_at) : undefined,
      }))
    }
  } catch {}
  return readUsersRaw().map(toPublicUser)
}

export function getUsers(): PublicUser[] {
  return readUsersRaw().map(toPublicUser)
}

export async function getUserByEmailAsync(email: string): Promise<User | null> {
  const normalized = email.trim().toLowerCase()
  try {
    const { query } = await import('./db')
    const res = await query('SELECT * FROM users WHERE LOWER(email) = $1 LIMIT 1', [normalized])
    if (res.rows.length > 0) {
      const r = res.rows[0]
      return {
        id: r.id,
        email: r.email,
        name: r.name,
        passwordHash: r.password_hash,
        role: r.role as UserRole,
        status: r.status as UserStatus,
        createdAt: Number(r.created_at),
        approvedAt: r.approved_at ? Number(r.approved_at) : undefined,
        resetToken: r.reset_token,
        resetTokenExpiry: r.reset_token_expiry ? Number(r.reset_token_expiry) : undefined,
      }
    }
  } catch {}
  return readUsersRaw().find((u) => u.email.toLowerCase() === normalized) ?? null
}

export function getUserByEmail(email: string): User | null {
  const normalized = email.trim().toLowerCase()
  return readUsersRaw().find((u) => u.email.toLowerCase() === normalized) ?? null
}

export function getUserById(id: string): User | null {
  return readUsersRaw().find((u) => u.id === id) ?? null
}

export async function createUserAsync(email: string, passwordHash: string, name: string): Promise<User> {
  const normalized = email.trim().toLowerCase()
  const users = readUsersRaw()

  if (users.some((u) => u.email.toLowerCase() === normalized)) {
    throw new Error('An account with this email already exists.')
  }

  const isFirst = users.length === 0
  const newUser: User = {
    id: crypto.randomBytes(8).toString('hex'),
    email: normalized,
    name: name.trim() || 'User',
    passwordHash,
    role: isFirst ? 'admin' : 'user',
    status: isFirst ? 'approved' : 'pending',
    createdAt: Date.now(),
    approvedAt: isFirst ? Date.now() : undefined,
  }

  try {
    const { query } = await import('./db')
    await query(
      `INSERT INTO users (id, email, name, password_hash, role, status, created_at, approved_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        newUser.id,
        newUser.email,
        newUser.name,
        newUser.passwordHash,
        newUser.role,
        newUser.status,
        newUser.createdAt,
        newUser.approvedAt || null,
      ]
    )
  } catch {}

  users.push(newUser)
  writeUsersRaw(users)
  return newUser
}

export function createUser(email: string, passwordHash: string, name: string): User {
  const users = readUsersRaw()
  const normalized = email.trim().toLowerCase()

  if (users.some((u) => u.email.toLowerCase() === normalized)) {
    throw new Error('An account with this email already exists.')
  }

  const isFirst = users.length === 0
  const newUser: User = {
    id: crypto.randomBytes(8).toString('hex'),
    email: normalized,
    name: name.trim() || 'User',
    passwordHash,
    role: isFirst ? 'admin' : 'user',
    status: isFirst ? 'approved' : 'pending',
    createdAt: Date.now(),
    approvedAt: isFirst ? Date.now() : undefined,
  }

  users.push(newUser)
  writeUsersRaw(users)

  import('./db').then(({ query }) => {
    query(
      `INSERT INTO users (id, email, name, password_hash, role, status, created_at, approved_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (id) DO NOTHING`,
      [
        newUser.id,
        newUser.email,
        newUser.name,
        newUser.passwordHash,
        newUser.role,
        newUser.status,
        newUser.createdAt,
        newUser.approvedAt || null,
      ]
    ).catch(() => {})
  }).catch(() => {})

  return newUser
}

export function updateUserStatus(id: string, status: UserStatus, role?: UserRole): User | null {
  const users = readUsersRaw()
  const idx = users.findIndex((u) => u.id === id)
  if (idx === -1) return null

  users[idx] = {
    ...users[idx],
    status,
    role: role || users[idx].role,
    approvedAt: status === 'approved' ? Date.now() : users[idx].approvedAt,
  }

  writeUsersRaw(users)

  import('./db').then(({ query }) => {
    query(
      `UPDATE users SET status = $1, role = $2, approved_at = $3 WHERE id = $4`,
      [status, role || users[idx].role, users[idx].approvedAt || null, id]
    ).catch(() => {})
  }).catch(() => {})

  return users[idx]
}

export function deleteUser(id: string): boolean {
  const users = readUsersRaw()
  const filtered = users.filter((u) => u.id !== id)
  if (filtered.length === users.length) return false

  writeUsersRaw(filtered)

  import('./db').then(({ query }) => {
    query(`DELETE FROM users WHERE id = $1`, [id]).catch(() => {})
  }).catch(() => {})

  return true
}

export function createResetToken(email: string): { token: string; email: string } | null {
  const users = readUsersRaw()
  const normalized = email.trim().toLowerCase()
  const idx = users.findIndex((u) => u.email.toLowerCase() === normalized)
  if (idx === -1) return null

  const token = crypto.randomBytes(24).toString('hex')
  const expiry = Date.now() + 60 * 60 * 1000 // 1 hour

  users[idx].resetToken = token
  users[idx].resetTokenExpiry = expiry
  writeUsersRaw(users)

  return { token, email: users[idx].email }
}

export function resetPasswordWithToken(token: string, newPasswordHash: string): boolean {
  const users = readUsersRaw()
  const idx = users.findIndex(
    (u) => u.resetToken === token && u.resetTokenExpiry && u.resetTokenExpiry > Date.now()
  )
  if (idx === -1) return false

  users[idx].passwordHash = newPasswordHash
  delete users[idx].resetToken
  delete users[idx].resetTokenExpiry
  writeUsersRaw(users)
  return true
}
