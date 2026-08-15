/**
 * Shared between the studio UI and the storyboard renderer.
 *
 * Every dimension is a multiple of 32 — LTX's VAE downsamples by that factor
 * spatially, and off-grid sizes fail inside the model rather than at
 * validation, which makes them miserable to debug.
 *
 * Storyboards persist the *index* into this list, so inserting or reordering
 * entries silently changes the resolution of existing storyboards. Append
 * instead, unless you are certain no saved storyboards exist.
 *
 * Cost scales with pixel count, and roughly linearly in practice: 1280×704 is
 * 3.3x the pixels of 704×384 and took about 3x as long to generate. Draft is
 * the default because iterating on a shot is much cheaper there, and the
 * prompt behaves the same — only the detail changes.
 */
export const RESOLUTIONS = [
  { label: '720P (1280×720 · 16:9 HD)', w: 1280, h: 720 },
  { label: '1080P (1920×1080 · 16:9 Full HD)', w: 1920, h: 1080 },
  { label: '2K (2560×1440 · 16:9 QHD)', w: 2560, h: 1440 },
  { label: '4K (3840×2160 · 16:9 Ultra HD)', w: 3840, h: 2160 },
  { label: '720P Vertical (720×1280 · 9:16 Shorts)', w: 720, h: 1280 },
  { label: '1080P Vertical (1080×1920 · 9:16 Reels)', w: 1080, h: 1920 },
]

export const DEFAULT_RESOLUTION = 1 // 1080P Full HD
