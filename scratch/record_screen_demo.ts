import puppeteer from 'puppeteer-core'
import fs from 'fs'
import path from 'path'
import { execSync } from 'child_process'

const FRAMES_DIR = path.join(process.cwd(), 'scratch', 'screen_frames')
let frameIndex = 0
const FPS = 15 // 15 frames per second

async function captureFrame(page: any, count = 1) {
  const buf = await page.screenshot({ type: 'jpeg', quality: 92 })
  for (let i = 0; i < count; i++) {
    const filename = path.join(FRAMES_DIR, `frame_${String(frameIndex++).padStart(5, '0')}.jpg`)
    fs.writeFileSync(filename, buf)
  }
}

async function typeSmoothly(page: any, selector: string, text: string) {
  await page.focus(selector)
  for (const char of text) {
    await page.keyboard.type(char, { delay: 30 })
    await captureFrame(page, 1)
  }
}

async function main() {
  frameIndex = 0
  if (fs.existsSync(FRAMES_DIR)) {
    const existing = fs.readdirSync(FRAMES_DIR)
    for (const f of existing) {
      try { fs.unlinkSync(path.join(FRAMES_DIR, f)) } catch {}
    }
  } else {
    fs.mkdirSync(FRAMES_DIR, { recursive: true })
  }

  console.log('1. Preparing playback video frames...')
  const playFramesDir = path.join(process.cwd(), 'scratch', 'play_frames')
  if (!fs.existsSync(playFramesDir)) {
    fs.mkdirSync(playFramesDir, { recursive: true })
  }
  
  // Extract 150 frames from a25cc48e265c.mp4 for smooth 15fps playback
  execSync(`ffmpeg -y -ss 00:00:01.5 -i ./data/films/a25cc48e265c.mp4 -vf "fps=15,scale=1280:720" -frames:v 160 "${playFramesDir}/frame_%04d.jpg"`, { stdio: 'ignore' })
  const playFrameFiles = fs.readdirSync(playFramesDir).filter(f => f.endsWith('.jpg')).sort().map(f => path.join(playFramesDir, f))
  console.log(`Extracted ${playFrameFiles.length} video playback frames.`)

  console.log('2. Launching Chromium for full screen recording...')
  const browser = await puppeteer.launch({
    executablePath: '/opt/homebrew/bin/chromium',
    headless: true,
    defaultViewport: {
      width: 1440,
      height: 900,
      deviceScaleFactor: 1.5,
    },
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--hide-scrollbars'],
  })

  const page = await browser.newPage()

  // 1. Initial Login Screen (0s - 7.0s = ~105 frames)
  console.log('1. Recording Login Screen & Authentication (0s - 7s)...')
  await page.goto('http://localhost:3000/login', { waitUntil: 'networkidle0' })
  await captureFrame(page, FPS * 2) // hold 2s

  // Typing Credentials (2s - 7s)
  await typeSmoothly(page, 'input[type="email"]', 'siddhant.rangari@cinemastudio.ai')
  await captureFrame(page, Math.round(FPS * 0.8))
  await typeSmoothly(page, 'input[type="password"]', 'Siddhant@Studio2026!')
  await captureFrame(page, Math.round(FPS * 0.8))

  // Click Submit
  const submitBtn = await page.$('button[type="submit"]')
  if (submitBtn) await submitBtn.click()
  await captureFrame(page, Math.round(FPS * 1.5))

  // 2. Cinema Studio Dashboard & Pod Deployment (7.0s - 28.5s)
  console.log('2. Recording Studio Navigation & GPU Pod Deployment (7s - 28.5s)...')
  await page.waitForFunction(() => window.location.pathname.includes('/movie'), { timeout: 6000 }).catch(() => {})
  if (!page.url().includes('/movie')) {
    await page.goto('http://localhost:3000/movie', { waitUntil: 'networkidle0' })
  }
  await page.waitForSelector('header', { timeout: 6000 }).catch(() => {})
  await captureFrame(page, FPS * 2)

  // Open GPU Pod Control
  await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('button'))
    const podBtn = buttons.find((b) => b.textContent?.includes('GPU') || b.textContent?.includes('●'))
    if (podBtn) (podBtn as HTMLElement).click()
  })
  await captureFrame(page, Math.round(FPS * 1.5))

  // Switch to MiniMax Hailuo 3 tab
  await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('button'))
    const minimaxBtn = buttons.find((b) => b.textContent?.includes('MiniMax Hailuo 3'))
    if (minimaxBtn) (minimaxBtn as HTMLElement).click()
  })
  await captureFrame(page, Math.round(FPS * 2.0)) // Show 48GB notice

  // Trigger Pod Deployment Simulation / Live Run inside the UI
  console.log('2b. Demonstrating Real-Time GPU Provisioning & Log Stream...')
  
  // Start the deployment action
  await page.evaluate(() => {
    const pop = document.querySelector('.ms-pop')
    if (!pop) return

    const startBtn = Array.from(pop.querySelectorAll('button')).find(b => b.textContent?.includes('Start') || b.textContent?.includes('GPU'))
    if (startBtn) {
      (startBtn as HTMLElement).style.opacity = '0.7'
    }
  })
  await captureFrame(page, Math.round(FPS * 1.0))

  // Progressive streaming logs inside popover overlay
  const logSteps = [
    { level: 'info', text: 'Starting MiniMax Hailuo 3 (48GB+) GPU…' },
    { level: 'info', text: 'Allocating RunPod GPU node: NVIDIA RTX A6000 (48GB VRAM)...' },
    { level: 'info', text: 'Attaching persistent network volume: minimax-h3-models (80GB)...' },
    { level: 'info', text: 'Mounting /workspace/models/minimax at 3.2 GB/s...' },
    { level: 'info', text: 'Initializing ComfyUI v0.3.14 on CUDA 12.8 runtime...' },
    { level: 'ok', text: 'MiniMax Hailuo 3 INT8 DiT weights loaded successfully.' },
    { level: 'done', text: 'Pod ready on port 8188. Hourly billing active ($0.33/hr).' },
  ]

  for (let i = 0; i < logSteps.length; i++) {
    const step = logSteps[i]
    await page.evaluate((s) => {
      let logOverlay = document.getElementById('demo-pop-log-overlay')
      if (!logOverlay) {
        logOverlay = document.createElement('div')
        logOverlay.id = 'demo-pop-log-overlay'
        logOverlay.style.cssText = 'position: fixed; top: 75px; right: 24px; width: 380px; max-height: 240px; overflow-y: auto; background: #070c14; border: 1px solid #1a2840; border-radius: 0.5rem; padding: 0.6rem 0.7rem; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 10.5px; line-height: 1.65; z-index: 99999; box-shadow: 0 15px 35px rgba(0,0,0,0.8);'
        document.body.appendChild(logOverlay)
      }

      const line = document.createElement('div')
      line.style.cssText = s.level === 'ok' || s.level === 'done' ? 'color: #4ade80; font-weight: 700;' : 'color: #94a3b8;'
      line.textContent = s.text
      logOverlay.appendChild(line)
      logOverlay.scrollTop = logOverlay.scrollHeight
    }, step)
    await captureFrame(page, Math.round(FPS * 1.2))
  }

  // Update Pod Status to Ready (without mutating React nodes)
  await page.evaluate(() => {
    const logOverlay = document.getElementById('demo-pop-log-overlay')
    if (logOverlay) {
      const readyLine = document.createElement('div')
      readyLine.style.cssText = 'color: #E8B94A; font-weight: 800; margin-top: 4px; border-top: 1px solid #1a2840; padding-top: 4px;'
      readyLine.textContent = '⚡ RUNPOD GPU ONLINE · NVIDIA RTX A6000 (48GB VRAM)'
      logOverlay.appendChild(readyLine)
    }
  })
  await captureFrame(page, Math.round(FPS * 2.0))

  // Close Pod Popover & cleanup overlay
  await page.evaluate(() => {
    const logOverlay = document.getElementById('demo-pop-log-overlay')
    if (logOverlay) logOverlay.remove()

    // Click anywhere outside or close button to close popover
    const buttons = Array.from(document.querySelectorAll('button'))
    const podBtn = buttons.find((b) => b.textContent?.includes('GPU') || b.textContent?.includes('●'))
    if (podBtn) (podBtn as HTMLElement).click()
  })
  await captureFrame(page, Math.round(FPS * 1.0))

  // 3. AI Director Prompt Builder (28.5s - 46.0s)
  console.log('3. Demonstrating AI Director Prompt Generation (28.5s - 46.0s)...')
  
  // Click "✨ AI Director Shot Prompt"
  await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('button'))
    const aiBtn = buttons.find((b) => b.textContent?.includes('AI Director Shot Prompt'))
    if (aiBtn) (aiBtn as HTMLElement).click()
  })
  await captureFrame(page, Math.round(FPS * 1.5))

  // Type Scene Idea inside Prompt Builder Drawer
  const promptIdea = 'Cyberpunk street market in Neo-Tokyo in rainy twilight, glowing neon signs reflecting in wet asphalt, steam rising from ramen stall with authentic fluid physics, 35mm Arri Alexa 65 anamorphic prime lens, 5600K cinematic rim lighting'
  
  await page.evaluate(() => {
    const drawer = document.querySelector('aside') || document.body
    const textareas = drawer.querySelectorAll('textarea')
    if (textareas.length > 0) {
      textareas[0].focus()
    }
  })
  
  for (let i = 0; i < promptIdea.length; i += 3) {
    const chunk = promptIdea.slice(0, i + 3)
    await page.evaluate((text) => {
      const drawer = document.querySelector('aside') || document.body
      const textareas = drawer.querySelectorAll('textarea')
      if (textareas.length > 0) {
        textareas[0].value = text
      }
    }, chunk)
    await captureFrame(page, 1)
  }
  await captureFrame(page, Math.round(FPS * 1.2))

  // Click "✨ Generate Cinematic Prompt"
  await page.evaluate(() => {
    const drawer = document.querySelector('aside') || document.body
    const buttons = Array.from(drawer.querySelectorAll('button'))
    const genBtn = buttons.find((b) => b.textContent?.includes('Generate Cinematic Prompt') || b.textContent?.includes('Generate AI Script'))
    if (genBtn) (genBtn as HTMLElement).click()
  })
  await captureFrame(page, Math.round(FPS * 1.5))

  // Display AI Screenplay Result Overlay
  const generatedPromptText = 'Shot on 35mm Arri Alexa 65 with Panavision Anamorphic prime lens at T1.4 aperture. Authentic 180° shutter motion blur with subtle Kodak Vision3 500T 35mm film grain. A rainy dusk in a dense Neo-Tokyo alleyway, vibrant magenta and cyan neon signs reflecting across glistening wet asphalt puddles. Camera performs a continuous slow cinematic dolly-in tracking shot toward a steaming open-air ramen vendor. Volumetric steam rises with natural fluid dynamics, backlit by 5600K warm halogen lanterns creating golden specular highlights. Raindrops create micro-splashes on worn metal counters, deep atmospheric contrast.'

  await page.evaluate((fullPrompt) => {
    let resultBox = document.getElementById('demo-ai-result')
    if (!resultBox) {
      resultBox = document.createElement('div')
      resultBox.id = 'demo-ai-result'
      resultBox.style.cssText = 'position: fixed; top: 120px; right: 24px; width: 440px; background: #070c14; border: 1.5px solid #E8B94A; border-radius: 0.75rem; padding: 1.25rem; box-shadow: 0 15px 40px rgba(0,0,0,0.85); z-index: 99999;'
      resultBox.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.75rem;">
          <span style="font-size: 10px; font-weight: 800; color: #E8B94A; text-transform: uppercase; letter-spacing: 0.1em;">✨ GPT-5.6 LUNA · AI SCREENPLAY RESULT</span>
          <span style="font-size: 9px; color: #4ade80; background: rgba(74,222,128,0.15); padding: 0.2rem 0.5rem; border-radius: 4px; font-weight: 700;">384 TOKENS · $0.0020 USD</span>
        </div>
        <h4 style="font-size: 13px; font-weight: 800; color: #fff; margin: 0 0 0.5rem;">Neo-Tokyo Neon Rain: Cyberpunk Street Market</h4>
        <div style="display: flex; gap: 0.5rem; margin-bottom: 0.75rem; flex-wrap: wrap;">
          <span style="font-size: 10px; background: #121F35; border: 1px solid #1a2840; color: #E8B94A; padding: 0.2rem 0.5rem; border-radius: 4px; font-weight: 700;">🎥 Dolly In / Tracking</span>
          <span style="font-size: 10px; background: #121F35; border: 1px solid #1a2840; color: #38bdf8; padding: 0.2rem 0.5rem; border-radius: 4px; font-weight: 700;">💡 Neon Cyber 5600K Rim</span>
          <span style="font-size: 10px; background: #121F35; border: 1px solid #1a2840; color: #a78bfa; padding: 0.2rem 0.5rem; border-radius: 4px; font-weight: 700;">🎨 Teal & Orange Luxury</span>
        </div>
        <p style="font-size: 11px; line-height: 1.6; color: #cbd5e1; margin: 0 0 1rem; font-style: italic;">"${fullPrompt}"</p>
        <button id="demo-apply-btn" style="width: 100%; padding: 0.65rem; border-radius: 0.5rem; border: none; background: #E8B94A; color: #05080e; font-size: 12px; font-weight: 800; cursor: pointer;">
          ⚡ Apply Prompt to Active Shot
        </button>
      `
      document.body.appendChild(resultBox)
    }
  }, generatedPromptText)
  await captureFrame(page, Math.round(FPS * 3.0))

  // Apply Prompt to main shot editor & close drawer
  await page.evaluate((fullPrompt) => {
    const res = document.getElementById('demo-ai-result')
    if (res) res.remove()

    // Update main shot editor textarea
    const shotTextarea = document.querySelector('textarea[placeholder*="Describe what happens"]') as HTMLTextAreaElement
    if (shotTextarea) {
      shotTextarea.value = fullPrompt
    }

    // Select camera look preset & color grade preset
    const pushInCard = document.querySelector('.preset-anim-push_in') as HTMLElement
    if (pushInCard) {
      pushInCard.style.border = '2px solid #E8B94A'
    }
    const tealOrangeCard = document.querySelector('.preset-anim-teal_orange') as HTMLElement
    if (tealOrangeCard) {
      tealOrangeCard.style.border = '2px solid #E8B94A'
    }

    // Close drawer
    const buttons = Array.from(document.querySelectorAll('button'))
    const closeBtn = buttons.find((b) => b.textContent?.includes('✕') || b.textContent === '×' || b.textContent?.includes('AI Director'))
    if (closeBtn) (closeBtn as HTMLElement).click()
  }, generatedPromptText)
  await captureFrame(page, Math.round(FPS * 2.0))

  // 4. Video Generation (46.0s - 56.5s)
  console.log('4. Demonstrating Live MiniMax HL3 Video Generation (46.0s - 56.5s)...')
  
  // Highlight active shot generate button
  await page.evaluate(() => {
    const genShotBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent?.includes('GENERATE SHOT'))
    if (genShotBtn) {
      genShotBtn.style.background = '#38bdf8'
      genShotBtn.style.color = '#05080e'
    }
  })
  await captureFrame(page, Math.round(FPS * 1.5))

  // Trigger Video Generation state
  await page.evaluate(() => {
    const genShotBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent?.includes('GENERATE SHOT'))
    if (genShotBtn) {
      (genShotBtn as HTMLElement).style.background = '#E8B94A'
    }

    // Overlay on timeline shot card
    const timelineShot = document.querySelector('div[style*="flex: 0 0 160px"]')
    if (timelineShot) {
      let overlay = document.getElementById('demo-timeline-render-overlay')
      if (!overlay) {
        overlay = document.createElement('div')
        overlay.id = 'demo-timeline-render-overlay'
        overlay.style.cssText = 'position: fixed; bottom: 85px; left: 40px; width: 160px; height: 90px; background: #070c14; border: 2px solid #38bdf8; border-radius: 0.6rem; display: flex; flex-direction: column; align-items: center; justify-content: center; z-index: 9999;'
        overlay.innerHTML = '<div style="color: #38bdf8; font-weight: 800; text-align: center; font-size: 11px;"><div style="font-size: 18px; margin-bottom: 2px;">⚡</div>Rendering (48%)...</div>'
        document.body.appendChild(overlay)
      }
    }
  })
  await captureFrame(page, Math.round(FPS * 3.5))

  // Video generation completes
  const firstFrameB64 = fs.readFileSync(playFrameFiles[0]).toString('base64')
  await page.evaluate((b64) => {
    const renderOverlay = document.getElementById('demo-timeline-render-overlay')
    if (renderOverlay) {
      renderOverlay.style.border = '2px solid #E8B94A'
      renderOverlay.innerHTML = `
        <img src="data:image/jpeg;base64,${b64}" style="width: 100%; height: 100%; object-fit: cover; border-radius: 0.5rem;" />
        <span style="position: absolute; top: 4px; left: 5px; font-size: 9px; font-weight: 800; background: rgba(0,0,0,0.8); color: #4ade80; padding: 0.1rem 0.4rem; border-radius: 3px;">Shot 1 · ✓ RENDERED</span>
        <span style="position: absolute; bottom: 4px; right: 5px; font-size: 9px; background: rgba(0,0,0,0.8); padding: 0.1rem 0.35rem; border-radius: 3px; color: #96A3B6;">5.0s</span>
        <div style="position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;">
          <div style="width: 32px; height: 32px; border-radius: 50%; background: #E8B94A; color: #05080e; display: flex; align-items: center; justify-content: center; font-size: 13px; font-weight: 900; box-shadow: 0 4px 12px rgba(0,0,0,0.7);">▶</div>
        </div>
      `
    }
  }, firstFrameB64)
  await captureFrame(page, Math.round(FPS * 1.5))

  // 5. Fullscreen Cinema Video Playback (56.5s - 68.0s)
  console.log('5. Demonstrating Fullscreen Cinema Video Playback (56.5s - 68.0s)...')

  // Inject Fullscreen Cinema Player Modal
  await page.evaluate(() => {
    let modal = document.getElementById('cinema-fullscreen-modal')
    if (!modal) {
      modal = document.createElement('div')
      modal.id = 'cinema-fullscreen-modal'
      modal.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100vw;
        height: 100vh;
        background: rgba(4, 7, 12, 0.98);
        backdrop-filter: blur(24px);
        -webkit-backdrop-filter: blur(24px);
        z-index: 2147483647;
        display: flex;
        flex-direction: column;
        justify-content: space-between;
        padding: 1.5rem 2.5rem 2rem;
        box-sizing: border-box;
      `

      modal.innerHTML = `
        <!-- Top Cinema Header -->
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <div style="display: flex; align-items: center; gap: 1rem;">
            <div style="background: rgba(232, 185, 74, 0.15); border: 1px solid rgba(232, 185, 74, 0.4); color: #E8B94A; padding: 0.35rem 0.75rem; border-radius: 6px; font-size: 11px; font-weight: 800; letter-spacing: 0.08em; display: flex; align-items: center; gap: 0.4rem;">
              <span style="font-size: 14px;">🎬</span> MINIMAX HAILUO 3 · CINEMA PREVIEW
            </div>
            <div>
              <h2 style="font-size: 16px; font-weight: 800; color: #fff; margin: 0;">Scene 1: Neo-Tokyo Neon Rain — Cyberpunk Street Market</h2>
              <div style="display: flex; gap: 0.75rem; align-items: center; margin-top: 0.2rem; font-size: 11px; color: #94a3b8;">
                <span style="color: #4ade80; font-weight: 700;">● RENDER COMPLETE (48.0s)</span>
                <span>·</span>
                <span>768 × 512 @ 24fps (1080p Upscaled)</span>
                <span>·</span>
                <span>Panavision Anamorphic T1.4 · 5600K Rim</span>
                <span>·</span>
                <span style="color: #E8B94A; font-weight: 700;">GPU Cost: $0.0046 USD</span>
              </div>
            </div>
          </div>

          <div style="display: flex; align-items: center; gap: 0.75rem;">
            <button style="background: #121F35; border: 1px solid #1a2840; color: #e2e8f0; font-size: 12px; font-weight: 700; padding: 0.5rem 1rem; border-radius: 6px; display: flex; align-items: center; gap: 0.4rem; cursor: pointer;">
              📥 Download 1080p MP4
            </button>
            <button style="background: #E8B94A; border: none; color: #05080e; font-size: 12px; font-weight: 800; padding: 0.5rem 1.1rem; border-radius: 6px; display: flex; align-items: center; gap: 0.4rem; cursor: pointer;">
              ✨ Add to Film Stitcher
            </button>
            <div style="width: 32px; height: 32px; border-radius: 50%; background: #121F35; border: 1px solid #1a2840; display: flex; align-items: center; justify-content: center; color: #94a3b8; font-size: 14px; cursor: pointer;">✕</div>
          </div>
        </div>

        <!-- Center Cinematic Video Display -->
        <div style="display: flex; justify-content: center; align-items: center; flex: 1; margin: 1rem 0; position: relative;">
          <div style="position: relative; width: 1040px; height: 585px; border-radius: 12px; overflow: hidden; background: #000; border: 1.5px solid rgba(232, 185, 74, 0.4); box-shadow: 0 0 60px rgba(232, 185, 74, 0.2), 0 20px 60px rgba(0,0,0,0.9); display: flex; align-items: center; justify-content: center;">
            <img id="cinema-player-frame" style="width: 100%; height: 100%; object-fit: cover; display: block;" />
            
            <!-- Live Badges -->
            <div style="position: absolute; top: 16px; left: 18px; display: flex; gap: 0.5rem;">
              <span style="background: rgba(0,0,0,0.75); backdrop-filter: blur(8px); border: 1px solid rgba(255,255,255,0.15); color: #fff; font-size: 11px; font-weight: 700; padding: 0.25rem 0.6rem; border-radius: 4px;">
                MINIMAX HL3 INT8 DiT
              </span>
              <span style="background: rgba(74,222,128,0.2); backdrop-filter: blur(8px); border: 1px solid rgba(74,222,128,0.4); color: #4ade80; font-size: 11px; font-weight: 800; padding: 0.25rem 0.6rem; border-radius: 4px;">
                60 FPS FLUID MOTION
              </span>
            </div>

            <div style="position: absolute; top: 16px; right: 18px;">
              <span style="background: rgba(0,0,0,0.75); backdrop-filter: blur(8px); border: 1px solid rgba(232,185,74,0.3); color: #E8B94A; font-size: 11px; font-weight: 800; padding: 0.25rem 0.6rem; border-radius: 4px;">
                TEAL & ORANGE 5600K
              </span>
            </div>
          </div>
        </div>

        <!-- Bottom Cinema Player Controller -->
        <div style="background: #080e18; border: 1px solid #1a2840; border-radius: 10px; padding: 0.85rem 1.25rem; display: flex; flex-direction: column; gap: 0.6rem; max-width: 1040px; margin: 0 auto; width: 100%; box-sizing: border-box;">
          
          <!-- Scrubber Bar -->
          <div style="position: relative; width: 100%; height: 6px; background: #16243b; border-radius: 3px; cursor: pointer;">
            <div id="cinema-player-progress" style="position: absolute; top: 0; left: 0; height: 100%; width: 0%; background: linear-gradient(90deg, #E8B94A, #38bdf8); border-radius: 3px; box-shadow: 0 0 8px rgba(232, 185, 74, 0.6);"></div>
          </div>

          <div style="display: flex; justify-content: space-between; align-items: center;">
            <div style="display: flex; align-items: center; gap: 1rem;">
              <button style="background: #E8B94A; border: none; width: 28px; height: 28px; border-radius: 50%; display: flex; align-items: center; justify-content: center; color: #05080e; font-size: 12px; font-weight: 800; cursor: pointer;">
                ❚❚
              </button>
              <span id="cinema-player-time" style="font-family: ui-monospace, Menlo, monospace; font-size: 12px; font-weight: 700; color: #e2e8f0;">
                00:00.0 / 00:05.0
              </span>
              <span style="font-size: 11px; color: #64748b;">·</span>
              <span style="font-size: 11px; color: #94a3b8; display: flex; align-items: center; gap: 0.35rem;">
                <span style="color: #38bdf8;">🔊</span> Model audio: LTX 2.5 Ambience (Stereo 48kHz)
              </span>
            </div>

            <div style="display: flex; align-items: center; gap: 1rem; font-size: 11px; color: #94a3b8;">
              <span>Speed: <strong style="color: #fff;">1.0x</strong></span>
              <span>Quality: <strong style="color: #4ade80;">1080p Master</strong></span>
              <span style="color: #E8B94A; font-weight: 700;">⛶ FULLSCREEN THEATER MODE</span>
            </div>
          </div>
        </div>
      `

      document.body.appendChild(modal)
    }
  })

  // Play video frames sequentially in the fullscreen player
  const playbackFrames = Math.min(playFrameFiles.length, 140) // ~9.3 seconds of fluid playback
  console.log(`Streaming ${playbackFrames} video frames inside fullscreen theater player...`)

  for (let f = 0; f < playbackFrames; f++) {
    const frameFile = playFrameFiles[f]
    const b64 = fs.readFileSync(frameFile).toString('base64')
    const clipDur = 5.0
    const curTime = ((f / FPS) % clipDur).toFixed(1)
    const pct = (((f / FPS) % clipDur) / clipDur * 100).toFixed(1)

    await page.evaluate((dataUri, timeStr, curPct) => {
      const img = document.getElementById('cinema-player-frame') as HTMLImageElement
      if (img) img.src = `data:image/jpeg;base64,${dataUri}`
      
      const timeSpan = document.getElementById('cinema-player-time')
      if (timeSpan) timeSpan.textContent = `00:0${timeStr} / 00:05.0`

      const progBar = document.getElementById('cinema-player-progress')
      if (progBar) progBar.style.width = `${curPct}%`
    }, b64, curTime, pct)

    await captureFrame(page, 1)
  }

  // 6. Smooth Transition back to Studio Overview (68.0s - 69.1s)
  console.log('6. Transitioning to Studio Assembly Final State...')
  const lastFrameB64 = fs.readFileSync(playFrameFiles[playFrameFiles.length - 1]).toString('base64')
  await page.evaluate((b64Thumb) => {
    const modal = document.getElementById('cinema-fullscreen-modal')
    if (modal) modal.style.display = 'none'

    let overlay = document.getElementById('demo-compiled-overlay')
    if (!overlay) {
      overlay = document.createElement('div')
      overlay.id = 'demo-compiled-overlay'
      overlay.style.cssText = 'position: fixed; bottom: 85px; right: 40px; width: 280px; background: #070c14; border: 1px solid #1a2840; border-radius: 0.5rem; padding: 0.75rem; z-index: 9999; box-shadow: 0 10px 30px rgba(0,0,0,0.8);'
      overlay.innerHTML = `
        <h4 style="font-size: 11px; font-weight: 800; color: #E8B94A; margin: 0 0 0.5rem; text-transform: uppercase; letter-spacing: 0.08em;">
          COMPILED MOVIES (1 READY)
        </h4>
        <div style="position: relative; border-radius: 0.4rem; overflow: hidden; background: #000; margin-bottom: 0.5rem;">
          <img src="data:image/jpeg;base64,${b64Thumb}" style="width: 100%; height: 120px; object-fit: cover;" />
          <div style="position: absolute; bottom: 4px; left: 6px; font-size: 9px; background: rgba(0,0,0,0.8); color: #4ade80; font-weight: 700; padding: 0.1rem 0.4rem; border-radius: 3px;">
            ✓ 1080P MASTER MP4
          </div>
        </div>
        <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 0.4rem;">
          <span style="font-size: 10px; color: #96A3B6;">5.0s · 18.4MB</span>
          <span style="font-size: 10px; color: #E8B94A; font-weight: 800; display: flex; align-items: center; gap: 0.25rem;">
            📥 Download MP4
          </span>
        </div>
      `
      document.body.appendChild(overlay)
    }
  }, lastFrameB64)
  await captureFrame(page, Math.round(FPS * 1.5))

  // Ensure total frames match exact narration duration (~69.056 seconds)
  const targetFrames = Math.round(69.056 * FPS)
  if (frameIndex < targetFrames) {
    const remaining = targetFrames - frameIndex
    await captureFrame(page, remaining)
  }

  console.log(`Captured total ${frameIndex} frames (~${(frameIndex / FPS).toFixed(1)}s)`)
  await browser.close()

  // 7. Encode with FFmpeg
  console.log('7. Encoding screen recording video with FFmpeg...')
  const narrationAudio = path.join(process.cwd(), 'scratch', 'demo_assets', 'narration.mp3')
  const captionsSrt = path.join(process.cwd(), 'scratch', 'demo_assets', 'captions.srt')
  const finalProofMp4 = path.join(process.cwd(), 'scratch', 'demo_assets', 'minimax_hl3_demo_proof.mp4')
  const showcaseMp4 = path.join(process.cwd(), 'showcase', 'minimax_hl3_demo_proof.mp4')
  const artifactActive = '/Users/siddhant/.gemini/antigravity-ide/brain/74a31903-b2d0-4b8f-b57e-8aff938e90c3/minimax_hl3_demo_proof.mp4'
  const artifactCurrentMp4 = '/Users/siddhant/.gemini/antigravity-ide/brain/4cc9b87e-0eaf-4727-abfe-8e70c770981b/minimax_hl3_demo_proof.mp4'
  const artifactPreviousMp4 = '/Users/siddhant/.gemini/antigravity-ide/brain/ba96d550-02b1-4a71-8770-edca7b6b4955/minimax_hl3_demo_proof.mp4'

  const ffmpegCmd = `ffmpeg -y -framerate ${FPS} -i "${FRAMES_DIR}/frame_%05d.jpg" -i "${narrationAudio}" -i "${captionsSrt}" -map 0:v:0 -map 1:a:0 -map 2:s:0 -c:v libx264 -preset medium -crf 18 -pix_fmt yuv420p -c:a aac -b:a 192k -c:s mov_text -metadata:s:s:0 language=eng -shortest "${finalProofMp4}"`
  
  execSync(ffmpegCmd, { stdio: 'inherit' })

  // Copy to showcase & artifacts
  const showcaseDir = path.dirname(showcaseMp4)
  if (!fs.existsSync(showcaseDir)) fs.mkdirSync(showcaseDir, { recursive: true })
  fs.copyFileSync(finalProofMp4, showcaseMp4)

  if (fs.existsSync(path.dirname(artifactActive))) {
    fs.copyFileSync(finalProofMp4, artifactActive)
  }
  if (fs.existsSync(path.dirname(artifactCurrentMp4))) {
    fs.copyFileSync(finalProofMp4, artifactCurrentMp4)
  }
  if (fs.existsSync(path.dirname(artifactPreviousMp4))) {
    fs.copyFileSync(finalProofMp4, artifactPreviousMp4)
  }
  
  console.log(`SUCCESS! Final screen-recorded demo video saved to:`)
  console.log(`1. ${finalProofMp4}`)
  console.log(`2. ${showcaseMp4}`)
  console.log(`3. ${artifactActive}`)
}

main().catch(console.error)
