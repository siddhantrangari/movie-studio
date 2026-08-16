import fs from 'fs'
import path from 'path'
import { query, initDb } from '../lib/db'

async function migrate() {
  console.log('🚀 Starting Data Migration from JSON files to PostgreSQL...')
  const dataDir = path.join(process.cwd(), 'data')
  
  await initDb()

  // 1. Migrate Users
  const usersFile = path.join(dataDir, 'users.json')
  if (fs.existsSync(usersFile)) {
    try {
      const users = JSON.parse(fs.readFileSync(usersFile, 'utf8'))
      console.log(`Found ${users.length} users to migrate...`)
      for (const u of users) {
        await query(
          `INSERT INTO users (id, email, name, password_hash, role, status, created_at, approved_at, reset_token, reset_token_expiry)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           ON CONFLICT (id) DO UPDATE SET
             email = EXCLUDED.email,
             name = EXCLUDED.name,
             password_hash = EXCLUDED.password_hash,
             role = EXCLUDED.role,
             status = EXCLUDED.status,
             approved_at = EXCLUDED.approved_at`,
          [
            u.id,
            u.email.toLowerCase().trim(),
            u.name || 'User',
            u.passwordHash,
            u.role || 'user',
            u.status || 'approved',
            u.createdAt || Date.now(),
            u.approvedAt || null,
            u.resetToken || null,
            u.resetTokenExpiry || null,
          ]
        )
      }
      console.log('✅ Users migrated successfully.')
    } catch (e) {
      console.error('Error migrating users:', (e as Error).message)
    }
  }

  // 2. Migrate Projects
  const projectsFile = path.join(dataDir, 'projects.json')
  if (fs.existsSync(projectsFile)) {
    try {
      const projects = JSON.parse(fs.readFileSync(projectsFile, 'utf8'))
      console.log(`Found ${projects.length} projects to migrate...`)
      for (const p of projects) {
        await query(
          `INSERT INTO projects (id, user_id, name, description, created_at, updated_at, settings)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (id) DO UPDATE SET
             name = EXCLUDED.name,
             description = EXCLUDED.description,
             updated_at = EXCLUDED.updated_at,
             settings = EXCLUDED.settings`,
          [
            p.id,
            p.userId || 'admin_primary',
            p.name || 'Untitled Project',
            p.description || '',
            p.createdAt || Date.now(),
            p.updatedAt || Date.now(),
            JSON.stringify(p.settings || {}),
          ]
        )
      }
      console.log('✅ Projects migrated successfully.')
    } catch (e) {
      console.error('Error migrating projects:', (e as Error).message)
    }
  }

  // 3. Migrate Storyboards
  const storyboardsFile = path.join(dataDir, 'storyboards.json')
  if (fs.existsSync(storyboardsFile)) {
    try {
      const storyboards = JSON.parse(fs.readFileSync(storyboardsFile, 'utf8'))
      const list = Array.isArray(storyboards) ? storyboards : Object.values(storyboards)
      console.log(`Found ${list.length} storyboards to migrate...`)
      for (const s of list as any[]) {
        await query(
          `INSERT INTO storyboards (id, project_id, user_id, title, shots, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (id) DO UPDATE SET
             title = EXCLUDED.title,
             shots = EXCLUDED.shots,
             updated_at = EXCLUDED.updated_at`,
          [
            s.id,
            s.projectId || 'default-project',
            s.userId || 'admin_primary',
            s.title || 'Untitled Storyboard',
            JSON.stringify(s.shots || []),
            s.createdAt || Date.now(),
            s.updatedAt || Date.now(),
          ]
        )
      }
      console.log('✅ Storyboards migrated successfully.')
    } catch (e) {
      console.error('Error migrating storyboards:', (e as Error).message)
    }
  }

  // 4. Migrate Films
  const filmsFile = path.join(dataDir, 'films.json')
  if (fs.existsSync(filmsFile)) {
    try {
      const films = JSON.parse(fs.readFileSync(filmsFile, 'utf8'))
      const list = Array.isArray(films) ? films : Object.values(films)
      console.log(`Found ${list.length} films to migrate...`)
      for (const f of list as any[]) {
        await query(
          `INSERT INTO films (id, project_id, user_id, title, file, duration, status, metadata, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           ON CONFLICT (id) DO UPDATE SET
             title = EXCLUDED.title,
             file = EXCLUDED.file,
             duration = EXCLUDED.duration,
             status = EXCLUDED.status,
             metadata = EXCLUDED.metadata`,
          [
            f.id,
            f.projectId || 'default-project',
            f.userId || 'admin_primary',
            f.title || f.name || 'Rendered Film',
            f.file || null,
            f.duration || 0,
            f.status || 'ready',
            JSON.stringify(f.metadata || {}),
            f.createdAt || Date.now(),
          ]
        )
      }
      console.log('✅ Films migrated successfully.')
    } catch (e) {
      console.error('Error migrating films:', (e as Error).message)
    }
  }

  // 5. Migrate Canvas
  const canvasFile = path.join(dataDir, 'canvas.json')
  if (fs.existsSync(canvasFile)) {
    try {
      const canvas = JSON.parse(fs.readFileSync(canvasFile, 'utf8'))
      const list = Array.isArray(canvas) ? canvas : [canvas]
      console.log(`Found canvas data to migrate...`)
      for (const c of list as any[]) {
        if (!c.id) continue
        await query(
          `INSERT INTO canvas_nodes (id, project_id, user_id, nodes, edges, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (id) DO UPDATE SET
             nodes = EXCLUDED.nodes,
             edges = EXCLUDED.edges,
             updated_at = EXCLUDED.updated_at`,
          [
            c.id,
            c.projectId || 'default-project',
            c.userId || 'admin_primary',
            JSON.stringify(c.nodes || []),
            JSON.stringify(c.edges || []),
            c.updatedAt || Date.now(),
          ]
        )
      }
      console.log('✅ Canvas state migrated successfully.')
    } catch (e) {
      console.error('Error migrating canvas:', (e as Error).message)
    }
  }

  console.log('🎉 All existing JSON data successfully migrated to PostgreSQL!')
  process.exit(0)
}

migrate().catch((e) => {
  console.error('Migration failed:', e)
  process.exit(1)
})
