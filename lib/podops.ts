import fs from 'fs'
import path from 'path'
import { execFileSync } from 'child_process'

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
const POD_NAME = 'ltx25-videogen'
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

// Cheapest first. LTX 2.5 int8 fits in 24GB.
const GPUS = [
  'NVIDIA GeForce RTX 3090',
  'NVIDIA GeForce RTX 4090',
  'NVIDIA RTX A6000',
  'NVIDIA A40',
  'NVIDIA L40S',
]

export type LogLine = { level: 'info' | 'ok' | 'warn' | 'error' | 'done'; text: string }

/**
 * A lifecycle run, kept in module scope so it outlives the request that started
 * it. Closing the tab mid-provision used to abort a half-finished pod that was
 * still billing; now the work continues and any client can re-attach to the log.
 */
type Job = { id: string; action: string; lines: LogLine[]; running: boolean; startedAt: number }
let current: Job | null = null

export function currentJob(): Job | null {
  return current
}

/** Starts a run detached from the caller. Returns immediately. */
export function startJob(action: 'up' | 'down'): Job {
  if (current?.running) return current
  const job: Job = { id: Math.random().toString(36).slice(2, 10), action, lines: [], running: true, startedAt: Date.now() }
  current = job
  ;(async () => {
    try {
      for await (const line of action === 'up' ? bringUp() : tearDown()) {
        job.lines.push(line)
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

export async function findPod(): Promise<Record<string, unknown> | null> {
  const { data } = await api('/pods')
  if (!Array.isArray(data)) return null
  return data.find((p) => p.name === POD_NAME) ?? null
}

export async function findVolumeId(): Promise<string | null> {
  try {
    const res = await fetch('https://api.runpod.io/graphql', {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ query: '{ myself { networkVolumes { id name } } }' }),
      cache: 'no-store',
    })
    const j = await res.json()
    const volumes = j?.data?.myself?.networkVolumes
    if (Array.isArray(volumes)) {
      const v = volumes.find((vol: { name?: string; id?: string }) => vol.name === 'ltx25-models')
      return v?.id ?? null
    }
  } catch {
    // ignore
  }
  return null
}

/**
 * Deploys a pod and provisions it, yielding progress as it goes.
 * Safe to call when a pod already exists — it reports and stops.
 */
export async function* bringUp(): AsyncGenerator<LogLine> {
  const existing = await findPod()
  if (existing) {
    const id = String(existing.id)
    yield { level: 'ok', text: `Pod already running: ${id}` }
    if (await comfyReady(id)) {
      yield { level: 'ok', text: 'ComfyUI is already running and ready.' }
      yield { level: 'done', text: id }
      return
    }
    // Provisioning happens at boot, so re-attaching is just tailing its log.
    yield* awaitProvisioning(id, Number(existing.costPerHr) || 0.22)
    return
  }

  const pubkey = ensureKeypair()
  yield { level: 'info', text: 'Server SSH key ready' }

  let provisionScript = ''
  try {
    provisionScript = fs.readFileSync(path.join(process.cwd(), 'scripts', 'provision-ltx25.sh'), 'utf8')
  } catch (e) {
    yield { level: 'error', text: `Could not read provisioning script: ${(e as Error).message}` }
    return
  }

  const networkVolumeId = await findVolumeId()
  if (networkVolumeId) {
    yield { level: 'ok', text: `Using network volume ${networkVolumeId}` }
  }

  // A community host can be structurally broken — GPU present but unusable.
  // The provisioning script detects that in seconds, so a couple of retries
  // costs cents and turns an unrecoverable failure into a slow success.
  const MAX_HOSTS = 3
  for (let attempt = 1; attempt <= MAX_HOSTS; attempt++) {
    let podId = ''
    let rate = 0.22

    for (const gpu of GPUS) {
      yield { level: 'info', text: `Requesting ${gpu}…` }
      const body: Record<string, unknown> = {
        name: POD_NAME,
        templateId: TEMPLATE_ID,
        gpuTypeIds: [gpu],
        gpuCount: 1,
        containerDiskInGb: 100,
        cloudType: 'COMMUNITY',
        ports: PORTS,
        env: {
          HF_TOKEN: process.env.HF_TOKEN ?? '',
          PUBLIC_KEY: pubkey,
          PROVISION_SCRIPT: provisionScript,
        },
        dockerEntrypoint: ['/bin/bash', '-c'],
        dockerStartCmd: [bootCommand()],
      }
      if (networkVolumeId) {
        body.networkVolumeId = networkVolumeId
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
 *
 * ComfyUI now starts while the downloads are still running, so it answering is
 * no longer the finish line — the script's own PROVISION_EXIT marker is.
 */
/** Lets the caller distinguish "this host is dead" from ordinary failure. */
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
      // The last line may still be mid-write, so hold it until more arrives.
      const lines = log.split('\n')
      let failed = false
      while (emitted < lines.length - 1) {
        const text = lines[emitted++].trimEnd()
        if (!text) continue
        // Phase markers are plumbing between the boot script and this loop —
        // read them for state, but don't show them.
        if (text.includes('GPU_BROKEN')) outcome.hostBroken = true
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

export async function* tearDown(): AsyncGenerator<LogLine> {
  const pod = await findPod()
  if (!pod) {
    yield { level: 'ok', text: 'No pod running — nothing is billing.' }
    yield { level: 'done', text: '' }
    return
  }
  yield { level: 'info', text: `Terminating ${pod.id}…` }
  await api(`/pods/${pod.id}`, { method: 'DELETE' })
  yield { level: 'ok', text: 'Terminated. Billing stopped.' }
  yield { level: 'done', text: '' }
}
