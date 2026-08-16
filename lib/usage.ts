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
  // Keep up to 2000 most recent records
  const trimmed = records.slice(0, 2000)
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
  let totalVideoGenerations = 0

  const modelBreakdown: Record<string, { count: number; tokens: number; cost: number }> = {}

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
    } else if (r.category === 'gpu_compute') {
      totalGpuCost += r.costUsd || 0
    } else if (r.category === 'video_gen') {
      totalVideoGenerations++
    }
  }

  return {
    totalOpenAiTokens,
    totalOpenAiPromptTokens,
    totalOpenAiCompTokens,
    totalOpenAiCost: Number(totalOpenAiCost.toFixed(4)),
    totalPromptGenerations,
    totalGpuCost: Number(totalGpuCost.toFixed(4)),
    totalVideoGenerations,
    modelBreakdown,
    recentRecords: records.slice(0, 50),
  }
}
