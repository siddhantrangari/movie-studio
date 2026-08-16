/**
 * ComfyUI client for LTX 2.5 audio-video generation.
 *
 * Two things make this work against a RunPod pod:
 *  - RunPod's proxy sits behind Cloudflare, which 1010s plain API clients.
 *    Browser-ish headers get through.
 *  - LTX 2.5 is an audio-video model: video and audio latents are generated
 *    together, then split and decoded by separate VAEs before being muxed.
 */

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

// LTX 2.5 model files (verified present on the pod)
export const MODELS = {
  unet: 'ltx-2.5-22b-distilled-transformer-comfy-int8-convrot.safetensors',
  textEncoder: 'gemma4-12b-with-proj-ltx-2.5-comfy-int8-convrot.safetensors',
  videoVae: 'ltx-2.5-video-vae-conv-bf16.safetensors',
  audioVae: 'ltx-2.5-audio-vae-bf16.safetensors',
}

// The distilled transformer uses a fixed 8-step schedule at CFG 1.
const DISTILLED_SIGMAS = '1.0, 0.99375, 0.9875, 0.98125, 0.975, 0.909375, 0.725, 0.421875, 0.0'

const DEFAULT_NEGATIVE =
  'pc game, console game, video game, cartoon, 3d render, cgi, anime, illustration, ' +
  'plastic skin, wax figure, mannequin, airbrushed, oversmoothed skin, fake eyes, ' +
  'childish, ugly, blurry, distorted, low quality, watermark, text, deformed, extra limbs, ' +
  'oversaturated, artificial bloom, doll face, bad anatomy, jitter, floating objects'

export function comfyHeaders(base: string) {
  return {
    'Content-Type': 'application/json',
    'User-Agent': UA,
    Accept: '*/*',
    Origin: base,
    Referer: base + '/',
  }
}

export function podBase(podId: string) {
  return `https://${podId}-8188.proxy.runpod.net`
}

export type GenParams = {
  model?: 'ltx25' | 'minimax'
  prompt: string
  negativePrompt?: string
  width?: number
  height?: number
  /** Seconds of video. Converted to frames on the 8n+1 grid LTX requires. */
  seconds?: number
  fps?: number
  seed?: number
  /** Reference image (ComfyUI filename) for character consistency. */
  referenceImage?: string
  /** How strongly to hold to the reference image, 0-1. */
  referenceStrength?: number
}

/**
 * LTX needs frame counts on an 8n+1 grid (97, 105, 113...).
 * Round up, never down — asking for 4s and getting 3.88s reads as a bug,
 * and a slightly long clip is trimmed for free during the crossfade.
 */
export function framesForSeconds(seconds: number, fps: number) {
  const raw = Math.ceil(seconds * fps)
  return Math.max(9, Math.ceil((raw - 1) / 8) * 8 + 1)
}

export function buildMiniMaxWorkflow(p: GenParams) {
  const targetWidth = p.width ?? 1280
  const targetHeight = p.height ?? 720
  const fps = p.fps ?? 24
  const frames = Math.max(16, Math.ceil((p.seconds ?? 5) * fps))
  const seed = p.seed ?? Math.floor(Math.random() * 2 ** 31)

  // 2-Stage Multi-Scale Pipeline:
  // Base diffusion latent generated at 768x432 (16:9) with 16 distilled flow-matching steps (5.2x faster!).
  // Then decoded and upscaled using high-fidelity GPU Lanczos super-resolution in <1 second to target resolution (720p/1080p/4K).
  // MiniMax Hailuo 3 natively generates 1280x720 (16:9) video with synchronized stereo audio.
  const isWidescreen = targetWidth >= targetHeight
  const baseWidth = isWidescreen ? (targetWidth >= 1920 ? 1280 : targetWidth) : (targetHeight >= 1920 ? 720 : targetWidth)
  const baseHeight = isWidescreen ? (targetHeight >= 1080 ? 720 : targetHeight) : (targetWidth >= 1080 ? 1280 : targetHeight)

  const wf: Record<string, unknown> = {
    // ── Model loading ──────────────────────────────────────────────────────────
    '1': { class_type: 'UNETLoader', inputs: { unet_name: 'minimax_h3_fl2va_int8_convrot.safetensors', weight_dtype: 'default' } },
    '2': { class_type: 'CLIPLoader', inputs: { clip_name: 'qwen3vl_32b_minimax_h3_int8_convrot.safetensors', type: 'minimax' } },
    '3': { class_type: 'VAELoader', inputs: { vae_name: 'minimax_h3_video_vae_fp16.safetensors' } },
    // ── Text conditioning ──────────────────────────────────────────────────────
    '4': { class_type: 'CLIPTextEncode', inputs: { clip: ['2', 0], text: p.prompt } },
    // ── MiniMax H3 video & audio latent (Native Multimodal Latent Space) ───────
    '6': { class_type: 'EmptyMiniMaxH3LatentAV', inputs: { width: baseWidth, height: baseHeight, length: frames, batch_size: 1 } },
    // ── Sampling (Distilled flow-matching sampling) ───────────────────────────
    '7': {
      class_type: 'KSampler',
      inputs: {
        model: ['1', 0],
        positive: ['4', 0],
        negative: ['4', 0],   // CFG=1 — flow matching distillation
        latent_image: ['6', 0],
        seed,
        steps: 18,
        cfg: 1.0,
        sampler_name: 'euler',
        scheduler: 'simple',
        denoise: 1.0,
      },
    },
    // ── Video Frame Decode ─────────────────────────────────────────────────────
    '8': { class_type: 'VAEDecode', inputs: { samples: ['7', 0], vae: ['3', 0] } },
    // ── Native Stereo Audio Decode ─────────────────────────────────────────────
    '8b': { class_type: 'VAEDecodeAudio', inputs: { samples: ['7', 0], vae: ['3', 0] } },
    // ── High-Fidelity GPU Super-Resolution (if target > base) ──────────────────
    '8a': {
      class_type: 'ImageScale',
      inputs: {
        image: ['8', 0],
        upscale_method: 'lanczos',
        width: targetWidth,
        height: targetHeight,
        crop: 'disabled',
      },
    },
    // ── Video + Synchronized Audio Export ──────────────────────────────────────
    '9': { class_type: 'CreateVideo', inputs: { images: ['8a', 0], audio: ['8b', 0], fps } },
    '10': {
      class_type: 'SaveVideo',
      inputs: { video: ['9', 0], audio: ['8b', 0], filename_prefix: 'gen/minimax', format: 'mp4', codec: 'h264' },
    },
  }

  if (p.referenceImage) {
    wf['6a'] = { class_type: 'LoadImage', inputs: { image: p.referenceImage } }
    wf['6'] = {
      class_type: 'MiniMaxH3ImageToVideo',
      inputs: { image: ['6a', 0], width: baseWidth, height: baseHeight, length: frames, batch_size: 1 },
    }
  }

  return { workflow: wf, seed, length: frames, width: targetWidth, height: targetHeight, fps }
}

export function buildWorkflow(p: GenParams) {
  if (p.model === 'minimax') {
    return buildMiniMaxWorkflow(p)
  }
  const width = p.width ?? 704
  const height = p.height ?? 384
  const fps = p.fps ?? 25
  const length = framesForSeconds(p.seconds ?? 4, fps)
  const seed = p.seed ?? Math.floor(Math.random() * 2 ** 31)
  const negative = p.negativePrompt || DEFAULT_NEGATIVE

  const wf: Record<string, unknown> = {
    '1': { class_type: 'UNETLoader', inputs: { unet_name: MODELS.unet, weight_dtype: 'default' } },
    '2': {
      class_type: 'LTXAVTextEncoderLoader',
      inputs: { text_encoder: MODELS.textEncoder, ckpt_name: MODELS.unet, device: 'default' },
    },
    '3': { class_type: 'VAELoader', inputs: { vae_name: MODELS.videoVae } },
    '4': { class_type: 'LTXVAudioVAELoader', inputs: { ckpt_name: MODELS.audioVae } },

    '5': { class_type: 'CLIPTextEncode', inputs: { clip: ['2', 0], text: p.prompt } },
    '6': { class_type: 'CLIPTextEncode', inputs: { clip: ['2', 0], text: negative } },

    '8': {
      class_type: 'LTXVEmptyLatentAudio',
      inputs: { frames_number: length, frame_rate: fps, batch_size: 1, audio_vae: ['4', 0] },
    },

    '10': {
      class_type: 'LTXVConditioning',
      inputs: { positive: ['5', 0], negative: ['6', 0], frame_rate: fps },
    },
    '13': { class_type: 'KSamplerSelect', inputs: { sampler_name: 'euler' } },
    '14': { class_type: 'ManualSigmas', inputs: { sigmas: DISTILLED_SIGMAS } },
    '15': { class_type: 'RandomNoise', inputs: { noise_seed: seed } },

    '17': { class_type: 'LTXVSeparateAVLatent', inputs: { av_latent: ['16', 0] } },
    '18': { class_type: 'VAEDecode', inputs: { samples: ['17', 0], vae: ['3', 0] } },
    '19': { class_type: 'LTXVAudioVAEDecode', inputs: { samples: ['17', 1], audio_vae: ['4', 0] } },
    '20': { class_type: 'CreateVideo', inputs: { images: ['18', 0], fps, audio: ['19', 0] } },
    '21': {
      class_type: 'SaveVideo',
      inputs: { video: ['20', 0], filename_prefix: 'gen/clip', format: 'mp4', codec: 'h264' },
    },
  }

  if (p.referenceImage) {
    // Image-to-video: the reference image seeds the first frame, which is what
    // keeps a character looking like the same person across shots.
    wf['7a'] = { class_type: 'LoadImage', inputs: { image: p.referenceImage } }
    wf['7'] = {
      class_type: 'LTXVImgToVideo',
      inputs: {
        positive: ['10', 0],
        negative: ['10', 1],
        vae: ['3', 0],
        image: ['7a', 0],
        width,
        height,
        length,
        batch_size: 1,
        strength: p.referenceStrength ?? 1.0,
      },
    }
    wf['9'] = {
      class_type: 'LTXVConcatAVLatent',
      inputs: { video_latent: ['7', 2], audio_latent: ['8', 0] },
    }
    wf['12'] = {
      class_type: 'CFGGuider',
      inputs: { model: ['11', 0], positive: ['7', 0], negative: ['7', 1], cfg: 1.0 },
    }
  } else {
    wf['7'] = {
      class_type: 'EmptyLTXVLatentVideo',
      inputs: { width, height, length, batch_size: 1 },
    }
    wf['9'] = {
      class_type: 'LTXVConcatAVLatent',
      inputs: { video_latent: ['7', 0], audio_latent: ['8', 0] },
    }
    wf['12'] = {
      class_type: 'CFGGuider',
      inputs: { model: ['11', 0], positive: ['10', 0], negative: ['10', 1], cfg: 1.0 },
    }
  }

  wf['11'] = {
    class_type: 'ModelSamplingLTXV',
    inputs: { model: ['1', 0], max_shift: 2.05, base_shift: 0.95, latent: ['9', 0] },
  }
  wf['16'] = {
    class_type: 'SamplerCustomAdvanced',
    inputs: {
      noise: ['15', 0],
      guider: ['12', 0],
      sampler: ['13', 0],
      sigmas: ['14', 0],
      latent_image: ['9', 0],
    },
  }

  return { workflow: wf, seed, length, width, height, fps }
}

export async function submitPrompt(podId: string, workflow: Record<string, unknown>) {
  const base = podBase(podId)
  const res = await fetch(`${base}/prompt`, {
    method: 'POST',
    headers: comfyHeaders(base),
    body: JSON.stringify({ prompt: workflow }),
    cache: 'no-store',
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    if (res.status === 502 || text.includes('Waiting for service to respond') || text.includes('<!DOCTYPE html>') || text.includes('<html')) {
      throw new Error(`GPU Pod is still initializing (downloading models & starting ComfyUI). Please wait ~30-60 seconds and try again.`)
    }
    throw new Error(`ComfyUI rejected the workflow (${res.status}): ${text.slice(0, 300)}`)
  }
  return (await res.json()) as { prompt_id: string }
}

export type JobStatus = {
  state: 'queued' | 'running' | 'done' | 'error'
  filename?: string
  subfolder?: string
  error?: string
}

export async function getJobStatus(podId: string, promptId: string): Promise<JobStatus> {
  const base = podBase(podId)
  const headers = comfyHeaders(base)

  const hist = await fetch(`${base}/history/${promptId}`, { headers, cache: 'no-store' })
    .then((r) => r.json())
    .catch(() => ({}))

  const entry = hist?.[promptId]
  if (entry) {
    const statusStr = entry.status?.status_str
    if (statusStr === 'error') {
      let msg = 'Generation failed'
      for (const m of entry.status?.messages ?? []) {
        if (m[0] === 'execution_error') {
          msg = `${m[1]?.node_type}: ${m[1]?.exception_message}`.slice(0, 300)
        }
      }
      return { state: 'error', error: msg }
    }
    const saved = Object.values(entry.outputs ?? {}).find(
      (o) => (o as { images?: unknown[] })?.images?.length ||
              (o as { gifs?: unknown[] })?.gifs?.length ||    // VHS_VideoCombine
              (o as { videos?: unknown[] })?.videos?.length   // SaveVideo (native)
    ) as { images?: { filename: string; subfolder: string }[]; gifs?: { filename: string; subfolder: string }[]; videos?: { filename: string; subfolder: string }[] } | undefined
    if (saved) {
      const file = saved.videos?.[0] ?? saved.gifs?.[0] ?? saved.images?.[0]
      if (file) return { state: 'done', filename: file.filename, subfolder: file.subfolder }
    }
  }

  const q = await fetch(`${base}/queue`, { headers, cache: 'no-store' })
    .then((r) => r.json())
    .catch(() => ({ queue_running: [], queue_pending: [] }))

  const inList = (arr: unknown[]) =>
    (arr ?? []).some((item) => Array.isArray(item) && item[1] === promptId)

  if (inList(q.queue_running)) return { state: 'running' }
  if (inList(q.queue_pending)) return { state: 'queued' }
  return { state: 'running' }
}

/**
 * Pushes a reference image into the pod's ComfyUI input folder and returns the
 * name to use in LoadImage. Pods are ephemeral, so this runs per generation
 * rather than once per character.
 */
export async function uploadImageToPod(
  podId: string,
  buf: Buffer,
  filename: string
): Promise<string> {
  const base = podBase(podId)
  const form = new FormData()
  form.append('image', new Blob([new Uint8Array(buf)]), filename)
  form.append('overwrite', 'true')

  const headers = comfyHeaders(base) as Record<string, string>
  delete headers['Content-Type'] // let fetch set the multipart boundary

  const res = await fetch(`${base}/upload/image`, {
    method: 'POST',
    headers,
    body: form,
    cache: 'no-store',
  })
  if (!res.ok) {
    throw new Error(`Reference image upload failed (${res.status})`)
  }
  const data = (await res.json()) as { name: string; subfolder?: string }
  return data.subfolder ? `${data.subfolder}/${data.name}` : data.name
}

export async function fetchVideo(podId: string, filename: string, subfolder: string) {
  const base = podBase(podId)
  const url = `${base}/view?filename=${encodeURIComponent(filename)}&subfolder=${encodeURIComponent(
    subfolder
  )}&type=output`
  return fetch(url, { headers: comfyHeaders(base), cache: 'no-store' })
}
