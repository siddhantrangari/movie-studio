export type SubsiteStatus = 'live' | 'draft' | 'coming_soon'
export type SubsiteCategory = 'webinar' | 'workshop' | 'tool' | 'course' | 'idea'

export interface Subsite {
  id: string
  slug: string           // becomes siddhantrangari.com/slug
  title: string
  description: string
  category: SubsiteCategory
  status: SubsiteStatus
  url?: string           // external URL if redirecting, else renders internal page
  createdAt: string
  emoji: string
}

// In production, replace this with a DB (Postgres/Supabase/SQLite)
// For now: JSON file on VPS at /data/subsites.json
// This is the seed/default data

export const DEFAULT_SUBSITES: Subsite[] = [
  {
    id: '1',
    slug: 'saas-with-ai-agents',
    title: 'Build Your SaaS with AI Agents',
    description: 'Live webinar series where I take founders from idea to launched SaaS using AI Agents + Vibe Coding.',
    category: 'webinar',
    status: 'live',
    url: 'https://siddhant.chalonline.com/launch-your-saas-product-in-just-3-hours-c384i',
    createdAt: new Date().toISOString(),
    emoji: '🚀',
  },
  {
    id: '2',
    slug: 'myagentfirm-onboarding',
    title: 'Build Your Digital Firm with AI Agents',
    description: 'Hands-on workshop to build your digital empire using AI employees — automate outreach, content, and scale 24/7.',
    category: 'workshop',
    status: 'live',
    url: 'https://myagentfirm.com',
    createdAt: new Date().toISOString(),
    emoji: '🤖',
  },
  {
    id: '3',
    slug: 'tradingos',
    title: 'TradingOS',
    description: 'AI-powered trading platform using ICT methodology.',
    category: 'tool',
    status: 'coming_soon',
    url: 'https://tradeos.cjpmarket.com',
    createdAt: new Date().toISOString(),
    emoji: '📈',
  },
]
