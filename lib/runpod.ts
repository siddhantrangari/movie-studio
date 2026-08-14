const RUNPOD_API = 'https://rest.runpod.io/v1'

export const POD_NAMES = {
  ltx25: 'ltx25-videogen',
  minimax: 'minimax-h3-videogen',
} as const

export type PodModel = keyof typeof POD_NAMES

export function runpodHeaders() {
  return {
    Authorization: `Bearer ${process.env.RUNPOD_API_KEY}`,
    'Content-Type': 'application/json',
  }
}

export async function listPods(): Promise<Record<string, unknown>[]> {
  const res = await fetch(`${RUNPOD_API}/pods`, {
    headers: runpodHeaders(),
    cache: 'no-store',
  })
  const data = await res.json()
  return Array.isArray(data) ? data : []
}

export async function findPod(model: PodModel) {
  const pods = await listPods()
  return pods.find((p) => p.name === POD_NAMES[model]) ?? null
}

/** Pod id only when the pod is actually up and able to serve ComfyUI. */
export async function getRunningPodId(model: PodModel): Promise<string | null> {
  const pod = await findPod(model)
  if (!pod || pod.desiredStatus !== 'RUNNING') return null
  return (pod.id as string) ?? null
}
