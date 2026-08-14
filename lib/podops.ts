import fs from 'fs'
import path from 'path'
import { spawn } from 'child_process'
import { execFileSync } from 'child_process'

/**
 * Pod lifecycle driven from the UI, emitting log lines as it goes.
 *
 * Provisioning needs a shell on the pod, so the server keeps its own SSH
 * keypair and injects the public half as PUBLIC_KEY when the pod is created.
 * That's the only way in — ComfyUI's API can't run commands.
 */

const REST = 'https://rest.runpod.io/v1'
const POD_NAME = 'ltx25-videogen'
const TEMPLATE_ID = 'cw3nka7d08' // RunPod official ComfyUI, CUDA 12.8
const KEY_DIR = path.join(process.cwd(), 'data', 'ssh')
const KEY_PATH = path.join(KEY_DIR, 'pod_key')

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

async function api(pathname: string, init?: RequestInit) {
  const res = await fetch(`${REST}${pathname}`, { ...init, headers: headers(), cache: 'no-store' })
  const text = await res.text()
  try {
    return { ok: res.ok, status: res.status, data: JSON.parse(text) }
  } catch {
    return { ok: res.ok, status: res.status, data: text }
  }
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

/** Runs a command, streaming stdout+stderr line by line. */
function stream(
  cmd: string,
  args: string[],
  onLine: (s: string) => void,
  stdin?: string
): Promise<number> {
  return new Promise((resolve) => {
    const p = spawn(cmd, args)
    if (stdin !== undefined) {
      p.stdin.write(stdin)
      p.stdin.end()
    }
    let buf = ''
    const push = (chunk: Buffer) => {
      buf += chunk.toString()
      const lines = buf.split('\n')
      buf = lines.pop() ?? ''
      // eslint-disable-next-line no-control-regex
      for (const l of lines) if (l.trim()) onLine(l.replace(/\x1b\[[0-9;]*m/g, ''))
    }
    p.stdout.on('data', push)
    p.stderr.on('data', push)
    p.on('error', (e) => { onLine(`ssh failed: ${e.message}`); resolve(1) })
    p.on('close', (code) => {
      if (buf.trim()) onLine(buf)
      resolve(code ?? 1)
    })
  })
}

const sshArgs = (port: number, ip: string, extra: string[]) => [
  '-i', KEY_PATH,
  '-p', String(port),
  '-o', 'StrictHostKeyChecking=no',
  '-o', 'UserKnownHostsFile=/dev/null',
  '-o', 'ConnectTimeout=15',
  `root@${ip}`,
  ...extra,
]

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
    yield { level: 'ok', text: `Pod already running: ${existing.id}` }
    const ready = await comfyReady(String(existing.id))
    if (ready) {
      yield { level: 'ok', text: 'ComfyUI is already running and ready.' }
      yield { level: 'done', text: String(existing.id) }
      return
    }
    const mapped = (existing.portMappings as Record<string, number> | undefined)?.['22']
    if (mapped) {
      yield* provisionExisting(String(existing.publicIp), Number(mapped))
    } else {
      yield { level: 'warn', text: 'No SSH port. If provisioning got interrupted, please restart/reset the pod in your RunPod console.' }
    }
    yield { level: 'done', text: String(existing.id) }
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
      env: {
        HF_TOKEN: process.env.HF_TOKEN ?? '',
        PUBLIC_KEY: pubkey,
        PROVISION_SCRIPT: provisionScript,
      },
      dockerStartCmd: [
        'bash',
        '-c',
        'printenv PROVISION_SCRIPT > /tmp/provision.sh && (BOOT_PROVISION=1 bash /tmp/provision.sh || echo "Provisioning failed") && exec /start.sh',
      ],
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

  yield { level: 'info', text: 'Waiting for pod to boot and run provisioning script (takes ~3–5 min on warm host)…' }
  const MAX_TRIES = 180 // 30 minutes at 10s
  let provisioned = false
  for (let i = 0; i < MAX_TRIES; i++) {
    await new Promise((r) => setTimeout(r, 10_000))
    const { data } = await api(`/pods/${podId}`)
    if (data?.desiredStatus && !['RUNNING', 'PENDING'].includes(String(data.desiredStatus))) {
      yield { level: 'error', text: `Pod entered ${data.desiredStatus} — stopping.` }
      return
    }

    const ready = await comfyReady(podId)
    if (ready) {
      provisioned = true
      break
    }

    if (i > 0 && i % 6 === 0) {
      const mins = Math.max(1, Math.round(((i + 1) * 10) / 60))
      const spent = ((mins / 60) * rate).toFixed(3)
      yield {
        level: 'info',
        text: data?.desiredStatus === 'RUNNING'
          ? `Container active. Provisioning models & starting ComfyUI… ${mins} min ($${spent} spent)`
          : `Pulling container image… ${mins} min ($${spent} spent)`,
      }
    }
  }

  if (!provisioned) {
    yield { level: 'warn', text: 'Timed out waiting for ComfyUI. Check the RunPod console logs to see if downloads are still in progress.' }
    return
  }

  yield { level: 'ok', text: 'ComfyUI is live! Provisioning complete.' }
  yield { level: 'done', text: podId }
}

/**
 * Runs the provisioning script against a pod that is already up.
 *
 * Split out from bringUp so an interrupted run can be resumed — the script is
 * idempotent, so re-running only does what's still missing.
 */
export async function* provisionExisting(ip: string, port: number): AsyncGenerator<LogLine> {
  // The pod writes the key in at startup, so sshd may not accept it instantly.
  yield { level: 'info', text: 'Waiting for SSH…' }
  let reachable = false
  for (let i = 0; i < 12; i++) {
    const code = await stream('ssh', sshArgs(port, ip, ['echo ready']), () => {})
    if (code === 0) { reachable = true; break }
    await new Promise((r) => setTimeout(r, 10_000))
  }
  if (!reachable) {
    yield { level: 'warn', text: 'SSH never came up — the pod is running but not provisioned.' }
    return
  }

  yield { level: 'info', text: 'Provisioning — upgrading ComfyUI and fetching models (~4 min)' }

  // Hand lines to the consumer as they arrive rather than after the fact —
  // a four-minute download with nothing on screen reads as a hang.
  const queue: LogLine[] = []
  let resolveNext: (() => void) | null = null
  let finished = false
  let exitCode = 0
  let sawReset = false

  const wake = () => { resolveNext?.(); resolveNext = null }

  stream(
    'ssh',
    sshArgs(port, ip, ['bash -s']),
    (l) => {
      if (/Reset requested/.test(l)) sawReset = true
      queue.push({
        level: /✓/.test(l) ? 'ok' : /ERROR/i.test(l) ? 'error' : 'info',
        text: l,
      })
      wake()
    },
    provisionStdin()
  ).then((c) => { exitCode = c; finished = true; wake() })

  while (!finished || queue.length) {
    if (!queue.length) {
      await new Promise<void>((r) => { resolveNext = r; setTimeout(wake, 2000) })
      continue
    }
    yield queue.shift()!
  }

  // The script resets the container at the end, which drops the SSH session.
  // A non-zero exit there is expected, not a failure.
  yield exitCode === 0 || sawReset
    ? { level: 'ok', text: 'Provisioned. ComfyUI is restarting — give it a minute.' }
    : { level: 'warn', text: `Provisioning exited ${exitCode} — check the log above.` }
}

/** Feeds the provisioning script over stdin so nothing has to be copied first. */
export function provisionStdin(): string {
  return fs.readFileSync(path.join(process.cwd(), 'scripts', 'provision-ltx25.sh'), 'utf8')
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
