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
  { label: '704×384 · 16:9 Draft', w: 704, h: 384 },
  { label: '832×480 · 16:9', w: 832, h: 480 },
  { label: '1024×576 · 16:9 HD', w: 1024, h: 576 },
  { label: '1280×704 · 16:9 Max', w: 1280, h: 704 },
  { label: '480×832 · 9:16 Reels', w: 480, h: 832 },
  { label: '704×1280 · 9:16 Reels HD', w: 704, h: 1280 },
  { label: '576×576 · 1:1', w: 576, h: 576 },
  { label: '960×960 · 1:1 HD', w: 960, h: 960 },
]

/**
 * Max, not Draft. Measured on an RTX 4090, 1280×704 costs only ~1.5x Draft and
 * is within 1.4% of 1024×576, so defaulting to anything lower just produces
 * worse video for nearly the same money. Draft stays available for iterating
 * on prompts, where the extra detail does not change the composition.
 */
export const DEFAULT_RESOLUTION = 3
