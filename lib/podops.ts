import fs from 'fs'
import path from 'path'
import { execFileSync } from 'child_process'
import { POD_NAMES, VOLUME_NAMES, PodModel } from './runpod'

/**
 * Pod lifecycle driven from the UI, emitting log lines as it goes.
 *
 * Provisioning runs at container boot via a Docker entrypoint override, and
 * reports back over a plain HTTP log server on the pod. Two earlier approaches
 * failed and should not be revived:
 *
 *   - SSH: some RunPod hosts never assign a public IP or TCP port at all, so
 *     there is nothing to connect to. Only the HTTP proxy is guaranteed.
 *   - dockerStartCmd: runpod/comfyui pins ENTRYPOINT ["/start.sh"], and Docker
 *     only ever replaces CMD, so the script arrived as ignored arguments.
 *
 * dockerEntrypoint replaces the entrypoint itself, which is what actually lets
 * our script run.
 */

const REST = 'https://rest.runpod.io/v1'
const TEMPLATE_ID = 'cw3nka7d08' // RunPod official ComfyUI, CUDA 12.8
const KEY_DIR = path.join(process.cwd(), 'data', 'ssh')
const KEY_PATH = path.join(KEY_DIR, 'pod_key')

// A port of our own for the log server, so it can't collide with anything the
// image already serves. RunPod only proxies ports declared at creation.
const LOG_PORT = 7777
const LOG_DIR = '/var/log/provision'
export const PORTS = ['8188/http', '8080/http', '8888/http', `${LOG_PORT}/http`, '22/tcp']

/**
 * What the container runs instead of its own entrypoint.
 *
 * Ordering is dictated by the image: /workspace/runpod-slim/ComfyUI does not
 * exist until /start.sh copies it there from /opt/comfyui-baked, but the baked
 * copy is present from boot. So the version upgrade goes first against the
 * baked tree (~5s, and /start.sh then copies the upgraded code), while the
 * multi-GB model downloads run alongside /start.sh rather than delaying it.
 */
export function bootCommand(): string {
  const script = `${LOG_DIR}/provision.sh`
  return [
    `mkdir -p ${LOG_DIR}`,
    `LOG=${LOG_DIR}/provision.log`,
    ': > "$LOG"',
    // Serves $LOG at http://<pod>-7777.proxy.runpod.net/provision.log. The
    // interpreter name is not guaranteed this early, before /start.sh has set
    // up its paths, and losing the log server means provisioning goes blind.
    `PY=$(command -v python3 || command -v python)`,
    `[ -n "$PY" ] && ("$PY" -m http.server ${LOG_PORT} --directory ${LOG_DIR} >/dev/null 2>&1 &)`,
    'echo "[boot] entrypoint override active — provisioning starting" >> "$LOG"',
    `printenv PROVISION_SCRIPT > ${script}`,
    // Line-buffer it, or a multi-minute download's output sits in a 4KB block
    // buffer and the log looks frozen.
    'command -v stdbuf >/dev/null 2>&1 && BUF="stdbuf -oL -eL" || BUF=""',
    // tee, not plain redirect: the file feeds the app's log panel, while stdout
    // is what shows up in RunPod's own Container log tab. Redirecting only to
    // the file left that tab blank, which made the console useless for support.
    `(PROVISION_PHASE=code $BUF bash ${script} 2>&1; echo "CODE_EXIT=$?") | tee -a "$LOG"`,
    `((PROVISION_PHASE=models $BUF bash ${script} 2>&1; echo "PROVISION_EXIT=$?") | tee -a "$LOG") &`,
    // Runs even if provisioning failed, so a broken pod stays inspectable.
    'exec /start.sh',
  ].join('\n')
}

// Standard 24GB tier (cheap & fast for LTX 2.5 720p/1080p)
export const STANDARD_GPUS = [
  'NVIDIA GeForce RTX 3090',
  'NVIDIA GeForce RTX 4090',
  'NVIDIA RTX A6000',
  'NVIDIA A40',
  'NVIDIA L40S',
]

// Ultra 4K tier (48GB/80GB VRAM required for raw 4K 3D attention volume)
export const ULTRA_4K_GPUS = [
  'NVIDIA RTX A6000',          // 48GB VRAM
  'NVIDIA A40',                // 48GB VRAM
  'NVIDIA L40S',               // 48GB VRAM
  'NVIDIA A100 80GB PCIe',     // 80GB VRAM
  'NVIDIA A100-SXM4-80GB',     // 80GB VRAM
]

// MiniMax Hailuo 3 tier (48GB+ VRAM required for MiniMax H3 INT8 transformer)
export const MINIMAX_GPUS = [
  'NVIDIA RTX A6000',          // 48GB VRAM
  'NVIDIA A40',                // 48GB VRAM
  'NVIDIA L40S',               // 48GB VRAM
  'NVIDIA A100 80GB PCIe',     // 80GB VRAM
  'NVIDIA A100-SXM4-80GB',     // 80GB VRAM
]

export type GpuTier = 'standard' | 'ultra_4k'

/**
 * Minimum download speed worth proceeding with, and only relevant on the
 * fallback path where there is no volume and the models must come down.
 */
const SPEED_FLOOR_MBPS = 30

export type LogLine = { level: 'info' | 'ok' | 'warn' | 'error' | 'done'; text: string }

/**
 * A lifecycle run, kept in module scope so it outlives the request that started it.
 */
type Job = {
  id: string
  action: string
  model?: PodModel
  tier?: GpuTier
  lines: LogLine[]
  running: boolean
  startedAt: number
}
let current: Job | null = null

export type PodInfo = {
  id: string
  name: string
  gpuDisplayName: string
  status: string
  costPerHr: number
  storagePerHr: number
  totalPerHr: number
  diskGb: number
  comfyui: string
  jupyter: string
}

export function currentJob(): Job | null {
  return current
}

export async function listAllPods(): Promise<PodInfo[]> {
  const { data } = await api('/pods')
  if (!Array.isArray(data)) return []
  return data.map((p) => {
    const gpu = Number(p.costPerHr ?? 0)
    const diskGb = Number(p.containerDiskInGb ?? 0) + Number(p.volumeInGb ?? 0)
    const storage = (diskGb * 0.1) / 730
    const machine = p.machine as { gpuDisplayName?: string } | undefined
    const gpuObj = p.gpu as { id?: string } | undefined
    const gpuDisplayName = (p.gpuDisplayName as string) || gpuObj?.id || machine?.gpuDisplayName || (p.gpuName as string) || (p.gpuTypeId as string) || 'NVIDIA GPU'
    return {
      id: String(p.id),
      name: String(p.name ?? 'pod'),
      gpuDisplayName,
      status: String(p.desiredStatus ?? 'UNKNOWN'),
      costPerHr: gpu,
      storagePerHr: Number(storage.toFixed(4)),
      totalPerHr: Number((gpu + storage).toFixed(3)),
      diskGb,
      comfyui: `https://${p.id}-8188.proxy.runpod.net`,
      jupyter: `https://${p.id}-8888.proxy.runpod.net`,
    }
  })
}

export async function stopPod(podId?: string, model: PodModel = 'ltx25'): Promise<{ ok: boolean; error?: string }> {
  const targetId = podId || (await findPod(model))?.id
  if (!targetId) return { ok: false, error: 'No pod found to stop' }
  const res = await api(`/pods/${targetId}/stop`, { method: 'POST' })
  return { ok: res.ok, error: res.error ? String(res.error) : undefined }
}

export async function resumePod(podId: string): Promise<{ ok: boolean; error?: string }> {
  if (!podId) return { ok: false, error: 'Pod ID required' }
  const res = await api(`/pods/${podId}/start`, { method: 'POST' })
  return { ok: res.ok, error: res.error ? String(res.error) : undefined }
}

export async function terminatePod(podId?: string, model: PodModel = 'ltx25'): Promise<{ ok: boolean; error?: string }> {
  const targetId = podId || (await findPod(model))?.id
  if (!targetId) return { ok: false, error: 'No pod found to terminate' }
  const res = await api(`/pods/${targetId}`, { method: 'DELETE' })
  return { ok: res.ok, error: res.error ? String(res.error) : undefined }
}

/** Starts a run detached from the caller. Returns immediately. */
export function startJob(
  action: 'up' | 'down' | 'stop' | 'start' | 'terminate',
  options: { tier?: GpuTier; terminatePodId?: string; targetPodId?: string; model?: PodModel } = {}
): Job {
  if (current?.running) return current
  const tier = options.tier || 'standard'
  const model = options.model || 'ltx25'
  const job: Job = {
    id: Math.random().toString(36).slice(2, 10),
    action,
    model,
    tier,
    lines: [],
    running: true,
    startedAt: Date.now(),
  }
  current = job
  ;(async () => {
    try {
      if (action === 'up') {
        for await (const line of bringUp(tier, options.terminatePodId, model)) {
          job.lines.push(line)
        }
      } else if (action === 'down' || action === 'terminate') {
        for await (const line of tearDown(options.targetPodId, model)) {
          job.lines.push(line)
        }
      } else if (action === 'stop') {
        job.lines.push({ level: 'info', text: `Stopping ${model.toUpperCase()} pod ${options.targetPodId || 'active'}...` })
        const res = await stopPod(options.targetPodId, model)
        if (res.ok) {
          job.lines.push({ level: 'ok', text: `${model.toUpperCase()} pod stopped successfully. Compute billing paused.` })
        } else {
          job.lines.push({ level: 'error', text: `Failed to stop: ${res.error || 'Unknown error'}` })
        }
      } else if (action === 'start') {
        job.lines.push({ level: 'info', text: `Starting pod ${options.targetPodId}...` })
        const res = await resumePod(options.targetPodId!)
        if (res.ok) {
          job.lines.push({ level: 'ok', text: 'Pod started! Booting container...' })
        } else {
          job.lines.push({ level: 'error', text: `Failed to start: ${res.error || 'Unknown error'}` })
        }
      }
    } catch (e) {
      job.lines.push({ level: 'error', text: (e as Error).message })
    } finally {
      job.running = false
    }
  })()
  return job
}

function headers() {
  return {
    Authorization: `Bearer ${process.env.RUNPOD_API_KEY}`,
    'Content-Type': 'application/json',
  }
}

/** Creates the server's keypair on first use. */
export function ensureKeypair(): string {
  fs.mkdirSync(KEY_DIR, { recursive: true, mode: 0o700 })
  if (!fs.existsSync(KEY_PATH)) {
    execFileSync('ssh-keygen', ['-t', 'ed25519', '-N', '', '-C', 'movie-studio', '-f', KEY_PATH], {
      stdio: 'ignore',
    })
    fs.chmodSync(KEY_PATH, 0o600)
  }
  return fs.readFileSync(`${KEY_PATH}.pub`, 'utf8').trim()
}

/**
 * A single dropped connection used to abort an entire provisioning run — the
 * pod carried on downloading while the log went dead. Transient network faults
 * are retried instead; a persistent one still surfaces as data: null.
 */
async function api(pathname: string, init?: RequestInit) {
  let lastError: unknown
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`${REST}${pathname}`, {
        ...init,
        headers: headers(),
        cache: 'no-store',
        signal: AbortSignal.timeout(20_000),
      })
      const text = await res.text()
      try {
        return { ok: res.ok, status: res.status, data: JSON.parse(text) }
      } catch {
        return { ok: res.ok, status: res.status, data: text }
      }
    } catch (e) {
      lastError = e
      await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)))
    }
  }
  return { ok: false, status: 0, data: null, error: lastError }
}

const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

/**
 * True once ComfyUI answers on the pod's proxy URL.
 *
 * This is the signal that actually matters — it means the image finished
 * pulling, the container started, and the app is serving. RunPod exposes no
 * public API for image-pull progress, so this is the closest thing to it.
 */
export async function comfyReady(podId: string): Promise<boolean> {
  try {
    const res = await fetch(`https://${podId}-8188.proxy.runpod.net/system_stats`, {
      headers: { 'User-Agent': BROWSER_UA, Accept: '*/*' },
      cache: 'no-store',
      signal: AbortSignal.timeout(8000),
    })
    return res.ok
  } catch {
    return false
  }
}

/**
 * The provisioning log as the pod has it so far, or null if the log server
 * isn't answering yet (still booting, or the entrypoint override didn't take).
 */
async function fetchProvisionLog(podId: string): Promise<string | null> {
  try {
    const res = await fetch(`https://${podId}-${LOG_PORT}.proxy.runpod.net/provision.log`, {
      headers: { 'User-Agent': BROWSER_UA, Accept: '*/*' },
      cache: 'no-store',
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) return null
    return await res.text()
  } catch {
    return null
  }
}

function classify(line: string): LogLine {
  // The script colourises its output; the codes are noise once the level is
  // carried structurally, and render as literal garbage in the browser.
  const text = line.replace(/\x1b\[[0-9;]*m/g, '').trimEnd()
  if (/PROVISION_EXIT=[1-9]/.test(text) || /\bERROR\b/i.test(text)) return { level: 'error', text }
  if (/✓/.test(text)) return { level: 'ok', text }
  return { level: 'info', text }
}

/** Account balance and current burn, for the UI to surface. */
export async function accountBalance(): Promise<{ balance: number; spendPerHr: number } | null> {
  try {
    const res = await fetch('https://api.runpod.io/graphql', {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ query: '{ myself { clientBalance currentSpendPerHr } }' }),
      cache: 'no-store',
    })
    const j = await res.json()
    const m = j?.data?.myself
    if (!m) return null
    return { balance: Number(m.clientBalance ?? 0), spendPerHr: Number(m.currentSpendPerHr ?? 0) }
  } catch {
    return null
  }
}

export async function findPod(model: PodModel = 'ltx25'): Promise<Record<string, unknown> | null> {
  const { data } = await api('/pods')
  if (!Array.isArray(data)) return null
  return data.find((p) => p.name === POD_NAMES[model]) ?? null
}

/**
 * The persistent model volume, if one exists.
 */
export async function findVolume(model: PodModel = 'ltx25'): Promise<{ id: string; dataCenterId: string } | null> {
  const { data } = await api('/networkvolumes')
  if (!Array.isArray(data)) return null
  const v = data.find((vol: { name?: string }) => vol.name === VOLUME_NAMES[model])
  return v?.id ? { id: String(v.id), dataCenterId: String(v.dataCenterId ?? '') } : null
}

/**
 * Deploys a pod and provisions it, yielding progress as it goes.
 * Safe to call when a pod already exists — it reports and stops.
 */
export async function* bringUp(
  tier: GpuTier = 'standard',
  terminatePodId?: string,
  model: PodModel = 'ltx25'
): AsyncGenerator<LogLine> {
  if (terminatePodId) {
    yield { level: 'info', text: `Terminating pod (${terminatePodId})...` }
    await terminatePod(terminatePodId, model)
    yield { level: 'ok', text: `Pod ${terminatePodId} terminated.` }
    await new Promise((r) => setTimeout(r, 2000))
  }

  const existing = await findPod(model)
  if (existing && !terminatePodId) {
    const id = String(existing.id)
    yield { level: 'ok', text: `${model.toUpperCase()} pod already running: ${id}` }
    if (await comfyReady(id)) {
      yield { level: 'ok', text: 'ComfyUI is already running and ready.' }
      yield { level: 'done', text: id }
      return
    }
    // Provisioning happens at boot, so re-attaching is just tailing its log.
    yield* awaitProvisioning(id, Number(existing.costPerHr) || 0.22)
    return
  }

  const isMiniMax = model === 'minimax'
  const gpuList = isMiniMax
    ? MINIMAX_GPUS
    : tier === 'ultra_4k'
      ? ULTRA_4K_GPUS
      : STANDARD_GPUS

  const modelTitle = isMiniMax ? 'MiniMax Hailuo 3 (48GB+)' : (tier === 'ultra_4k' ? 'LTX 2.5 Ultra 4K (48GB/80GB)' : 'LTX 2.5 Standard (24GB)')
  const podName = POD_NAMES[model]
  const scriptFileName = isMiniMax ? 'provision-minimax.sh' : 'provision-ltx25.sh'

  const pubkey = ensureKeypair()
  yield { level: 'info', text: `Deploying ${modelTitle} GPU pod...` }

  let provisionScript = ''
  try {
    provisionScript = fs.readFileSync(path.join(process.cwd(), 'scripts', scriptFileName), 'utf8')
  } catch (e) {
    yield { level: 'error', text: `Could not read provisioning script: ${(e as Error).message}` }
    return
  }

  const volume = await findVolume(model)
  if (volume) {
    yield {
      level: 'ok',
      text: `Using the ${VOLUME_NAMES[model]} volume in ${volume.dataCenterId} — models will persist.`,
    }
  } else {
    yield {
      level: 'warn',
      text: `No ${VOLUME_NAMES[model]} volume found, weights will be downloaded to container disk.`,
    }
  }

  const MAX_HOSTS = 3
  for (let attempt = 1; attempt <= MAX_HOSTS; attempt++) {
    let podId = ''
    let rate = 0.22

    for (const gpu of gpuList) {
      yield { level: 'info', text: `Requesting ${gpu}…` }
      const envObj: Record<string, string> = {
        HF_TOKEN: process.env.HF_TOKEN ?? '',
        PUBLIC_KEY: pubkey,
        PROVISION_SCRIPT: provisionScript,
        PROBE_SPEED: volume ? '0' : '1',
        SPEED_FLOOR_MBPS: String(SPEED_FLOOR_MBPS),
      }
      if (isMiniMax) {
        envObj.download_minimax_h3 = 'true'
        envObj.minimax_quant = 'int8'
      }

      const body: Record<string, unknown> = {
        name: podName,
        templateId: TEMPLATE_ID,
        gpuTypeIds: [gpu],
        gpuCount: 1,
        containerDiskInGb: volume ? 50 : 100,
        cloudType: volume ? 'SECURE' : 'COMMUNITY',
        ports: PORTS,
        env: envObj,
        dockerEntrypoint: ['/bin/bash', '-c'],
        dockerStartCmd: [bootCommand()],
      }
      if (volume) {
        body.networkVolumeId = volume.id
        body.volumeMountPath = '/workspace'
      }

      const { data } = await api('/pods', {
        method: 'POST',
        body: JSON.stringify(body),
      })
      if (data?.id) {
        podId = data.id
        rate = Number(data.costPerHr) || 0.22
        yield { level: 'ok', text: `Got ${gpu} — ${podId} at $${rate}/hr (billing starts now)` }
        break
      }
      yield { level: 'warn', text: `unavailable: ${String(data?.error ?? '').slice(0, 90)}` }
    }

    if (!podId) {
      yield { level: 'error', text: 'No GPUs available right now. Try again in a few minutes.' }
      return
    }

    const outcome: Outcome = {}
    yield* awaitProvisioning(podId, rate, outcome)
    if (!outcome.hostBroken) return

    yield { level: 'warn', text: `This host's GPU is unusable — terminating ${podId} before it costs anything more.` }
    await api(`/pods/${podId}`, { method: 'DELETE' })
    if (attempt < MAX_HOSTS) {
      yield { level: 'info', text: `Trying a different host (attempt ${attempt + 1} of ${MAX_HOSTS})…` }
    } else {
      yield { level: 'error', text: `${MAX_HOSTS} hosts in a row had unusable GPUs. Nothing is billing — try again shortly.` }
    }
  }
}

/**
 * Tails the pod's provisioning log until the models are down and ComfyUI is up.
 */
type Outcome = { hostBroken?: boolean }

async function* awaitProvisioning(
  podId: string,
  rate: number,
  outcome: Outcome = {}
): AsyncGenerator<LogLine> {
  yield { level: 'info', text: 'Waiting for the container to boot — downloads start the moment it does…' }

  const MAX_TRIES = 180 // 30 minutes at 10s
  let emitted = 0
  let sawLog = false
  let sawComfy = false
  let downloadsDone = false

  for (let i = 0; i < MAX_TRIES; i++) {
    await new Promise((r) => setTimeout(r, 10_000))

    const { data } = await api(`/pods/${podId}`)
    if (data?.desiredStatus && !['RUNNING', 'PENDING'].includes(String(data.desiredStatus))) {
      yield { level: 'error', text: `Pod entered ${data.desiredStatus} — stopping.` }
      return
    }

    const log = await fetchProvisionLog(podId)
    if (log !== null) {
      if (!sawLog) {
        sawLog = true
        yield { level: 'ok', text: 'Provisioning script is running on the pod.' }
      }
      const lines = log.split('\n')
      let failed = false
      while (emitted < lines.length - 1) {
        const text = lines[emitted++].trimEnd()
        if (!text) continue
        if (text.includes('GPU_BROKEN') || text.includes('HOST_SLOW')) outcome.hostBroken = true
        const marker = /(?:PROVISION|CODE)_EXIT=(\d+)/.exec(text)
        if (marker) {
          if (marker[1] !== '0') failed = true
          else if (text.startsWith('PROVISION_EXIT')) downloadsDone = true
          continue
        }
        yield classify(text)
      }
      if (outcome.hostBroken) return
      if (failed) {
        yield { level: 'error', text: 'Provisioning failed. The pod is left up so you can inspect it — remember it is still billing.' }
        return
      }
    }

    if (!sawComfy && (await comfyReady(podId))) {
      sawComfy = true
      yield { level: 'ok', text: 'ComfyUI is up. Finishing model downloads…' }
    }

    if (downloadsDone && sawComfy) {
      yield { level: 'ok', text: 'Models in place and ComfyUI is live — ready to generate.' }
      yield { level: 'done', text: podId }
      return
    }

    if (!sawLog && i > 0 && i % 6 === 0) {
      const mins = Math.max(1, Math.round(((i + 1) * 10) / 60))
      yield {
        level: 'info',
        text: `Pulling container image… ${mins} min ($${((mins / 60) * rate).toFixed(3)} spent)`,
      }
    }
  }

  yield { level: 'warn', text: 'Timed out after 30 min. The pod is still up and billing — inspect it or shut it down.' }
}

export async function* tearDown(targetPodId?: string, model: PodModel = 'ltx25'): AsyncGenerator<LogLine> {
  const pod = targetPodId ? { id: targetPodId } : await findPod(model)
  if (!pod?.id) {
    yield { level: 'ok', text: `No ${model.toUpperCase()} pod found — nothing is billing.` }
    yield { level: 'done', text: '' }
    return
  }
  yield { level: 'info', text: `Terminating pod ${pod.id}…` }
  await api(`/pods/${pod.id}`, { method: 'DELETE' })
  yield { level: 'ok', text: `Pod ${pod.id} terminated. Billing stopped.` }
  yield { level: 'done', text: '' }
}
