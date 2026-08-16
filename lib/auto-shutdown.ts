import { listPods } from './runpod'
import { terminatePod } from './podops'
import { podBase, comfyHeaders } from './comfyui'

// In-memory pod activity map: podId -> timestamp of last active generation or queue check
const podLastActivity = new Map<string, number>()
let autoShutdownMinutes = 5 // Default 5 minutes
let watcherInterval: NodeJS.Timeout | null = null

/**
 * Updates the last recorded active timestamp for a pod.
 * Called whenever a generation is queued, status is polled, or pod is booted.
 */
export function recordPodActivity(podId: string) {
  podLastActivity.set(podId, Date.now())
}

/**
 * Gets or sets the auto-shutdown inactivity threshold in minutes.
 */
export function getAutoShutdownMinutes() {
  return autoShutdownMinutes
}

export function setAutoShutdownMinutes(minutes: number) {
  autoShutdownMinutes = Math.max(1, Math.min(60, minutes))
}

/**
 * Gets the current idle status and remaining seconds for a running pod.
 */
export function getPodIdleInfo(podId: string) {
  const lastActive = podLastActivity.get(podId) || Date.now()
  const idleMs = Date.now() - lastActive
  const idleSec = Math.floor(idleMs / 1000)
  const maxIdleSec = autoShutdownMinutes * 60
  const remainingSec = Math.max(0, maxIdleSec - idleSec)

  return {
    idleSec,
    maxIdleSec,
    remainingSec,
    willShutdownInSec: remainingSec,
  }
}

/**
 * Scans all active GPU pods and terminates any pod that has been idle with
 * 0 running and 0 pending ComfyUI jobs for longer than the auto-shutdown threshold.
 */
export async function checkAndAutoTerminateIdlePods(): Promise<{ terminated: string[]; checked: number }> {
  const terminated: string[] = []

  try {
    const pods = await listPods()
    const activePods = pods.filter((p) => p.desiredStatus === 'RUNNING')

    for (const pod of activePods) {
      const podId = String(pod.id)
      const podName = String(pod.name || '').toLowerCase()

      // Seeder pods manage their own lifecycle and must not be killed during multi-gigabyte downloads
      if (podName.includes('seeder') || podName.includes('seed')) {
        continue
      }

      const now = Date.now()

      // If we don't have an activity record yet, initialize it to now to give it a full 5-minute window
      if (!podLastActivity.has(podId)) {
        podLastActivity.set(podId, now)
        continue
      }

      const lastActive = podLastActivity.get(podId)!
      const idleTimeMs = now - lastActive
      const maxIdleMs = autoShutdownMinutes * 60 * 1000

      // If idle time exceeds threshold, check ComfyUI queue before shutting down
      if (idleTimeMs >= maxIdleMs) {
        try {
          const base = podBase(podId)
          const qRes = await fetch(`${base}/queue`, {
            headers: comfyHeaders(base),
            signal: AbortSignal.timeout(4000),
          })

          if (qRes.ok) {
            const qData = await qRes.json()
            const runningCount = Array.isArray(qData.queue_running) ? qData.queue_running.length : 0
            const pendingCount = Array.isArray(qData.queue_pending) ? qData.queue_pending.length : 0

            if (runningCount > 0 || pendingCount > 0) {
              // Pod is actively rendering, reset activity timestamp
              podLastActivity.set(podId, now)
              continue
            }
          }

          // Pod is verified completely idle for >= 5 minutes with 0 jobs -> auto-terminate to save billing!
          console.log(`[Auto-Shutdown] ⏱️ Pod ${podId} (${pod.name}) idle for ${Math.round(idleTimeMs / 1000)}s (threshold: ${autoShutdownMinutes}m). Terminating pod to prevent idle charges...`)
          await terminatePod(podId)
        } catch (err: any) {
          // MiniMax H3 downloads ~65GB of weights on first boot — allow 25 minutes before any action.
          // LTX 2.5 downloads ~37GB — allow 15 minutes.
          const uptimeSec = Number((pod.runtime as { uptimeInSeconds?: number })?.uptimeInSeconds || 0)
          const isMiniMaxPod = String(pod.name || '').includes('minimax')
          const warmupWindowSec = isMiniMaxPod ? 1500 : 900 // 25min for MiniMax, 15min for LTX

          if (uptimeSec < warmupWindowSec) {
            console.log(`[Auto-Shutdown] Pod ${podId} (${pod.name}) is still downloading weights / provisioning (uptime: ${uptimeSec}s, window: ${warmupWindowSec}s). Keeping alive...`)
            podLastActivity.set(podId, now)
            continue
          }

          // If ComfyUI is completely unreachable/dead past warmup window and idle threshold exceeded, terminate
          console.log(`[Auto-Shutdown] Pod ${podId} unreachable and idle for ${Math.round(idleTimeMs / 1000)}s (uptime: ${uptimeSec}s). Terminating...`)
          await terminatePod(podId)
          podLastActivity.delete(podId)
          terminated.push(podId)
        }
      }
    }

    return { terminated, checked: activePods.length }
  } catch (err: any) {
    console.error('[Auto-Shutdown] Error scanning pods:', err?.message)
    return { terminated: [], checked: 0 }
  }
}

/**
 * Initializes the background 60-second periodic auto-shutdown scanner.
 */
export function initAutoShutdownWatcher() {
  if (watcherInterval) return
  watcherInterval = setInterval(() => {
    checkAndAutoTerminateIdlePods().catch(() => {})
  }, 60 * 1000)
}

// Start watcher on module load
initAutoShutdownWatcher()
