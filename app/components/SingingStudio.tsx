'use client'

import React, { useState, useRef, useEffect } from 'react'
import { useToast } from './Toast'

export interface MusicScene {
  order: number
  title: string
  startSec: number
  endSec: number
  durationSec: number
  camera: string
  lighting: string
  prompt: string
  status?: 'idle' | 'generating' | 'done' | 'error'
  progress?: number
  step?: number
  maxStep?: number
  videoUrl?: string
  filename?: string
  error?: string
}

interface CharacterOption {
  id: string
  name: string
  imageUrl?: string
  tag?: string
}

interface SingingStudioProps {
  projectId: string
  characters?: CharacterOption[]
  savedReferences?: { key: string; filename: string; url: string }[]
  onOpenRefLibrary?: () => void
  onNavigateToEngines?: () => void
}

const STYLE_PRESETS = [
  'Cyberpunk Neon Concert',
  'Cinematic Retro 70s Soul',
  'K-Pop Hologram Arena',
  'Sunset Acoustic Beach Stage',
  'Dark Fantasy Opera Cathedral',
  'Anime Idol Holographic Stage',
  'Neon Noir Jazz Club',
  'Hyper-Realistic Studio Session',
]

export default function SingingStudio({
  projectId,
  characters = [],
  savedReferences = [],
  onOpenRefLibrary,
  onNavigateToEngines,
}: SingingStudioProps) {
  const { toast } = useToast()
  // Step 1: Song & Performer state
  const [songTitle, setSongTitle] = useState('Electric Horizon')
  const [genre, setGenre] = useState('Synthwave / Pop')
  const [mood, setMood] = useState('Energetic & Uplifting')
  const [lyricsTheme, setLyricsTheme] = useState('Chasing dreams under neon city lights')
  const [stylePreset, setStylePreset] = useState(STYLE_PRESETS[0])
  const [performerDesc, setPerformerDesc] = useState('Charismatic lead singer with expressive eyes')
  const [selectedPerformerUrl, setSelectedPerformerUrl] = useState<string>('')
  const [songAudioFile, setSongAudioFile] = useState<File | null>(null)
  const [songAudioBase64, setSongAudioBase64] = useState<string>('')
  const [songDuration, setSongDuration] = useState<number>(45)
  const [segmentDuration, setSegmentDuration] = useState<number>(15)

  // Step 2: Storyboard state
  const [scenes, setScenes] = useState<MusicScene[]>([])
  const [logline, setLogline] = useState('')
  const [buildingStoryboard, setBuildingStoryboard] = useState(false)
  const [regeneratingIndex, setRegeneratingIndex] = useState<number | null>(null)
  const [revisionNotes, setRevisionNotes] = useState<Record<number, string>>({})

  // Step 3: Multi-part generation state
  const [isGeneratingAll, setIsGeneratingAll] = useState(false)
  const [currentGeneratingIndex, setCurrentGeneratingIndex] = useState<number | null>(null)
  const [assembledVideoUrl, setAssembledVideoUrl] = useState<string | null>(null)
  const [isAssembling, setIsAssembling] = useState(false)
  const [podDownloading, setPodDownloading] = useState(false) // true when pod is still pulling model weights
  const [podDownloadProgress, setPodDownloadProgress] = useState(0) // 0-100 estimated

  // Inject CSS animations for shimmer + pulse
  useEffect(() => {
    const id = 'singing-studio-animations'
    if (document.getElementById(id)) return
    const style = document.createElement('style')
    style.id = id
    style.textContent = `
      @keyframes ss-shimmer {
        0% { background-position: -200% center; }
        100% { background-position: 200% center; }
      }
      @keyframes ss-pulse-border {
        0%, 100% { box-shadow: 0 0 0 0 rgba(232,185,74,0.4); }
        50% { box-shadow: 0 0 0 6px rgba(232,185,74,0); }
      }
      @keyframes ss-spin {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
      }
      @keyframes ss-download-pulse {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.5; }
      }
      .ss-shimmer-bar {
        background: linear-gradient(90deg, #e8b94a 0%, #c084fc 40%, #60a5fa 60%, #e8b94a 100%);
        background-size: 200% 100%;
        animation: ss-shimmer 1.6s linear infinite;
      }
      .ss-download-bar {
        background: linear-gradient(90deg, #3b82f6 0%, #06b6d4 50%, #3b82f6 100%);
        background-size: 200% 100%;
        animation: ss-shimmer 2s linear infinite;
      }
      .ss-generating-card {
        animation: ss-pulse-border 2s ease-in-out infinite;
      }
    `
    document.head.appendChild(style)
    return () => { document.getElementById(id)?.remove() }
  }, [])

  const audioInputRef = useRef<HTMLInputElement>(null)
  const performerInputRef = useRef<HTMLInputElement>(null)

  // Load persisted state on mount
  useEffect(() => {
    try {
      const storageKey = `singing_studio_${projectId || 'default'}`
      const saved = localStorage.getItem(storageKey)
      if (saved) {
        const parsed = JSON.parse(saved)
        if (parsed.songTitle) setSongTitle(parsed.songTitle)
        if (parsed.genre) setGenre(parsed.genre)
        if (parsed.mood) setMood(parsed.mood)
        if (parsed.lyricsTheme) setLyricsTheme(parsed.lyricsTheme)
        if (parsed.stylePreset) setStylePreset(parsed.stylePreset)
        if (parsed.performerDesc) setPerformerDesc(parsed.performerDesc)
        if (parsed.selectedPerformerUrl) setSelectedPerformerUrl(parsed.selectedPerformerUrl)
        if (parsed.songDuration) setSongDuration(parsed.songDuration)
        if (parsed.segmentDuration) setSegmentDuration(parsed.segmentDuration)
        if (parsed.scenes && Array.isArray(parsed.scenes) && parsed.scenes.length > 0) setScenes(parsed.scenes)
        if (parsed.logline) setLogline(parsed.logline)
        if (parsed.assembledVideoUrl) setAssembledVideoUrl(parsed.assembledVideoUrl)
        if (parsed.songAudioBase64) setSongAudioBase64(parsed.songAudioBase64)
      }
    } catch {
      // ignore
    }
  }, [projectId])

  // Persist state to localStorage whenever critical fields change
  useEffect(() => {
    try {
      const storageKey = `singing_studio_${projectId || 'default'}`
      const stateToSave = {
        songTitle,
        genre,
        mood,
        lyricsTheme,
        stylePreset,
        performerDesc,
        selectedPerformerUrl,
        songDuration,
        segmentDuration,
        scenes,
        logline,
        assembledVideoUrl,
        songAudioBase64: songAudioBase64 && songAudioBase64.length < 2000000 ? songAudioBase64 : '',
      }
      localStorage.setItem(storageKey, JSON.stringify(stateToSave))
    } catch {
      // ignore
    }
  }, [projectId, songTitle, genre, mood, lyricsTheme, stylePreset, performerDesc, selectedPerformerUrl, songDuration, segmentDuration, scenes, logline, assembledVideoUrl, songAudioBase64])

  // Audio file handler
  const handleAudioUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setSongAudioFile(file)
    setSongTitle(file.name.replace(/\.[^/.]+$/, ''))

    // Extract duration via Audio object
    const audio = new Audio()
    const objectUrl = URL.createObjectURL(file)
    audio.src = objectUrl
    audio.onloadedmetadata = () => {
      if (audio.duration && !isNaN(audio.duration)) {
        setSongDuration(Math.round(audio.duration))
      }
      URL.revokeObjectURL(objectUrl)
    }

    const reader = new FileReader()
    reader.onload = () => {
      setSongAudioBase64(reader.result as string)
    }
    reader.readAsDataURL(file)
    toast.success(`Audio uploaded: ${file.name}`)
  }

  // Performer image upload
  const handlePerformerUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      setSelectedPerformerUrl(reader.result as string)
    }
    reader.readAsDataURL(file)
    toast.success(`Performer image selected: ${file.name}`)
  }

  // Generate full storyboard with AI
  const handleBuildStoryboard = async () => {
    setBuildingStoryboard(true)
    try {
      const res = await fetch('/api/videogen/singing/prompt-builder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'storyboard',
          songTitle,
          genre,
          mood,
          lyricsTheme,
          stylePreset,
          performerDesc,
          songDuration,
          segmentDuration,
        }),
      })

      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error(d.error || 'Failed to generate storyboard')
      }

      const data = await res.json()
      if (data.scenes && Array.isArray(data.scenes)) {
        setScenes(data.scenes.map((s: any) => ({ ...s, status: 'idle' })))
        if (data.logline) setLogline(data.logline)
        toast.success(`✨ Storyboard generated with ${data.scenes.length} dynamic scenes!`)
      }
    } catch (err: any) {
      toast.error(err.message || 'Storyboard generation failed')
    } finally {
      setBuildingStoryboard(false)
    }
  }

  // Regenerate single scene prompt
  const handleRegenerateScene = async (index: number) => {
    setRegeneratingIndex(index)
    const targetScene = scenes[index]
    if (!targetScene) return

    try {
      const res = await fetch('/api/videogen/singing/prompt-builder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'regenerate_scene',
          songTitle,
          genre,
          mood,
          lyricsTheme,
          stylePreset,
          performerDesc,
          sceneIndex: index,
          currentPrompt: targetScene.prompt,
          revisionNotes: revisionNotes[index] || '',
        }),
      })

      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error(d.error || 'Failed to regenerate prompt')
      }

      const data = await res.json()
      if (data.scene) {
        setScenes((prev) =>
          prev.map((s, idx) =>
            idx === index
              ? {
                  ...s,
                  title: data.scene.title || s.title,
                  camera: data.scene.camera || s.camera,
                  lighting: data.scene.lighting || s.lighting,
                  prompt: data.scene.prompt || s.prompt,
                }
              : s
          )
        )
        toast.success(`🔄 Scene #${index + 1} prompt updated!`)
      }
    } catch (err: any) {
      toast.error(err.message || 'Failed to regenerate scene prompt')
    } finally {
      setRegeneratingIndex(null)
    }
  }

  // Cancellation ref to immediately abort active polling loops
  const cancelledRef = useRef<Record<number, boolean>>({})

  // Cancel / Reset a single scene generation
  const handleCancelScene = (index: number) => {
    cancelledRef.current[index] = true
    setScenes((prev) =>
      prev.map((s, idx) => (idx === index ? { ...s, status: 'idle', progress: 0, step: 0, error: undefined } : s))
    )
    if (currentGeneratingIndex === index) {
      setCurrentGeneratingIndex(null)
    }
    setPodDownloading(false)
    toast.info(`Scene Part #${index + 1} generation cancelled.`)
  }

  // Delete a single scene part
  const handleDeleteScene = (index: number) => {
    cancelledRef.current[index] = true
    if (currentGeneratingIndex === index) {
      setCurrentGeneratingIndex(null)
    }
    setScenes((prev) => {
      const filtered = prev.filter((_, idx) => idx !== index)
      let curSec = 0
      return filtered.map((s, idx) => {
        const dur = s.durationSec || segmentDuration
        const start = curSec
        const end = curSec + dur
        curSec = end
        return {
          ...s,
          order: idx + 1,
          startSec: start,
          endSec: end,
        }
      })
    })
    toast.info(`Scene Part #${index + 1} removed.`)
  }

  // Add a new scene part manually
  const handleAddScene = () => {
    const lastScene = scenes[scenes.length - 1]
    const startSec = lastScene ? lastScene.endSec : 0
    const endSec = startSec + segmentDuration
    const newPartNum = scenes.length + 1
    const newScene: MusicScene = {
      order: newPartNum,
      title: `Part ${newPartNum} Scene`,
      startSec,
      endSec,
      durationSec: segmentDuration,
      camera: 'Medium close-up slow push in',
      lighting: 'Neon stage lighting',
      prompt: `<Picture 1> is the identity reference for the ${performerDesc}. <Audio 1> is the vocal reference for "${songTitle}". The singer performs with expressive lip sync and charisma under ${stylePreset.toLowerCase()} atmosphere.`,
      status: 'idle',
    }
    setScenes((prev) => [...prev, newScene])
    toast.success(`Part #${newPartNum} added to storyboard.`)
  }

  // Dismiss / Clear all storyboard scenes
  const handleClearStoryboard = () => {
    scenes.forEach((_, idx) => {
      cancelledRef.current[idx] = true
    })
    setIsGeneratingAll(false)
    setCurrentGeneratingIndex(null)
    setPodDownloading(false)
    setScenes([])
    setLogline('')
    setAssembledVideoUrl(null)
    try {
      const storageKey = `singing_studio_${projectId || 'default'}`
      const saved = localStorage.getItem(storageKey)
      if (saved) {
        const parsed = JSON.parse(saved)
        parsed.scenes = []
        parsed.logline = ''
        parsed.assembledVideoUrl = null
        localStorage.setItem(storageKey, JSON.stringify(parsed))
      }
    } catch {
      // ignore
    }
    toast.info('Storyboard cleared and dismissed.')
  }

  // Cancel all active batch generations
  const handleCancelAll = () => {
    scenes.forEach((_, idx) => {
      cancelledRef.current[idx] = true
    })
    setIsGeneratingAll(false)
    setCurrentGeneratingIndex(null)
    setPodDownloading(false)
    setScenes((prev) =>
      prev.map((s) => (s.status === 'generating' ? { ...s, status: 'idle', progress: 0, step: 0, error: undefined } : s))
    )
    toast.info('Batch generation stopped.')
  }

  // Generate single part via MiniMax Ref2VA
  const generateSingleScene = async (index: number): Promise<boolean> => {
    const sc = scenes[index]
    if (!sc) return false

    cancelledRef.current[index] = false
    setScenes((prev) =>
      prev.map((s, idx) => (idx === index ? { ...s, status: 'generating', progress: 0, step: 0, error: undefined } : s))
    )
    setCurrentGeneratingIndex(index)
    const startTime = Date.now()

    try {
      const refList: string[] = []
      if (selectedPerformerUrl) refList.push(selectedPerformerUrl)

      const res = await fetch('/api/videogen/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: sc.prompt,
          label: `Music Video: ${sc.title}`,
          seconds: sc.durationSec || segmentDuration,
          model: 'minimax',
          projectId,
          referenceImages: refList,
          audioFile: songAudioBase64 || undefined,
        }),
      })

      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error(d.error || 'Generation failed to start')
      }

      const data = await res.json()
      const promptId = data.promptId

      // Poll generation status
      let done = false
      let downloadWarned = false
      while (!done) {
        if (cancelledRef.current[index]) {
          setPodDownloading(false)
          return false
        }

        await new Promise((r) => setTimeout(r, 4000))

        if (cancelledRef.current[index]) {
          setPodDownloading(false)
          return false
        }

        // Timeout check (30 min)
        const elapsedSec = (Date.now() - startTime) / 1000
        if (elapsedSec > 1800) {
          throw new Error('Generation timed out (30 mins exceeded). Please try rendering again.')
        }

        const statusRes = await fetch(`/api/videogen/status?promptId=${promptId}&podId=${data.podId || ''}`)
        if (!statusRes.ok) continue
        const statusData = await statusRes.json()

        // Pod is still booting / downloading weights — show download state
        if (statusData.state === 'queued' || statusData.state === 'pending') {
          if (!downloadWarned) {
            downloadWarned = true
            setPodDownloading(true)
          }
          const estimatedPct = Math.min(95, Math.round((elapsedSec / 900) * 100))
          setPodDownloadProgress(estimatedPct)
          setScenes((prev) =>
            prev.map((s, idx) =>
              idx === index
                ? { ...s, progress: estimatedPct, step: 0, maxStep: 18 }
                : s
            )
          )
          continue
        }

        // Job is running — clear downloading state
        setPodDownloading(false)

        if (statusData.state === 'running' || statusData.state === 'executing') {
          setScenes((prev) =>
            prev.map((s, idx) =>
              idx === index
                ? {
                    ...s,
                    progress: statusData.progress || s.progress,
                    step: statusData.step,
                    maxStep: statusData.maxStep,
                  }
                : s
            )
          )
        } else if (statusData.state === 'done') {
          done = true
          setPodDownloading(false)
          setScenes((prev) =>
            prev.map((s, idx) =>
              idx === index
                ? {
                    ...s,
                    status: 'done',
                    progress: 100,
                    videoUrl: statusData.videoUrl || `/api/videogen/video?file=${encodeURIComponent(statusData.filename || '')}`,
                    filename: statusData.filename,
                  }
                : s
            )
          )
          toast.success(`✓ Part ${index + 1} generated successfully!`)
          return true
        } else if (statusData.state === 'error') {
          throw new Error(statusData.error || 'Scene generation error')
        }
      }
      return true
    } catch (err: any) {
      setPodDownloading(false)
      setScenes((prev) =>
        prev.map((s, idx) => (idx === index ? { ...s, status: 'error', error: err.message } : s))
      )
      toast.error(`Part ${index + 1} failed: ${err.message}`)
      return false
    } finally {
      if (currentGeneratingIndex === index) {
        setCurrentGeneratingIndex(null)
      }
    }
  }

  // Generate all parts sequentially & auto-assemble
  const handleGenerateAll = async () => {
    if (isGeneratingAll) {
      handleCancelAll()
      return
    }

    if (scenes.length === 0) {
      toast.error('Generate a storyboard first!')
      return
    }
    if (!selectedPerformerUrl) {
      toast.error('Please select or upload a performer reference photo (<Picture 1>)')
      return
    }

    setIsGeneratingAll(true)
    let allSucceeded = true

    for (let i = 0; i < scenes.length; i++) {
      if (cancelledRef.current[i]) {
        allSucceeded = false
        break
      }
      if (scenes[i].status === 'done' && scenes[i].videoUrl) continue
      const success = await generateSingleScene(i)
      if (!success) {
        allSucceeded = false
        break
      }
    }

    setIsGeneratingAll(false)
    setCurrentGeneratingIndex(null)

    if (allSucceeded) {
      toast.success('🎉 All music video parts generated! Assembling Full 4K Master Video...')
      await handleAssembleMaster()
    }
  }

  // Assemble all generated scene parts into Full 4K Music Video
  const handleAssembleMaster = async () => {
    const ready = scenes.filter((s) => s.status === 'done' && (s.videoUrl || s.filename))
    if (ready.length === 0) {
      toast.error('No finished scene clips to assemble.')
      return
    }

    setIsAssembling(true)
    try {
      const res = await fetch('/api/videogen/singing/assemble', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: `${songTitle} (4K Master Music Video)`,
          projectId,
          scenes: ready,
          songAudioBase64: songAudioBase64 || undefined,
        }),
      })

      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error(d.error || 'Master assembly failed')
      }

      const data = await res.json()
      if (data.videoUrl) {
        setAssembledVideoUrl(data.videoUrl)
        toast.success('🌟 4K Master Music Video assembled and uploaded to R2!')
      }
    } catch (err: any) {
      toast.error(err.message || 'Assembly failed')
    } finally {
      setIsAssembling(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
      {/* Header Banner */}
      <div
        style={{
          background: 'linear-gradient(135deg, rgba(232,185,74,0.12) 0%, rgba(14,23,38,0.9) 100%)',
          border: '1px solid rgba(232,185,74,0.3)',
          borderRadius: '1rem',
          padding: '1.75rem 2rem',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '1rem',
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', marginBottom: '0.35rem' }}>
            <span style={{ fontSize: '1.5rem' }}>🎤</span>
            <h2 style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--gold)', margin: 0, textTransform: 'uppercase' }}>
              Singing & Music Video Studio
            </h2>
            <span
              style={{
                fontSize: '10px',
                background: 'rgba(232,185,74,0.2)',
                color: 'var(--gold)',
                padding: '0.2rem 0.5rem',
                borderRadius: '0.3rem',
                fontWeight: 800,
                border: '1px solid rgba(232,185,74,0.4)',
              }}
            >
              MiniMax Ref2VA · 4K Master
            </span>
          </div>
          <p style={{ fontSize: '12px', color: '#94a3b8', margin: 0, maxWidth: '680px', lineHeight: 1.5 }}>
            Generate ultra-photorealistic, perfectly lip-synced 4K music videos. Upload your song and performer photo — AI directs each scene with <code style={{ color: 'var(--gold)' }}>&lt;Picture 1&gt;</code> and <code style={{ color: '#93c5fd' }}>&lt;Audio 1&gt;</code> tags, renders part-by-part, and stitches the full master video.
          </p>
        </div>

        <button
          type="button"
          onClick={onNavigateToEngines}
          style={{
            background: '#070c14',
            border: '1px solid #1a2840',
            color: 'var(--gold)',
            borderRadius: '0.5rem',
            padding: '0.5rem 0.85rem',
            fontSize: '11px',
            fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          ⚡ GPU Engine Hub
        </button>
      </div>

      {/* Step 1: Song & Performer Setup Card */}
      <div
        style={{
          background: 'rgba(14,23,38,0.75)',
          border: '1px solid #1a2840',
          borderRadius: '1rem',
          padding: '1.5rem',
          display: 'flex',
          flexDirection: 'column',
          gap: '1.25rem',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span style={{ fontSize: '12px', background: 'var(--gold)', color: '#05080e', fontWeight: 900, borderRadius: '50%', width: '22px', height: '22px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            1
          </span>
          <h3 style={{ fontSize: '13px', fontWeight: 800, color: '#F2F5FA', margin: 0, textTransform: 'uppercase' }}>
            Audio Track & Performer Setup
          </h3>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1.25rem' }}>
          {/* Audio Upload Box */}
          <div style={{ background: '#070c14', border: '1px dashed #1a2840', borderRadius: '0.75rem', padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <label style={{ fontSize: '11px', fontWeight: 700, color: 'var(--gold)', textTransform: 'uppercase' }}>
                🎵 Song Track (.mp3 / .wav)
              </label>
              {songDuration > 0 && (
                <span style={{ fontSize: '10px', color: '#94a3b8' }}>
                  Duration: {Math.floor(songDuration / 60)}:{(songDuration % 60).toString().padStart(2, '0')} ({songDuration}s)
                </span>
              )}
            </div>

            <input
              type="file"
              ref={audioInputRef}
              accept="audio/*"
              onChange={handleAudioUpload}
              style={{ display: 'none' }}
            />

            <button
              type="button"
              onClick={() => audioInputRef.current?.click()}
              style={{
                background: songAudioFile ? 'rgba(74,222,128,0.1)' : 'rgba(255,255,255,0.04)',
                border: `1px solid ${songAudioFile ? 'rgba(74,222,128,0.3)' : '#1a2840'}`,
                borderRadius: '0.5rem',
                padding: '0.85rem',
                color: songAudioFile ? '#4ade80' : '#cbd5e1',
                fontSize: '12px',
                fontWeight: 600,
                cursor: 'pointer',
                textAlign: 'center',
              }}
            >
              {songAudioFile ? `✓ ${songAudioFile.name}` : '+ Upload Song / Vocals MP3'}
            </button>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
              <div>
                <span style={{ fontSize: '9px', color: '#64748b', textTransform: 'uppercase', fontWeight: 700 }}>Song Title</span>
                <input
                  type="text"
                  value={songTitle}
                  onChange={(e) => setSongTitle(e.target.value)}
                  style={{ width: '100%', background: '#0e182e', border: '1px solid #1a2840', borderRadius: '0.35rem', padding: '0.4rem', color: '#F2F5FA', fontSize: '11px', outline: 'none' }}
                />
              </div>
              <div>
                <span style={{ fontSize: '9px', color: '#64748b', textTransform: 'uppercase', fontWeight: 700 }}>Segment Length</span>
                <select
                  value={segmentDuration}
                  onChange={(e) => setSegmentDuration(Number(e.target.value))}
                  style={{ width: '100%', background: '#0e182e', border: '1px solid #1a2840', borderRadius: '0.35rem', padding: '0.4rem', color: '#F2F5FA', fontSize: '11px', outline: 'none' }}
                >
                  <option value={15}>15s (Optimal MiniMax Limit)</option>
                  <option value={10}>10s (Fast 480p/720p)</option>
                  <option value={5}>5s (Quick Beats)</option>
                </select>
              </div>
            </div>
          </div>

          {/* Performer Selection Box */}
          <div style={{ background: '#070c14', border: '1px dashed #1a2840', borderRadius: '0.75rem', padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <label style={{ fontSize: '11px', fontWeight: 700, color: 'var(--gold)', textTransform: 'uppercase' }}>
                👤 Performer Photo (&lt;Picture 1&gt;)
              </label>
              {onOpenRefLibrary && (
                <button
                  type="button"
                  onClick={onOpenRefLibrary}
                  style={{ background: 'none', border: 'none', color: '#93c5fd', fontSize: '10px', cursor: 'pointer', textDecoration: 'underline' }}
                >
                  From R2 Gallery
                </button>
              )}
            </div>

            <input
              type="file"
              ref={performerInputRef}
              accept="image/*"
              onChange={handlePerformerUpload}
              style={{ display: 'none' }}
            />

            <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
              {selectedPerformerUrl ? (
                <div style={{ width: '64px', height: '64px', borderRadius: '0.5rem', overflow: 'hidden', border: '2px solid var(--gold)', flexShrink: 0 }}>
                  <img src={selectedPerformerUrl} alt="Performer" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                </div>
              ) : (
                <div style={{ width: '64px', height: '64px', borderRadius: '0.5rem', background: '#0e182e', border: '1px dashed #1a2840', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.2rem', color: '#64748b', flexShrink: 0 }}>
                  👤
                </div>
              )}

              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                <button
                  type="button"
                  onClick={() => performerInputRef.current?.click()}
                  style={{
                    background: 'rgba(232,185,74,0.12)',
                    border: '1px solid rgba(232,185,74,0.3)',
                    borderRadius: '0.35rem',
                    padding: '0.4rem',
                    color: 'var(--gold)',
                    fontSize: '11px',
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  {selectedPerformerUrl ? 'Change Photo' : '+ Upload Performer Photo'}
                </button>
                <input
                  type="text"
                  placeholder="Performer description (e.g. 24yo pop singer with blue jacket)"
                  value={performerDesc}
                  onChange={(e) => setPerformerDesc(e.target.value)}
                  style={{ width: '100%', background: '#0e182e', border: '1px solid #1a2840', borderRadius: '0.35rem', padding: '0.35rem', color: '#F2F5FA', fontSize: '10.5px', outline: 'none' }}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Music Video Style & Vibe */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.75rem' }}>
          <div>
            <span style={{ fontSize: '9.5px', color: '#64748b', textTransform: 'uppercase', fontWeight: 700 }}>Visual Style Preset</span>
            <select
              value={stylePreset}
              onChange={(e) => setStylePreset(e.target.value)}
              style={{ width: '100%', background: '#070c14', border: '1px solid #1a2840', borderRadius: '0.4rem', padding: '0.5rem', color: '#F2F5FA', fontSize: '11.5px', fontWeight: 600, outline: 'none' }}
            >
              {STYLE_PRESETS.map((st) => (
                <option key={st} value={st} style={{ background: '#070c14' }}>
                  {st}
                </option>
              ))}
            </select>
          </div>
          <div>
            <span style={{ fontSize: '9.5px', color: '#64748b', textTransform: 'uppercase', fontWeight: 700 }}>Genre & Mood</span>
            <input
              type="text"
              value={`${genre} · ${mood}`}
              onChange={(e) => {
                const parts = e.target.value.split('·')
                setGenre(parts[0]?.trim() || genre)
                if (parts[1]) setMood(parts[1].trim())
              }}
              style={{ width: '100%', background: '#070c14', border: '1px solid #1a2840', borderRadius: '0.4rem', padding: '0.5rem', color: '#F2F5FA', fontSize: '11.5px', outline: 'none' }}
            />
          </div>
          <div>
            <span style={{ fontSize: '9.5px', color: '#64748b', textTransform: 'uppercase', fontWeight: 700 }}>Lyric Theme / Story Beat</span>
            <input
              type="text"
              value={lyricsTheme}
              onChange={(e) => setLyricsTheme(e.target.value)}
              style={{ width: '100%', background: '#070c14', border: '1px solid #1a2840', borderRadius: '0.4rem', padding: '0.5rem', color: '#F2F5FA', fontSize: '11.5px', outline: 'none' }}
            />
          </div>
        </div>

        <button
          type="button"
          onClick={handleBuildStoryboard}
          disabled={buildingStoryboard}
          style={{
            background: 'var(--gold)',
            color: '#05080e',
            border: 'none',
            borderRadius: '0.6rem',
            padding: '0.75rem',
            fontWeight: 800,
            fontSize: '13px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '0.5rem',
          }}
        >
          <span>{buildingStoryboard ? '⏳ Generating AI Music Storyboard...' : '✨ Auto-Generate Music Video Storyboard & Prompts'}</span>
        </button>
      </div>

      {/* Step 2: Interactive Storyboard & Scene Prompt Editor */}
      {scenes.length > 0 && (
        <div
          style={{
            background: 'rgba(14,23,38,0.75)',
            border: '1px solid #1a2840',
            borderRadius: '1rem',
            padding: '1.5rem',
            display: 'flex',
            flexDirection: 'column',
            gap: '1.25rem',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span style={{ fontSize: '12px', background: 'var(--gold)', color: '#05080e', fontWeight: 900, borderRadius: '50%', width: '22px', height: '22px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                2
              </span>
              <div>
                <h3 style={{ fontSize: '13px', fontWeight: 800, color: '#F2F5FA', margin: 0, textTransform: 'uppercase' }}>
                  Scene Storyboard & Prompt Editor ({scenes.length} Parts)
                </h3>
                {logline && <p style={{ fontSize: '11px', color: '#94a3b8', margin: '0.15rem 0 0' }}>{logline}</p>}
              </div>
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
              {scenes.some((s) => s.status === 'generating') && (
                <button
                  type="button"
                  onClick={handleCancelAll}
                  style={{
                    background: 'rgba(239,68,68,0.15)',
                    border: '1px solid #ef4444',
                    color: '#fca5a5',
                    borderRadius: '0.5rem',
                    padding: '0.55rem 0.85rem',
                    fontWeight: 800,
                    fontSize: '12px',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.35rem',
                  }}
                >
                  <span>⏹ Stop All</span>
                </button>
              )}

              <button
                type="button"
                onClick={handleClearStoryboard}
                style={{
                  background: 'rgba(239,68,68,0.1)',
                  border: '1px solid rgba(239,68,68,0.3)',
                  color: '#fca5a5',
                  borderRadius: '0.5rem',
                  padding: '0.55rem 0.85rem',
                  fontWeight: 700,
                  fontSize: '12px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.35rem',
                }}
                title="Dismiss and clear the storyboard"
              >
                <span>🗑️ Dismiss / Clear Storyboard</span>
              </button>

              <button
                type="button"
                onClick={handleGenerateAll}
                disabled={isAssembling}
                style={{
                  background: isGeneratingAll
                    ? 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)'
                    : 'linear-gradient(135deg, #e8b94a 0%, #f59e0b 100%)',
                  color: '#05080e',
                  border: 'none',
                  borderRadius: '0.5rem',
                  padding: '0.55rem 1rem',
                  fontWeight: 900,
                  fontSize: '12.5px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.4rem',
                  boxShadow: isGeneratingAll ? '0 0 16px rgba(239,68,68,0.4)' : '0 0 16px rgba(232,185,74,0.3)',
                }}
              >
                <span>{isGeneratingAll ? '⏹ Stop Batch Generation' : '🚀 Generate Full 4K Music Video'}</span>
              </button>
            </div>
          </div>

          {/* Scene Cards Grid */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {scenes.map((sc, idx) => (
              <div
                key={idx}
                style={{
                  background: '#070c14',
                  border: `1px solid ${sc.status === 'error' ? '#ef4444' : currentGeneratingIndex === idx ? 'var(--gold)' : sc.status === 'done' ? '#22c55e' : '#1a2840'}`,
                  borderRadius: '0.75rem',
                  padding: '1rem',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.75rem',
                  transition: 'all 0.2s ease',
                }}
              >
                {/* Scene Header */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <span style={{ fontSize: '11px', background: '#1e293b', color: '#F2F5FA', padding: '0.2rem 0.5rem', borderRadius: '0.3rem', fontWeight: 800 }}>
                      Part {sc.order}
                    </span>
                    <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--gold)' }}>{sc.title}</span>
                    <span style={{ fontSize: '10px', color: '#64748b' }}>
                      ({sc.startSec.toFixed(1)}s – {sc.endSec.toFixed(1)}s · {sc.durationSec.toFixed(1)}s)
                    </span>
                  </div>

                  <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                    {sc.status === 'done' && <span style={{ fontSize: '10.5px', color: '#4ade80', fontWeight: 700 }}>✓ Rendered</span>}
                    {sc.status === 'generating' && (
                      <span style={{ fontSize: '10.5px', color: 'var(--gold)', fontWeight: 700 }}>
                        ⏳ Step {sc.step || 0}/{sc.maxStep || 18}
                      </span>
                    )}

                    {sc.status === 'generating' ? (
                      <button
                        type="button"
                        onClick={() => handleCancelScene(idx)}
                        style={{
                          background: 'rgba(239,68,68,0.15)',
                          border: '1px solid rgba(239,68,68,0.4)',
                          color: '#fca5a5',
                          borderRadius: '0.35rem',
                          padding: '0.25rem 0.55rem',
                          fontSize: '10.5px',
                          fontWeight: 800,
                          cursor: 'pointer',
                        }}
                        title="Cancel this part generation"
                      >
                        🛑 Cancel
                      </button>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => handleRegenerateScene(idx)}
                          disabled={regeneratingIndex === idx || isGeneratingAll}
                          style={{
                            background: 'rgba(232,185,74,0.1)',
                            border: '1px solid rgba(232,185,74,0.25)',
                            color: 'var(--gold)',
                            borderRadius: '0.35rem',
                            padding: '0.25rem 0.55rem',
                            fontSize: '10.5px',
                            fontWeight: 700,
                            cursor: 'pointer',
                          }}
                          title="AI will regenerate an alternative camera move & prompt for this scene"
                        >
                          {regeneratingIndex === idx ? '⏳ Regenerating...' : '🔄 Regenerate Prompt'}
                        </button>

                        <button
                          type="button"
                          onClick={() => generateSingleScene(idx)}
                          disabled={isGeneratingAll}
                          style={{
                            background: sc.status === 'done' ? '#0e182e' : 'rgba(59,130,246,0.15)',
                            border: `1px solid ${sc.status === 'done' ? '#1a2840' : 'rgba(59,130,246,0.3)'}`,
                            color: sc.status === 'done' ? '#94a3b8' : '#93c5fd',
                            borderRadius: '0.35rem',
                            padding: '0.25rem 0.55rem',
                            fontSize: '10.5px',
                            fontWeight: 700,
                            cursor: 'pointer',
                          }}
                        >
                          {sc.status === 'done' ? 'Re-render Part' : sc.status === 'error' ? '⚡ Retry Part' : '⚡ Render Part'}
                        </button>

                        <button
                          type="button"
                          onClick={() => handleDeleteScene(idx)}
                          disabled={isGeneratingAll}
                          style={{
                            background: 'rgba(239,68,68,0.08)',
                            border: '1px solid rgba(239,68,68,0.25)',
                            color: '#f87171',
                            borderRadius: '0.35rem',
                            padding: '0.25rem 0.5rem',
                            fontSize: '10.5px',
                            fontWeight: 700,
                            cursor: 'pointer',
                          }}
                          title="Delete this scene part"
                        >
                          🗑️
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {/* Error Banner */}
                {(sc.status === 'error' || sc.error) && (
                  <div style={{
                    background: 'rgba(239,68,68,0.1)',
                    border: '1px solid rgba(239,68,68,0.35)',
                    borderRadius: '0.5rem',
                    padding: '0.65rem 0.85rem',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: '0.5rem',
                    flexWrap: 'wrap',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '11px', color: '#fca5a5' }}>
                      <span>⚠️</span>
                      <span><strong>Error:</strong> {sc.error || 'Generation stopped or failed.'}</span>
                    </div>
                    <div style={{ display: 'flex', gap: '0.35rem' }}>
                      <button
                        type="button"
                        onClick={() => generateSingleScene(idx)}
                        style={{
                          background: 'rgba(239,68,68,0.25)',
                          border: '1px solid #ef4444',
                          color: '#fef2f2',
                          borderRadius: '0.3rem',
                          padding: '0.2rem 0.55rem',
                          fontSize: '10.5px',
                          fontWeight: 800,
                          cursor: 'pointer',
                        }}
                      >
                        🔄 Retry
                      </button>
                      <button
                        type="button"
                        onClick={() => handleCancelScene(idx)}
                        style={{
                          background: 'transparent',
                          border: '1px solid rgba(255,255,255,0.15)',
                          color: '#94a3b8',
                          borderRadius: '0.3rem',
                          padding: '0.2rem 0.5rem',
                          fontSize: '10.5px',
                          cursor: 'pointer',
                        }}
                      >
                        ✕ Dismiss
                      </button>
                    </div>
                  </div>
                )}

                {/* Prompt Textarea */}
                <textarea
                  value={sc.prompt}
                  onChange={(e) => {
                    const newPrompt = e.target.value
                    setScenes((prev) => prev.map((s, i) => (i === idx ? { ...s, prompt: newPrompt } : s)))
                  }}
                  rows={3}
                  style={{
                    width: '100%',
                    background: '#0e182e',
                    border: '1px solid #1a2840',
                    borderRadius: '0.5rem',
                    padding: '0.65rem',
                    color: '#F2F5FA',
                    fontSize: '12px',
                    outline: 'none',
                    resize: 'vertical',
                    fontFamily: 'inherit',
                    lineHeight: 1.4,
                  }}
                />

                {/* Generating Live Animation & Progress */}
                {sc.status === 'generating' && (
                  <div
                    className="ss-generating-card"
                    style={{
                      background: podDownloading && currentGeneratingIndex === idx
                        ? 'linear-gradient(135deg, rgba(59,130,246,0.1) 0%, rgba(6,182,212,0.08) 100%)'
                        : 'linear-gradient(135deg, rgba(232, 185, 74, 0.08) 0%, rgba(168, 85, 247, 0.08) 100%)',
                      border: podDownloading && currentGeneratingIndex === idx
                        ? '1px solid rgba(59,130,246,0.4)'
                        : '1px solid rgba(232, 185, 74, 0.3)',
                      borderRadius: '0.5rem',
                      padding: '0.75rem',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '0.5rem',
                    }}>
                    {/* Label row */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '11px' }}>
                      <span style={{
                        color: podDownloading && currentGeneratingIndex === idx ? '#60a5fa' : 'var(--gold)',
                        fontWeight: 700,
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.4rem',
                      }}>
                        {podDownloading && currentGeneratingIndex === idx ? (
                          <>
                            <span style={{ display: 'inline-block', animation: 'ss-spin 1.2s linear infinite' }}>⚙️</span>
                            <span>Pod loading model weights — generation queued ({podDownloadProgress}% ready)</span>
                          </>
                        ) : (
                          <>
                            <span>✨</span>
                            <span>MiniMax Ref2VA Lip-Syncing &amp; Neural Rendering...</span>
                          </>
                        )}
                      </span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <span style={{ color: '#F2F5FA', fontWeight: 800 }}>
                          {podDownloading && currentGeneratingIndex === idx
                            ? `~${Math.max(1, Math.round((100 - podDownloadProgress) * 0.09))}min left`
                            : sc.progress ? `${Math.round(sc.progress)}%` : 'Rendering...'}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleCancelScene(idx)}
                          style={{
                            background: 'rgba(239,68,68,0.2)',
                            border: '1px solid rgba(239,68,68,0.5)',
                            color: '#fca5a5',
                            padding: '0.15rem 0.45rem',
                            borderRadius: '0.3rem',
                            fontSize: '10px',
                            fontWeight: 800,
                            cursor: 'pointer',
                          }}
                        >
                          🛑 Cancel
                        </button>
                      </div>
                    </div>

                    {/* Animated Progress Bar */}
                    <div style={{
                      width: '100%',
                      height: '6px',
                      background: 'rgba(255, 255, 255, 0.1)',
                      borderRadius: '3px',
                      overflow: 'hidden',
                      position: 'relative',
                    }}>
                      <div
                        className={podDownloading && currentGeneratingIndex === idx ? 'ss-download-bar' : 'ss-shimmer-bar'}
                        style={{
                          height: '100%',
                          width: `${Math.max(8, sc.progress || (podDownloading && currentGeneratingIndex === idx ? podDownloadProgress : 25))}%`,
                          borderRadius: '3px',
                          transition: 'width 0.8s ease',
                        }} />
                    </div>

                    {/* Step counter or download hint */}
                    {podDownloading && currentGeneratingIndex === idx ? (
                      <div style={{ fontSize: '10px', color: '#94a3b8', animation: 'ss-download-pulse 2s ease-in-out infinite' }}>
                        📦 MiniMax H3 weights loading onto GPU — job will start automatically when ready. No action needed.
                      </div>
                    ) : sc.step !== undefined && sc.step > 0 ? (
                      <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                        {Array.from({ length: sc.maxStep || 18 }, (_, i) => (
                          <div key={i} style={{
                            width: '10px',
                            height: '10px',
                            borderRadius: '2px',
                            background: i < (sc.step || 0) ? 'var(--gold)' : 'rgba(255,255,255,0.1)',
                            transition: 'background 0.3s ease',
                            flexShrink: 0,
                          }} />
                        ))}
                        <span style={{ fontSize: '10px', color: '#94a3b8', marginLeft: '0.25rem' }}>Step {sc.step}/{sc.maxStep || 18}</span>
                      </div>
                    ) : null}
                  </div>
                )}

                {/* Video Preview if Done */}
                {sc.videoUrl && (
                  <div style={{ marginTop: '0.25rem', borderRadius: '0.5rem', overflow: 'hidden', background: '#000', maxHeight: '180px', display: 'flex', justifyContent: 'center' }}>
                    <video src={sc.videoUrl} controls loop playsInline style={{ maxHeight: '180px', width: '100%', objectFit: 'contain' }} />
                  </div>
                )}
              </div>
            ))}

            {/* Add Scene Part Button */}
            <button
              type="button"
              onClick={handleAddScene}
              disabled={isGeneratingAll}
              style={{
                background: 'rgba(255,255,255,0.02)',
                border: '1px dashed #1a2840',
                borderRadius: '0.6rem',
                padding: '0.65rem',
                color: '#94a3b8',
                fontSize: '11.5px',
                fontWeight: 700,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.4rem',
                transition: 'all 0.2s ease',
              }}
            >
              <span>+ Add Scene Part</span>
            </button>
          </div>
        </div>
      )}

      {/* Step 3: Final 4K Master Video Assembly Card */}
      {(assembledVideoUrl || isAssembling) && (
        <div
          style={{
            background: 'linear-gradient(135deg, rgba(74,222,128,0.1) 0%, rgba(14,23,38,0.9) 100%)',
            border: '1px solid rgba(74,222,128,0.35)',
            borderRadius: '1rem',
            padding: '1.75rem',
            display: 'flex',
            flexDirection: 'column',
            gap: '1rem',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span style={{ fontSize: '1.25rem' }}>🎬</span>
              <h3 style={{ fontSize: '14px', fontWeight: 800, color: '#4ade80', margin: 0, textTransform: 'uppercase' }}>
                {isAssembling ? 'Assembling 4K Master Music Video...' : 'Full 4K Master Music Video Ready'}
              </h3>
            </div>
            {assembledVideoUrl && (
              <a
                href={assembledVideoUrl}
                download={`${songTitle}_4K_Master.mp4`}
                style={{
                  background: 'var(--gold)',
                  color: '#05080e',
                  fontWeight: 800,
                  fontSize: '11px',
                  padding: '0.4rem 0.75rem',
                  borderRadius: '0.35rem',
                  textDecoration: 'none',
                }}
              >
                ⬇️ Download 4K Master MP4
              </a>
            )}
          </div>

          {assembledVideoUrl ? (
            <div style={{ borderRadius: '0.75rem', overflow: 'hidden', background: '#000', maxHeight: '420px' }}>
              <video src={assembledVideoUrl} controls loop playsInline style={{ width: '100%', maxHeight: '420px', objectFit: 'contain' }} />
            </div>
          ) : (
            <div style={{ height: '140px', background: '#070c14', borderRadius: '0.5rem', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8', fontSize: '12px' }}>
              Stitching scenes & muxing high-fidelity studio master audio...
            </div>
          )}
        </div>
      )}
    </div>
  )
}
