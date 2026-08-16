/**
 * Turns the canvas's camera and lens dropdowns into prompt language.
 *
 * LTX responds to plain descriptive phrasing, not to token names like
 * "dolly_in", so the picker values are mapped to phrases a cinematographer
 * would actually write.
 */

export const CAMERA_MOTIONS: Record<string, string> = {
  dolly_in: 'camera slowly dollies in toward the subject',
  dolly_out: 'camera slowly dollies out away from the subject',
  pan_left: 'camera pans smoothly to the left',
  pan_right: 'camera pans smoothly to the right',
  tilt_up: 'camera tilts upward',
  tilt_down: 'camera tilts downward',
  zoom_in: 'slow zoom in',
  zoom_out: 'slow zoom out',
  orbit_left: 'camera orbits slowly around the subject to the left',
  orbit_right: 'camera orbits slowly around the subject to the right',
  static: 'locked-off static camera',
}

export const LENS_STYLES: Record<string, string> = {
  cinematic: 'cinematic prime lens, shallow depth of field, filmic contrast',
  wide: 'wide-angle 18mm lens, deep focus, expansive framing',
  portrait: '85mm portrait lens, creamy bokeh, compressed background',
  macro: 'macro lens, extreme close-up detail',
  anamorphic: 'anamorphic lens, wide aspect, horizontal flares',
}

export const LIGHTING_STYLES: Record<string, string> = {
  'Golden Hour': 'golden hour directional sunlight, warm rim light, soft volumetric atmospheric haze',
  'Natural Daylight': 'natural 5600K diffuse daylight, soft organic falloff, gentle ambient bounce',
  'Moody Noir': 'chiaroscuro high-contrast lighting, deep cinematic shadows, dramatic rim lighting',
  'Neon Cyber': 'vibrant neon rim light, moody ambient backlight, saturated urban reflections',
  'Studio Softbox': 'professional 3-point softbox studio lighting, clean catchlights in eyes, controlled contrast',
  'Candlelight Warm': 'flickering warm 2400K candlelight, intimate amber glow, soft deep shadows',
}

export const COLOR_PALETTES: Record<string, string> = {
  'Luxury Warm': 'luxury commercial color grading, deep rich blacks, warm gold highlights, polished filmic contrast',
  'Teal Orange': 'blockbuster teal and orange cinematic grade, rich skin tones, complementary cool shadows',
  'Noir': 'film noir monochrome high-contrast grade, deep blacks, crisp highlights',
  'Natural': 'Kodak Vision3 500T 35mm film stock, neutral authentic color balance, organic color depth',
  'Pastel': 'soft pastel filmic grading, low contrast, airy highlights, gentle tonality',
}

/**
 * Assembles the final prompt: character appearance, then the action, then the
 * camera, lens, lighting, and grade direction. Order matters — LTX weights
 * earlier tokens more heavily, so identity leads and technique trails.
 */
export function composePrompt(opts: {
  prompt: string
  characterDescription?: string
  cameraMotion?: string
  lens?: string
  lighting?: string
  colorPalette?: string
}): string {
  const parts: string[] = []

  if (opts.characterDescription?.trim()) parts.push(opts.characterDescription.trim())
  parts.push(opts.prompt.trim())

  const motion = opts.cameraMotion ? (CAMERA_MOTIONS[opts.cameraMotion] || opts.cameraMotion) : undefined
  if (motion && motion !== 'Auto') parts.push(motion)

  const lens = opts.lens ? (LENS_STYLES[opts.lens] || opts.lens) : undefined
  if (lens && lens !== 'Auto') parts.push(lens)

  const light = opts.lighting ? (LIGHTING_STYLES[opts.lighting] || opts.lighting) : undefined
  if (light && light !== 'Auto') parts.push(light)

  const color = opts.colorPalette ? (COLOR_PALETTES[opts.colorPalette] || opts.colorPalette) : undefined
  if (color && color !== 'Auto') parts.push(color)

  return parts.filter(Boolean).join('. ').replace(/\.\s*\./g, '.')
}

