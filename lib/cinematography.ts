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

/**
 * Assembles the final prompt: character appearance, then the action, then the
 * camera and lens direction. Order matters — LTX weights earlier tokens more
 * heavily, so identity leads and technique trails.
 */
export function composePrompt(opts: {
  prompt: string
  characterDescription?: string
  cameraMotion?: string
  lens?: string
}): string {
  const parts: string[] = []

  if (opts.characterDescription?.trim()) parts.push(opts.characterDescription.trim())
  parts.push(opts.prompt.trim())

  const motion = opts.cameraMotion ? CAMERA_MOTIONS[opts.cameraMotion] : undefined
  if (motion) parts.push(motion)

  const lens = opts.lens ? LENS_STYLES[opts.lens] : undefined
  if (lens) parts.push(lens)

  return parts.filter(Boolean).join('. ').replace(/\.\s*\./g, '.')
}
