import fs from 'fs'
import path from 'path'

export type UsageRecord = {
  id: string
  timestamp: string
  category: 'openai_prompt' | 'gpu_compute' | 'video_gen'
  type: string
  model: string
  promptTokens?: number
  completionTokens?: number
  totalTokens?: number
  durationSeconds?: number
  resolution?: string
  clipSeconds?: number
  gpuModel?: string
  gpuHourlyRate?: number
  costUsd: number
  details: string
}

const DATA_DIR = path.join(process.cwd(), 'data')
const USAGE_FILE = path.join(DATA_DIR, 'usage-ledger.json')

function ensureFile() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true })
  }
  if (!fs.existsSync(USAGE_FILE)) {
    fs.writeFileSync(USAGE_FILE, JSON.stringify([]), 'utf8')
  }
}

export function getUsageRecords(): UsageRecord[] {
  try {
    ensureFile()
    const content = fs.readFileSync(USAGE_FILE, 'utf8')
    const parsed = JSON.parse(content)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function logUsage(record: Omit<UsageRecord, 'id' | 'timestamp'>): UsageRecord {
  ensureFile()
  const records = getUsageRecords()
  const newRecord: UsageRecord = {
    ...record,
    id: `usg_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    timestamp: new Date().toISOString(),
  }
  records.unshift(newRecord)
  // Keep up to 3000 most recent records
  const trimmed = records.slice(0, 3000)
  fs.writeFileSync(USAGE_FILE, JSON.stringify(trimmed, null, 2), 'utf8')
  return newRecord
}

/**
 * Calculates estimated OpenAI pricing based on model.
 * Default pricing (gpt-4o standard: $2.50 / 1M prompt tokens, $10.00 / 1M completion tokens)
 */
export function estimateOpenAiCost(model: string, promptTokens: number, completionTokens: number): number {
  let promptPricePerM = 2.50
  let compPricePerM = 10.00

  if (model.includes('o1-mini') || model.includes('o3-mini')) {
    promptPricePerM = 1.10
    compPricePerM = 4.40
  } else if (model.includes('o1')) {
    promptPricePerM = 15.00
    compPricePerM = 60.00
  } else if (model.includes('gpt-4.5')) {
    promptPricePerM = 75.00
    compPricePerM = 150.00
  } else if (model.includes('gpt-4o-mini')) {
    promptPricePerM = 0.15
    compPricePerM = 0.60
  }

  const cost = (promptTokens / 1_000_000) * promptPricePerM + (completionTokens / 1_000_000) * compPricePerM
  return Number(cost.toFixed(6))
}

export function getUsageAnalytics() {
  const records = getUsageRecords()

  let totalOpenAiTokens = 0
  let totalOpenAiPromptTokens = 0
  let totalOpenAiCompTokens = 0
  let totalOpenAiCost = 0
  let totalPromptGenerations = 0

  let totalGpuCost = 0
  let totalGpuRenderSeconds = 0
  let totalVideoGenerations = 0

  const modelBreakdown: Record<string, { count: number; tokens: number; cost: number }> = {}
  const gpuRenderTimes: number[] = []
  const gpuCosts: number[] = []

  for (const r of records) {
    if (r.category === 'openai_prompt') {
      totalPromptGenerations++
      totalOpenAiTokens += r.totalTokens || 0
      totalOpenAiPromptTokens += r.promptTokens || 0
      totalOpenAiCompTokens += r.completionTokens || 0
      totalOpenAiCost += r.costUsd || 0

      if (!modelBreakdown[r.model]) {
        modelBreakdown[r.model] = { count: 0, tokens: 0, cost: 0 }
      }
      modelBreakdown[r.model].count++
      modelBreakdown[r.model].tokens += r.totalTokens || 0
      modelBreakdown[r.model].cost += r.costUsd || 0
    } else if (r.category === 'gpu_compute' || r.category === 'video_gen') {
      totalVideoGenerations++
      totalGpuCost += r.costUsd || 0
      if (r.durationSeconds && r.durationSeconds > 0) {
        totalGpuRenderSeconds += r.durationSeconds
        gpuRenderTimes.push(r.durationSeconds)
      }
      if (r.costUsd > 0) {
        gpuCosts.push(r.costUsd)
      }
    }
  }

  // Calculate Unit Economics & Averages
  const avgRenderSecondsPerClip = gpuRenderTimes.length > 0
    ? Number((totalGpuRenderSeconds / gpuRenderTimes.length).toFixed(1))
    : 42.0 // benchmark fallback (42s per clip on RTX 4090 / A100)

  const avgGpuCostPerClip = gpuCosts.length > 0
    ? Number((totalGpuCost / gpuCosts.length).toFixed(4))
    : Number(((avgRenderSecondsPerClip / 3600) * 0.34).toFixed(4)) // benchmark ~$0.0040 / clip

  const avgPromptTokensPerGen = totalPromptGenerations > 0
    ? Math.round(totalOpenAiTokens / totalPromptGenerations)
    : 1850

  const avgPromptCostPerGen = totalPromptGenerations > 0
    ? Number((totalOpenAiCost / totalPromptGenerations).toFixed(4))
    : 0.0018

  const avgTotalCostPerClip = Number((avgGpuCostPerClip + avgPromptCostPerGen).toFixed(4))

  // 1 Minute Full Movie (10 shots of 6s)
  const estCostPer1MinMovie = Number(((avgTotalCostPerClip * 10) + 0.005).toFixed(3)) // ~$0.058
  // 1 Hour Continuous Film (600 shots)
  const estCostPer1HourFilm = Number((estCostPer1MinMovie * 60).toFixed(2)) // ~$3.48

  // Infrastructure Projections & Scalability Engine
  const calculateScaleProjection = (clipCount: number) => {
    const totalRenderSeconds = clipCount * avgRenderSecondsPerClip
    const totalGpuHours = Number((totalRenderSeconds / 3600).toFixed(1))
    const standardPodCost = Number((totalGpuHours * 0.34).toFixed(2)) // RTX 4090 @ $0.34/hr
    const ultra4kPodCost = Number((totalGpuHours * 1.64).toFixed(2))   // A100 @ $1.64/hr
    const aiTokenCost = Number((clipCount * avgPromptCostPerGen).toFixed(2))
    const totalStandardCost = Number((standardPodCost + aiTokenCost).toFixed(2))
    const totalUltraCost = Number((ultra4kPodCost + aiTokenCost).toFixed(2))
    
    // Concurrency / throughput recommendation
    const days = 30
    const clipsPerDay = clipCount / days
    const activeGpuHoursPerDay = totalGpuHours / days
    const minConcurrentNodes = Math.max(1, Math.ceil(activeGpuHoursPerDay / 20)) // assuming 20h usable duty cycle/day

    return {
      clipCount,
      totalGpuHours,
      standardPodCost,
      ultra4kPodCost,
      aiTokenCost,
      totalStandardCost,
      totalUltraCost,
      minConcurrentNodes,
      clipsPerDay: Math.round(clipsPerDay),
    }
  }

  return {
    totalOpenAiTokens,
    totalOpenAiPromptTokens,
    totalOpenAiCompTokens,
    totalOpenAiCost: Number(totalOpenAiCost.toFixed(4)),
    totalPromptGenerations,
    totalGpuCost: Number(totalGpuCost.toFixed(4)),
    totalGpuRenderSeconds: Math.round(totalGpuRenderSeconds),
    totalVideoGenerations,
    totalPlatformCost: Number((totalOpenAiCost + totalGpuCost).toFixed(4)),
    unitEconomics: {
      avgRenderSecondsPerClip,
      avgGpuCostPerClip,
      avgPromptTokensPerGen,
      avgPromptCostPerGen,
      avgTotalCostPerClip,
      estCostPer1MinMovie,
      estCostPer1HourFilm,
    },
    projections: {
      scale100: calculateScaleProjection(100),
      scale1k: calculateScaleProjection(1000),
      scale10k: calculateScaleProjection(10000),
      scale50k: calculateScaleProjection(50000),
      scale100k: calculateScaleProjection(100000),
    },
    modelBreakdown,
    recentRecords: records.slice(0, 150),
  }
}
