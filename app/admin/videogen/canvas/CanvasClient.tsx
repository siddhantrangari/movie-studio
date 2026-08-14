'use client'

import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'

type NodeType = 'character' | 'prompt' | 'generator'

type CanvasNode = {
  id: string
  type: NodeType
  x: number
  y: number
  data: {
    characterId?: string
    name?: string
    description?: string
    imageFile?: string
    title?: string
    prompt?: string
    seconds?: number
    cameraMotion?: string
    lens?: string
    narration?: string
    audioMode?: string
    promptId?: string
    filename?: string
    subfolder?: string
    state?: 'idle' | 'queued' | 'running' | 'done' | 'error'
    error?: string
  }
}

type CanvasEdge = {
  id: string
  source: string
  target: string
}

type Character = {
  id: string
  name: string
  description: string
  imageFile?: string
}

const label = { fontSize: '10px', color: '#96A3B6', textTransform: 'uppercase' as const, letterSpacing: '0.08em', fontWeight: 700, display: 'block', marginBottom: '0.3rem' }
const input = { width: '100%', padding: '0.6rem 0.8rem', borderRadius: '0.5rem', background: '#070c14', border: '1px solid #1a2840', color: '#F2F5FA', fontSize: '13px', outline: 'none' }

/**
 * Creates a character without leaving the canvas. The picker above is useless
 * on a fresh install otherwise — there is nothing to pick.
 */
function NewCharacterForm({ onCreated }: { onCreated: (c: Character) => void }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const save = async () => {
    if (!name.trim()) return
    setSaving(true); setErr(null)
    try {
      const fd = new FormData()
      fd.append('name', name.trim())
      fd.append('description', description.trim())
      if (file) fd.append('image', file)
      const res = await fetch('/api/admin/videogen/characters', { method: 'POST', body: fd })
      const data = await res.json()
      if (!res.ok || data.error) throw new Error(data.error || 'Could not save')
      onCreated(data.character)
      setName(''); setDescription(''); setFile(null); setOpen(false)
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} style={{
        width: '100%', padding: '0.5rem', borderRadius: '0.5rem', cursor: 'pointer',
        border: '1px dashed #1a3050', background: 'transparent', color: '#E8B94A',
        fontSize: '11px', fontWeight: 700,
      }}>
        + New character
      </button>
    )
  }

  return (
    <div style={{ padding: '0.85rem', borderRadius: '0.5rem', border: '1px dashed #1a3050', display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
      <div>
        <label style={label}>Name</label>
        <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Meera" style={input} />
      </div>
      <div>
        <label style={label}>Appearance</label>
        <input value={description} onChange={e => setDescription(e.target.value)}
          placeholder="Indian woman, late 20s, emerald saree" style={input} />
      </div>
      <div>
        <label style={label}>Reference image</label>
        <input type="file" accept="image/*" onChange={e => setFile(e.target.files?.[0] ?? null)}
          style={{ ...input, padding: '0.4rem', fontSize: '11px' }} />
      </div>
      {err && <p style={{ fontSize: '11px', color: '#f87171' }}>{err}</p>}
      <div style={{ display: 'flex', gap: '0.5rem' }}>
        <button onClick={save} disabled={saving || !name.trim()} style={{
          flex: 1, padding: '0.5rem', borderRadius: '0.4rem', border: 'none',
          background: name.trim() ? '#E8B94A' : '#1a2840',
          color: name.trim() ? '#0A1220' : '#64748b',
          fontSize: '11px', fontWeight: 700, cursor: saving || !name.trim() ? 'not-allowed' : 'pointer',
        }}>
          {saving ? 'Saving…' : 'Save character'}
        </button>
        <button onClick={() => setOpen(false)} style={{
          padding: '0.5rem 0.8rem', borderRadius: '0.4rem', cursor: 'pointer',
          border: '1px solid #1a2840', background: 'transparent', color: '#96A3B6', fontSize: '11px',
        }}>
          Cancel
        </button>
      </div>
    </div>
  )
}

export default function CanvasClient() {
  const [nodes, setNodes] = useState<CanvasNode[]>([])
  const [edges, setEdges] = useState<CanvasEdge[]>([])
  const [characters, setCharacters] = useState<Character[]>([])
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  
  // Pan and Zoom
  const [pan, setPan] = useState({ x: 100, y: 100 })
  const [zoom, setZoom] = useState(1)
  const [isPanning, setIsPanning] = useState(false)
  const panStart = useRef({ x: 0, y: 0 })

  // Active Connection Drawing state
  const [connectingSourceId, setConnectingSourceId] = useState<string | null>(null)
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 })

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [podRunning, setPodRunning] = useState(false)

  const selectedNode = nodes.find(n => n.id === selectedNodeId)

  // Load state
  useEffect(() => {
    ;(async () => {
      try {
        const [cRes, canvasRes, podRes] = await Promise.all([
          fetch('/api/admin/videogen/characters', { cache: 'no-store' }),
          fetch('/api/admin/videogen/canvas', { cache: 'no-store' }),
          fetch('/api/admin/videogen', { cache: 'no-store' }),
        ])
        
        if (cRes.ok) setCharacters((await cRes.json()).characters ?? [])
        if (canvasRes.ok) {
          const d = await canvasRes.json()
          if (d.state) {
            setNodes(d.state.nodes ?? [])
            setEdges(d.state.edges ?? [])
            setPan({ x: d.state.panX ?? 100, y: d.state.panY ?? 100 })
            setZoom(d.state.zoom ?? 1)
          }
        }
        if (podRes.ok) {
          const p = await podRes.json()
          setPodRunning(p?.ltx?.desiredStatus === 'RUNNING')
        }
      } catch (e) {
        setErr('Failed to load canvas state')
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  const persistCanvas = async (updatedNodes = nodes, updatedEdges = edges, updatedPan = pan, updatedZoom = zoom) => {
    setSaving(true)
    try {
      await fetch('/api/admin/videogen/canvas', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nodes: updatedNodes,
          edges: updatedEdges,
          panX: updatedPan.x,
          panY: updatedPan.y,
          zoom: updatedZoom,
        }),
      })
    } catch {
      // ignore
    } finally {
      setSaving(false)
    }
  }

  // Pan Board handlers
  const handleMouseDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('.canvas-node') || (e.target as HTMLElement).closest('.node-handle')) return
    setIsPanning(true)
    panStart.current = { x: e.clientX - pan.x, y: e.clientY - pan.y }
  }

  const handleMouseMove = (e: React.MouseEvent) => {
    const rect = e.currentTarget.getBoundingClientRect()
    // Relative coordinates inside canvas container for drawing connection line
    const x = (e.clientX - rect.left - pan.x) / zoom
    const y = (e.clientY - rect.top - pan.y) / zoom
    setMousePos({ x, y })

    if (isPanning) {
      const nextPan = { x: e.clientX - panStart.current.x, y: e.clientY - panStart.current.y }
      setPan(nextPan)
    }
  }

  const handleMouseUp = () => {
    setIsPanning(false)
    if (isPanning) {
      persistCanvas()
    }
    setConnectingSourceId(null)
  }

  // Zoom handlers
  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault()
    const nextZoom = Math.min(1.5, Math.max(0.5, zoom - e.deltaY * 0.001))
    setZoom(nextZoom)
    persistCanvas(nodes, edges, pan, nextZoom)
  }

  // Node CRUD
  const addNode = (type: NodeType) => {
    const id = Math.random().toString(36).slice(2, 10)
    // Offset slightly relative to center of screen
    const x = (-pan.x + window.innerWidth / 2) / zoom
    const y = (-pan.y + window.innerHeight / 2) / zoom
    
    const newNode: CanvasNode = {
      id,
      type,
      x,
      y,
      data: type === 'character' ? { name: 'Soul ID', description: 'Appearance notes...' }
            : type === 'prompt' ? { title: 'Scene Prompt', prompt: '', seconds: 8, cameraMotion: 'dolly_out', lens: 'cinematic' }
            : { state: 'idle' }
    }

    const nextNodes = [...nodes, newNode]
    setNodes(nextNodes)
    setSelectedNodeId(id)
    persistCanvas(nextNodes)
  }

  const deleteSelectedNode = () => {
    if (!selectedNodeId) return
    const nextNodes = nodes.filter(n => n.id !== selectedNodeId)
    const nextEdges = edges.filter(e => e.source !== selectedNodeId && e.target !== selectedNodeId)
    setNodes(nextNodes)
    setEdges(nextEdges)
    setSelectedNodeId(null)
    persistCanvas(nextNodes, nextEdges)
  }

  // Connection/Edge builders
  const startConnection = (e: React.MouseEvent, nodeId: string) => {
    e.stopPropagation()
    setConnectingSourceId(nodeId)
  }

  const completeConnection = (e: React.MouseEvent, targetId: string) => {
    e.stopPropagation()
    if (!connectingSourceId || connectingSourceId === targetId) return

    // Ensure source to target flows correctly: character -> prompt -> generator
    const sourceNode = nodes.find(n => n.id === connectingSourceId)
    const targetNode = nodes.find(n => n.id === targetId)
    if (!sourceNode || !targetNode) return

    const isValid = (sourceNode.type === 'character' && targetNode.type === 'prompt') ||
                    (sourceNode.type === 'prompt' && targetNode.type === 'generator')
    
    if (!isValid) return

    // Remove existing connections to target to maintain 1-to-1 pipeline mapping
    const filteredEdges = edges.filter(edge => edge.target !== targetId)
    const newEdge: CanvasEdge = {
      id: `${connectingSourceId}-${targetId}`,
      source: connectingSourceId,
      target: targetId,
    }

    const nextEdges = [...filteredEdges, newEdge]
    setEdges(nextEdges)
    setConnectingSourceId(null)
    persistCanvas(nodes, nextEdges)
  }

  // Node position drag handlers
  const handleNodeDragStart = (e: React.DragEvent, node: CanvasNode) => {
    e.dataTransfer.setData('application/reactflow', node.id)
    // Create dummy image so ghost image is invisible
    const img = new Image()
    img.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'
    e.dataTransfer.setDragImage(img, 0, 0)
  }

  const handleNodeDrag = (e: React.DragEvent, node: CanvasNode) => {
    if (e.clientX === 0 && e.clientY === 0) return // Skip last empty drag frame
    const rect = e.currentTarget.parentElement?.getBoundingClientRect()
    if (!rect) return
    const x = (e.clientX - rect.left - pan.x) / zoom - 100 // offset half width
    const y = (e.clientY - rect.top - pan.y) / zoom - 40 // offset half height
    
    setNodes(prev => prev.map(n => n.id === node.id ? { ...n, x, y } : n))
  }

  const updateNodeData = (nodeId: string, patch: any) => {
    const nextNodes = nodes.map(n => {
      if (n.id === nodeId) {
        return { ...n, data: { ...n.data, ...patch } }
      }
      return n
    })
    setNodes(nextNodes)
    persistCanvas(nextNodes)
  }

  // Trigger video generation for a node
  const generateVideo = async (node: CanvasNode) => {
    if (!podRunning) return
    
    // Find character linked to this prompt (if any)
    const linkedPromptEdge = edges.find(e => e.target === node.id && nodes.find(n => n.id === e.source)?.type === 'prompt')
    const promptNode = linkedPromptEdge ? nodes.find(n => n.id === linkedPromptEdge.source) : null
    if (!promptNode) return

    const linkedCharEdge = edges.find(e => e.target === promptNode.id && nodes.find(n => n.id === e.source)?.type === 'character')
    const characterNode = linkedCharEdge ? nodes.find(n => n.id === linkedCharEdge.source) : null

    updateNodeData(node.id, { state: 'queued', error: undefined, filename: undefined })
    
    try {
      const res = await fetch('/api/admin/videogen/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: promptNode.data.prompt,
          seconds: promptNode.data.seconds,
          characterId: characterNode?.data?.characterId,
          cameraMotion: promptNode.data.cameraMotion,
          lens: promptNode.data.lens,
        }),
      })
      const data = await res.json()
      if (!res.ok || data.error) throw new Error(data.error || 'Generation failed')
      updateNodeData(node.id, { promptId: data.promptId, state: 'queued' })
    } catch (e) {
      updateNodeData(node.id, { state: 'error', error: (e as Error).message })
    }
  }

  // Poll status of generating nodes
  const pendingPromptIds = nodes
    .filter(n => n.type === 'generator' && n.data.promptId && (n.data.state === 'queued' || n.data.state === 'running'))
    .map(n => n.data.promptId!)
    .join(',')

  useEffect(() => {
    if (!pendingPromptIds) return
    const interval = setInterval(async () => {
      try {
        const r = await fetch(`/api/admin/videogen/status?ids=${pendingPromptIds}`)
        if (!r.ok) return
        const data = await r.json()
        if (data.jobs) {
          setNodes(prev => prev.map(n => {
            if (n.type === 'generator' && n.data.promptId && data.jobs[n.data.promptId]) {
              const u = data.jobs[n.data.promptId]
              if (u.state !== n.data.state) {
                return { ...n, data: { ...n.data, ...u } }
              }
            }
            return n
          }))
        }
      } catch {
        // ignore
      }
    }, 4000)
    return () => clearInterval(interval)
  }, [pendingPromptIds])

  if (loading) {
    return (
      <main className="grid-bg" style={{ background: '#05080e', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <p style={{ color: '#96A3B6', fontSize: '13px' }}>Loading Cinema Canvas…</p>
      </main>
    )
  }

  return (
    <main className="grid-bg" style={{ background: '#05080e', minHeight: '100vh', position: 'relative', overflow: 'hidden', userSelect: 'none' }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onWheel={handleWheel}
    >
      {/* Header Panel */}
      <header style={{
        position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '1rem 2rem', background: 'rgba(5, 8, 14, 0.85)',
        backdropFilter: 'blur(12px)', borderBottom: '1px solid #1a2840',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <Link href="/admin/videogen" style={{ color: '#96A3B6', fontSize: '12px', textDecoration: 'none' }} className="hover-white-transition">
            ← Traditional Board
          </Link>
          <span style={{ color: '#1a2840' }}>|</span>
          <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, color: 'var(--gold)', fontSize: '1.05rem' }}>
            🌌 Higgsfield Canvas
          </span>
        </div>

        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button onClick={() => addNode('character')} style={{ fontSize: '11px', padding: '0.45rem 0.9rem', fontWeight: 700, borderRadius: '0.4rem', border: '1px solid #1a2840', background: '#0e182e', color: '#F2F5FA', cursor: 'pointer' }}>
            + Character (Soul ID)
          </button>
          <button onClick={() => addNode('prompt')} style={{ fontSize: '11px', padding: '0.45rem 0.9rem', fontWeight: 700, borderRadius: '0.4rem', border: '1px solid #1a2840', background: '#0e182e', color: '#F2F5FA', cursor: 'pointer' }}>
            + Prompt Node
          </button>
          <button onClick={() => addNode('generator')} style={{ fontSize: '11px', padding: '0.45rem 0.9rem', fontWeight: 700, borderRadius: '0.4rem', border: '1px solid #1a2840', background: '#0e182e', color: '#F2F5FA', cursor: 'pointer' }}>
            + Video Generator
          </button>
        </div>
      </header>

      {/* Infinite Canvas Space */}
      <div style={{
        width: '100%', height: '100vh', position: 'absolute', top: 0, left: 0,
        transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
        transformOrigin: '0 0',
      }}>
        {/* Render Connection Lines (Edges) */}
        <svg style={{ position: 'absolute', top: 0, left: 0, width: '5000px', height: '5000px', pointerEvents: 'none' }}>
          {edges.map(edge => {
            const src = nodes.find(n => n.id === edge.source)
            const dest = nodes.find(n => n.id === edge.target)
            if (!src || !dest) return null
            const x1 = src.x + 220
            const y1 = src.y + 40
            const x2 = dest.x
            const y2 = dest.y + 40
            return (
              <path key={edge.id} d={`M ${x1} ${y1} C ${(x1 + x2) / 2} ${y1}, ${(x1 + x2) / 2} ${y2}, ${x2} ${y2}`}
                fill="none" stroke="var(--gold)" strokeWidth="2.5" opacity="0.6" />
            )
          })}
          {/* Active drag connection line */}
          {connectingSourceId && (() => {
            const src = nodes.find(n => n.id === connectingSourceId)
            if (!src) return null
            const x1 = src.x + 220
            const y1 = src.y + 40
            return (
              <path d={`M ${x1} ${y1} C ${(x1 + mousePos.x) / 2} ${y1}, ${(x1 + mousePos.x) / 2} ${mousePos.y}, ${mousePos.x} ${mousePos.y}`}
                fill="none" stroke="#96A3B6" strokeWidth="2" strokeDasharray="4 4" />
            )
          })()}
        </svg>

        {/* Nodes */}
        {nodes.map(node => {
          const isSelected = node.id === selectedNodeId
          return (
            <div
              key={node.id}
              className="canvas-node"
              draggable
              onDragStart={(e) => handleNodeDragStart(e, node)}
              onDrag={(e) => handleNodeDrag(e, node)}
              onDragEnd={() => persistCanvas()}
              onClick={(e) => {
                e.stopPropagation()
                setSelectedNodeId(node.id)
              }}
              style={{
                position: 'absolute', left: node.x, top: node.y,
                width: '220px', borderRadius: '0.75rem', background: '#0e182e',
                border: isSelected ? '2px solid var(--gold)' : '1px solid #1a2840',
                boxShadow: isSelected ? '0 0 20px rgba(232, 185, 74, 0.15)' : '0 4px 12px rgba(0,0,0,0.3)',
                padding: '0.85rem', cursor: 'move', color: '#F2F5FA',
              }}
            >
              {/* Input Connection handle (left side) */}
              {node.type !== 'character' && (
                <div
                  className="node-handle"
                  onMouseUp={(e) => completeConnection(e, node.id)}
                  style={{
                    position: 'absolute', left: '-6px', top: '35px',
                    width: '12px', height: '12px', borderRadius: '50%',
                    background: '#1a2840', border: '2px solid #96A3B6',
                    cursor: 'crosshair',
                  }}
                  title="Connect pipeline input"
                />
              )}

              {/* Output Connection handle (right side) */}
              {node.type !== 'generator' && (
                <div
                  className="node-handle"
                  onMouseDown={(e) => startConnection(e, node.id)}
                  style={{
                    position: 'absolute', right: '-6px', top: '35px',
                    width: '12px', height: '12px', borderRadius: '50%',
                    background: 'var(--gold)', border: '2px solid #0e182e',
                    cursor: 'crosshair',
                  }}
                  title="Drag connection to next node"
                />
              )}

              <p style={{ fontSize: '9px', textTransform: 'uppercase', color: 'var(--gold)', fontWeight: 700, letterSpacing: '0.12em', marginBottom: '0.3rem' }}>
                {node.type} node
              </p>

              {node.type === 'character' && (
                <div>
                  <p style={{ fontWeight: 'bold', fontSize: '13px' }}>{node.data.name || 'Unnamed'}</p>
                  <p style={{ fontSize: '11px', color: '#96A3B6', marginTop: '0.2rem' }}>{node.data.description || 'No description'}</p>
                </div>
              )}

              {node.type === 'prompt' && (
                <div>
                  <p style={{ fontWeight: 'bold', fontSize: '13px' }}>{node.data.title || 'Untitled Scene'}</p>
                  <p style={{ fontSize: '11px', color: '#96A3B6', marginTop: '0.2rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {node.data.prompt || 'Write prompt details...'}
                  </p>
                </div>
              )}

              {node.type === 'generator' && (
                <div>
                  {node.data.filename ? (
                    <video src={`/api/admin/videogen/video?filename=${encodeURIComponent(node.data.filename)}&subfolder=${encodeURIComponent(node.data.subfolder ?? 'gen')}`}
                      controls loop playsInline style={{ width: '100%', borderRadius: '0.3rem', background: '#000' }} />
                  ) : (
                    <div style={{ height: '80px', background: '#070c14', borderRadius: '0.3rem', border: '1px dashed #1a2840', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', color: '#96A3B6' }}>
                      {node.data.state === 'queued' ? 'Queued…'
                        : node.data.state === 'running' ? 'Generating…'
                        : node.data.state === 'error' ? 'Error'
                        : 'Not generated'}
                    </div>
                  )}
                  <button onClick={() => generateVideo(node)} disabled={!podRunning || node.data.state === 'queued' || node.data.state === 'running'}
                    style={{
                      width: '100%', marginTop: '0.5rem', padding: '0.4rem', border: 'none', borderRadius: '0.3rem',
                      background: podRunning ? 'var(--gold)' : '#1a2840',
                      color: podRunning ? '#0e182e' : '#96A3B6',
                      fontWeight: 'bold', fontSize: '11px', cursor: 'pointer',
                    }}>
                    Generate Video
                  </button>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Right Inspector Panel */}
      {selectedNode && (
        <aside style={{
          position: 'absolute', top: '65px', right: '20px', bottom: '20px', width: '320px',
          background: 'rgba(14, 24, 46, 0.88)', border: '1px solid #1a2840', borderRadius: '0.75rem',
          backdropFilter: 'blur(12px)', zIndex: 10, padding: '1.25rem', overflowY: 'auto',
          display: 'flex', flexDirection: 'column', gap: '1rem', color: '#F2F5FA',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <p style={{ ...label, marginBottom: 0 }}>Inspector ({selectedNode.type})</p>
            <button onClick={deleteSelectedNode} style={{ background: 'none', border: 'none', color: '#f87171', fontSize: '11px', cursor: 'pointer' }}>
              Delete Node
            </button>
          </div>

          {selectedNode.type === 'character' && (
            <>
              <div>
                <label style={label}>Soul ID Name</label>
                <select value={selectedNode.data.characterId ?? ''}
                  onChange={(e) => {
                    const c = characters.find(x => x.id === e.target.value)
                    updateNodeData(selectedNode.id, {
                      characterId: e.target.value || undefined,
                      name: c?.name || 'Unnamed',
                      description: c?.description || 'Appearance notes...',
                      imageFile: c?.imageFile,
                    })
                  }}
                  style={input}
                >
                  <option value="">Select Character Profile</option>
                  {characters.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>

              {selectedNode.data.imageFile && (
                <div>
                  <label style={label}>Reference Avatar</label>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`/api/admin/videogen/characters?image=${encodeURIComponent(selectedNode.data.imageFile)}`}
                    alt={selectedNode.data.name}
                    style={{ width: '100%', height: '140px', objectFit: 'cover', borderRadius: '0.5rem', border: '1px solid #1a2840' }} />
                </div>
              )}

              <NewCharacterForm
                onCreated={(c) => {
                  setCharacters(prev => [...prev, c])
                  updateNodeData(selectedNode.id, {
                    characterId: c.id,
                    name: c.name,
                    description: c.description,
                    imageFile: c.imageFile,
                  })
                }}
              />
            </>
          )}

          {selectedNode.type === 'prompt' && (
            <>
              <div>
                <label style={label}>Scene Name</label>
                <input value={selectedNode.data.title ?? ''} onChange={e => updateNodeData(selectedNode.id, { title: e.target.value })} style={input} />
              </div>

              <div>
                <label style={label}>Camera Motion (Director Override)</label>
                <select value={selectedNode.data.cameraMotion ?? 'dolly_out'}
                  onChange={e => updateNodeData(selectedNode.id, { cameraMotion: e.target.value })}
                  style={input}
                >
                  <option value="dolly_in">Dolly In</option>
                  <option value="dolly_out">Dolly Out</option>
                  <option value="pan_left">Pan Left</option>
                  <option value="pan_right">Pan Right</option>
                  <option value="tilt_up">Tilt Up</option>
                  <option value="tilt_down">Tilt Down</option>
                  <option value="zoom_in">Zoom In</option>
                  <option value="zoom_out">Zoom Out</option>
                </select>
              </div>

              <div>
                <label style={label}>Lens Style</label>
                <select value={selectedNode.data.lens ?? 'cinematic'}
                  onChange={e => updateNodeData(selectedNode.id, { lens: e.target.value })}
                  style={input}
                >
                  <option value="cinematic">Cinematic Prime</option>
                  <option value="wide">Wide-Angle 18mm</option>
                  <option value="portrait">Portrait 85mm</option>
                </select>
              </div>

              <div>
                <label style={label}>Prompt Text</label>
                <textarea value={selectedNode.data.prompt ?? ''}
                  onChange={e => updateNodeData(selectedNode.id, { prompt: e.target.value })}
                  rows={4}
                  style={{ ...input, resize: 'vertical' }}
                />
              </div>

              <div>
                <label style={label}>Duration</label>
                <select value={selectedNode.data.seconds ?? 8}
                  onChange={e => updateNodeData(selectedNode.id, { seconds: Number(e.target.value) })}
                  style={input}
                >
                  {[2, 3, 4, 5, 6, 8, 10].map(s => <option key={s} value={s}>{s}s</option>)}
                </select>
              </div>
            </>
          )}

          {selectedNode.type === 'generator' && selectedNode.data.error && (
            <div>
              <label style={{ ...label, color: '#f87171' }}>Error Details</label>
              <p style={{ fontSize: '11px', color: '#f87171', lineHeight: 1.5 }}>{selectedNode.data.error}</p>
            </div>
          )}
        </aside>
      )}
    </main>
  )
}
