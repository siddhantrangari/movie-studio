/**
 * Visual presets for the movie builder.
 *
 * Each preset is a one-click look: a camera move plus lens language plus the
 * grading words that sell it. Picking one is meant to replace writing
 * cinematography prose by hand.
 */

export type Preset = {
  key: string
  label: string
  hint: string
  /** Appended to the shot description at generation time. */
  phrase: string
  /** Two-stop gradient for the card, so the grid reads as a look book. */
  swatch: [string, string]
}

export const SHOT_PRESETS: Preset[] = [
  {
    key: 'push_in',
    label: 'Slow Push In',
    hint: 'Builds intimacy',
    phrase: 'camera slowly pushes in toward the subject, cinematic prime lens, shallow depth of field',
    swatch: ['#3b2f6b', '#151a3a'],
  },
  {
    key: 'pull_back',
    label: 'Pull Back Reveal',
    hint: 'Reveals context',
    phrase: 'camera slowly pulls back to reveal the wider scene, cinematic prime lens, deep focus',
    swatch: ['#1f4b5e', '#10202c'],
  },
  {
    key: 'orbit',
    label: 'Orbit',
    hint: 'Hero product shot',
    phrase: 'camera orbits smoothly around the subject, macro detail, glossy highlights',
    swatch: ['#5e3a1f', '#2a1a10'],
  },
  {
    key: 'macro',
    label: 'Macro Detail',
    hint: 'Texture and craft',
    phrase: 'extreme macro close-up, razor-thin depth of field, every texture visible',
    swatch: ['#4a2f52', '#20142a'],
  },
  {
    key: 'handheld',
    label: 'Handheld Doc',
    hint: 'Real and immediate',
    phrase: 'subtle handheld camera movement, documentary realism, natural available light',
    swatch: ['#2f4a34', '#14231a'],
  },
  {
    key: 'crane',
    label: 'Crane Down',
    hint: 'Grand opening shot',
    phrase: 'camera cranes down from a high angle, sweeping cinematic move, anamorphic wide',
    swatch: ['#5e1f3a', '#2a1020'],
  },
  {
    key: 'static',
    label: 'Locked Off',
    hint: 'Calm and composed',
    phrase: 'locked-off static camera, perfectly composed symmetrical frame, soft even light',
    swatch: ['#3a3f4a', '#1a1d24'],
  },
  {
    key: 'golden',
    label: 'Golden Hour',
    hint: 'Warm and aspirational',
    phrase: 'golden hour backlight, warm rim light, lens bloom, dreamy atmosphere',
    swatch: ['#6b4a1f', '#2c1e10'],
  },
]

export const GRADES: Preset[] = [
  { key: 'none', label: 'Neutral', hint: 'No grade', phrase: '', swatch: ['#3a3f4a', '#1a1d24'] },
  { key: 'luxury', label: 'Luxury', hint: 'Black and gold', phrase: 'luxury commercial grade, deep blacks, warm gold highlights', swatch: ['#6b5320', '#241b0c'] },
  { key: 'noir', label: 'Noir', hint: 'High contrast', phrase: 'high-contrast monochrome, hard shadows, film noir mood', swatch: ['#2b2b2b', '#0d0d0d'] },
  { key: 'pastel', label: 'Pastel', hint: 'Soft and light', phrase: 'soft pastel palette, low contrast, airy and light', swatch: ['#6b5a63', '#2a2328'] },
  { key: 'teal_orange', label: 'Teal & Orange', hint: 'Blockbuster', phrase: 'teal and orange blockbuster grade, cinematic contrast', swatch: ['#1f5e5e', '#5e3a1f'] },
]

export function presetPhrase(list: Preset[], key?: string): string {
  if (!key) return ''
  return list.find((p) => p.key === key)?.phrase ?? ''
}

/** Shot description first, then look, then grade — LTX weights early tokens most. */
export function buildShotPrompt(opts: {
  description: string
  characterDescription?: string
  shotPreset?: string
  grade?: string
}): string {
  return [
    opts.characterDescription?.trim(),
    opts.description.trim(),
    presetPhrase(SHOT_PRESETS, opts.shotPreset),
    presetPhrase(GRADES, opts.grade),
  ]
    .filter((s) => s && s.length)
    .join('. ')
    .replace(/\.\s*\./g, '.')
}
