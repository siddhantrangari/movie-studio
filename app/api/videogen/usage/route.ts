import { NextResponse } from 'next/server'
import { isAdminAuthenticated } from '@/lib/auth'
import { getUsageAnalytics, getUsageRecords } from '@/lib/usage'
import { accountBalance, findPod } from '@/lib/podops'

export const dynamic = 'force-dynamic'

export async function GET() {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const analytics = getUsageAnalytics()
  const [account, pod] = await Promise.all([accountBalance(), findPod()])

  return NextResponse.json({
    success: true,
    analytics,
    runpod: {
      accountBalance: account?.balance ?? null,
      currentSpendPerHr: account?.spendPerHr ?? null,
      activePod: pod
        ? {
            id: pod.id,
            name: pod.name,
            gpuDisplayName: (pod.machine as { gpuDisplayName?: string })?.gpuDisplayName || (pod.gpuName as string) || (pod.gpuTypeId as string) || 'NVIDIA GPU',
            costPerHr: Number(pod.costPerHr || 0),
            status: pod.desiredStatus,
          }
        : null,
    },
  })
}
