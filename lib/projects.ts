import fs from 'fs'
import path from 'path'

export interface ProjectFolder {
  name: string          // e.g. "workshop" or "Root Files"
  hasIndexHtml: boolean
  files: string[]
  path: string          // URL path, e.g., "/admin/projects/myagentfirm/workshop"
}

export interface Project {
  name: string          // e.g. "myagentfirm"
  folders: ProjectFolder[]
}

export function getProjects(): Project[] {
  const projectsDir = path.join(process.cwd(), 'projects')
  if (!fs.existsSync(projectsDir)) {
    return []
  }

  const projectNames = fs.readdirSync(projectsDir).filter(name => {
    const fullPath = path.join(projectsDir, name)
    return fs.statSync(fullPath).isDirectory() && !name.startsWith('.')
  })

  const projects: Project[] = []

  for (const name of projectNames) {
    const projectPath = path.join(projectsDir, name)
    const items = fs.readdirSync(projectPath).filter(item => !item.startsWith('.'))
    
    const folders: ProjectFolder[] = []
    
    // Check if there are files directly under the project root
    const directFiles = items.filter(item => {
      const fullPath = path.join(projectPath, item)
      return fs.statSync(fullPath).isFile()
    })
    
    if (directFiles.length > 0) {
      folders.push({
        name: 'Root Files',
        hasIndexHtml: directFiles.includes('index.html'),
        files: directFiles,
        path: `/admin/projects/${name}`
      })
    }

    // Find all subdirectories inside the project
    const subdirectories = items.filter(item => {
      const fullPath = path.join(projectPath, item)
      return fs.statSync(fullPath).isDirectory()
    })

    for (const sub of subdirectories) {
      const subPath = path.join(projectPath, sub)
      const subFiles = fs.readdirSync(subPath).filter(f => {
        const fullPath = path.join(subPath, f)
        return fs.statSync(fullPath).isFile() && !f.startsWith('.')
      })

      folders.push({
        name: sub,
        hasIndexHtml: subFiles.includes('index.html'),
        files: subFiles,
        path: `/admin/projects/${name}/${sub}`
      })
    }

    if (folders.length > 0) {
      projects.push({
        name,
        folders
      })
    }
  }

  return projects
}
