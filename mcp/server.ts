import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'

import { findPod, bringUp, tearDown, stopPod, resumePod, accountBalance, comfyReady } from '../lib/podops'
import { PodModel } from '../lib/runpod'
import {
  getStoryboards,
  getStoryboard,
  saveStoryboard,
  getCharacters,
  saveCharacter,
  deleteCharacter,
  storeCharacterImage,
  readCharacterImage,
  composeScenePrompt,
  newId,
  Storyboard,
  Scene,
} from '../lib/studio'
import { startAssembly, getFilms, getFilm } from '../lib/assemble'
import { signedUrl, isR2Configured } from '../lib/storage'
import { buildWorkflow, submitPrompt, uploadImageToPod } from '../lib/comfyui'

const server = new Server(
  {
    name: 'movie-studio-mcp',
    version: '1.2.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
)

function parseResolution(resStr?: string | number): { width: number; height: number } {
  const str = String(resStr)
  if (str === '1024x576' || str === '1') return { width: 1024, height: 576 }
  if (str === '704x384' || str === '0') return { width: 704, height: 384 }
  return { width: 1280, height: 704 }
}

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'movie_pod_status',
        description: 'Check GPU pod status for LTX 2.5 or MiniMax Hailuo 3, ComfyUI availability, and RunPod account balance.',
        inputSchema: {
          type: 'object',
          properties: {
            model: {
              type: 'string',
              enum: ['ltx25', 'minimax'],
              description: 'Model pod to check: "ltx25" (LTX 2.5) or "minimax" (MiniMax Hailuo 3)',
              default: 'ltx25',
            },
          },
        },
      },
      {
        name: 'movie_pod_start',
        description: 'Start and provision a GPU pod on RunPod for LTX 2.5 or MiniMax Hailuo 3. Supports standard 24GB tier (RTX 3090/4090) and Ultra 4K / 48GB+ tier (A6000/A40/L40S/A100).',
        inputSchema: {
          type: 'object',
          properties: {
            model: {
              type: 'string',
              enum: ['ltx25', 'minimax'],
              description: 'Target model: "ltx25" (LTX 2.5 Audio-Video) or "minimax" (MiniMax Hailuo 3 - requires 48GB+ VRAM)',
              default: 'ltx25',
            },
            tier: {
              type: 'string',
              enum: ['standard', 'ultra_4k'],
              description: '"standard" (24GB VRAM RTX 3090/4090 for 720p/1080p) or "ultra_4k" (48GB/80GB VRAM A6000/A40/L40S/A100)',
              default: 'standard',
            },
          },
        },
      },
      {
        name: 'movie_pod_stop',
        description: 'Stop or terminate the GPU pod to pause/stop billing.',
        inputSchema: {
          type: 'object',
          properties: {
            model: {
              type: 'string',
              enum: ['ltx25', 'minimax'],
              description: 'Model pod to stop/terminate: "ltx25" or "minimax"',
              default: 'ltx25',
            },
            action: {
              type: 'string',
              enum: ['stop', 'terminate'],
              description: '"terminate" (stops all billing, deletes pod) or "stop" (pauses compute, keeps container disk)',
              default: 'terminate',
            },
            podId: {
              type: 'string',
              description: 'Optional specific pod ID to stop/terminate',
            },
          },
        },
      },
      {
        name: 'movie_pod_resume',
        description: 'Resume a stopped GPU pod on RunPod.',
        inputSchema: {
          type: 'object',
          properties: {
            podId: {
              type: 'string',
              description: 'Pod ID to resume',
            },
          },
          required: ['podId'],
        },
      },
      {
        name: 'movie_create_character',
        description: 'Create a consistent character profile with appearance description and reference image portrait for AI video consistency.',
        inputSchema: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Character name' },
            description: { type: 'string', description: 'Detailed appearance traits appended to prompts for consistency' },
            imageBase64: { type: 'string', description: 'Base64 encoded PNG/JPEG image for initial frame seeding' },
            imageExt: { type: 'string', description: 'Image extension, e.g. ".png" or ".jpg"', default: '.png' },
          },
          required: ['name', 'description'],
        },
      },
      {
        name: 'movie_list_characters',
        description: 'List all created reference characters used for character consistency.',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'movie_delete_character',
        description: 'Delete a character profile and reference portrait.',
        inputSchema: {
          type: 'object',
          properties: {
            characterId: { type: 'string', description: 'Character ID to delete' },
          },
          required: ['characterId'],
        },
      },
      {
        name: 'movie_create_storyboard',
        description: 'Create a new movie storyboard with scene prompts, camera angles, and optional narration.',
        inputSchema: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'Title of the movie film' },
            resolution: {
              type: 'string',
              description: 'Video resolution: "1280x704" (Max), "1024x576" (HD), or "704x384" (Draft)',
              default: '1280x704',
            },
            audioMode: {
              type: 'string',
              description: 'Audio mode: "native" (LTX audio), "elevenlabs" (narration), or "both"',
              default: 'both',
            },
            scenes: {
              type: 'array',
              description: 'List of scene descriptions',
              items: {
                type: 'object',
                properties: {
                  title: { type: 'string' },
                  prompt: { type: 'string' },
                  characterId: { type: 'string', description: 'Optional character ID for image-to-video consistency' },
                  seconds: { type: 'number', default: 5 },
                  narration: { type: 'string' },
                },
                required: ['prompt'],
              },
            },
          },
          required: ['title', 'scenes'],
        },
      },
      {
        name: 'movie_generate_scene',
        description: 'Trigger video clip workflow submission for a single scene on LTX 2.5 or MiniMax Hailuo 3.',
        inputSchema: {
          type: 'object',
          properties: {
            storyboardId: { type: 'string' },
            sceneId: { type: 'string' },
            model: {
              type: 'string',
              enum: ['ltx25', 'minimax'],
              description: 'Model to use: "ltx25" (LTX 2.5) or "minimax" (MiniMax Hailuo 3)',
              default: 'ltx25',
            },
            characterId: { type: 'string', description: 'Character ID to seed reference portrait' },
            referenceStrength: { type: 'number', description: 'Strength of character reference image (0.0 to 1.0)', default: 0.85 },
            seed: { type: 'number' },
          },
          required: ['storyboardId', 'sceneId'],
        },
      },
      {
        name: 'movie_assemble_film',
        description: 'Trigger server-side ffmpeg assembly of all finished scenes into a final MP4 film.',
        inputSchema: {
          type: 'object',
          properties: {
            storyboardId: { type: 'string' },
            captionsEnabled: { type: 'boolean', default: true },
          },
          required: ['storyboardId'],
        },
      },
      {
        name: 'movie_get_film',
        description: 'Get assembly status and presigned video stream/download URL for a film.',
        inputSchema: {
          type: 'object',
          properties: {
            filmId: { type: 'string' },
          },
          required: ['filmId'],
        },
      },
      {
        name: 'movie_list_films',
        description: 'List all generated films and their storage status.',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
    ],
  }
})

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params

  try {
    switch (name) {
      case 'movie_pod_status': {
        const model = ((args as any)?.model || 'ltx25') as PodModel
        const pod = await findPod(model)
        const bal = await accountBalance()
        const podId = (pod?.id as string) || null
        const ready = podId ? await comfyReady(podId) : false

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ model, pod, podId, ready, balance: bal?.balance ?? null }, null, 2),
            },
          ],
        }
      }

      case 'movie_pod_start': {
        const model = ((args as any)?.model || 'ltx25') as PodModel
        const tier = (args as { tier?: 'standard' | 'ultra_4k' })?.tier || 'standard'
        let logs: string[] = []
        for await (const line of bringUp(tier, undefined, model)) {
          logs.push(`[${line.level.toUpperCase()}] ${line.text}`)
        }
        return {
          content: [
            {
              type: 'text',
              text: logs.join('\n') || `${model.toUpperCase()} pod startup process executed.`,
            },
          ],
        }
      }

      case 'movie_pod_stop': {
        const model = ((args as any)?.model || 'ltx25') as PodModel
        const action = (args as any)?.action || 'terminate'
        const podId = (args as any)?.podId
        if (action === 'stop') {
          const res = await stopPod(podId, model)
          return {
            content: [
              {
                type: 'text',
                text: res.ok ? `${model.toUpperCase()} pod stopped.` : `Failed to stop: ${res.error}`,
              },
            ],
          }
        }
        let logs: string[] = []
        for await (const line of tearDown(podId, model)) {
          logs.push(`[${line.level.toUpperCase()}] ${line.text}`)
        }
        return {
          content: [
            {
              type: 'text',
              text: logs.join('\n') || `${model.toUpperCase()} pod termination executed.`,
            },
          ],
        }
      }

      case 'movie_pod_resume': {
        const { podId } = args as any
        const res = await resumePod(podId)
        return {
          content: [
            {
              type: 'text',
              text: res.ok ? `Pod ${podId} resumed.` : `Failed to resume: ${res.error}`,
            },
          ],
        }
      }

      case 'movie_create_character': {
        const { name: charName, description, imageBase64, imageExt } = args as any
        const id = newId()
        let imageFile: string | undefined

        if (imageBase64) {
          const buffer = Buffer.from(imageBase64.replace(/^data:image\/\w+;base64,/, ''), 'base64')
          imageFile = storeCharacterImage(id, buffer, imageExt || '.png')
        }

        const char = saveCharacter({
          id,
          name: charName,
          description,
          imageFile,
        })

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(char, null, 2),
            },
          ],
        }
      }

      case 'movie_list_characters': {
        const chars = getCharacters()
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(chars, null, 2),
            },
          ],
        }
      }

      case 'movie_delete_character': {
        const { characterId } = args as any
        deleteCharacter(characterId)
        return {
          content: [
            {
              type: 'text',
              text: `Character ${characterId} deleted.`,
            },
          ],
        }
      }

      case 'movie_create_storyboard': {
        const { title, resolution, audioMode, scenes } = args as any

        const createdScenes: Scene[] = (scenes || []).map((sc: any, i: number) => ({
          id: newId(),
          order: i,
          title: sc.title || `Scene ${i + 1}`,
          prompt: sc.prompt,
          characterId: sc.characterId,
          seconds: sc.seconds || 5,
          narration: sc.narration || '',
          state: 'idle',
        }))

        const newSb: Storyboard = {
          id: newId(),
          title: title || 'Untitled Film',
          resolution: resolution === '1280x704' ? 2 : resolution === '1024x576' ? 1 : 0,
          audioMode: audioMode || 'both',
          voiceId: undefined,
          scenes: createdScenes,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        }

        saveStoryboard(newSb)

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(newSb, null, 2),
            },
          ],
        }
      }

      case 'movie_generate_scene': {
        const { storyboardId, sceneId, model, characterId, referenceStrength, seed } = args as any
        const targetModel = (model === 'minimax' ? 'minimax' : 'ltx25') as PodModel
        const sb = getStoryboard(storyboardId)
        if (!sb) throw new Error(`Storyboard ${storyboardId} not found`)
        const sceneIdx = sb.scenes.findIndex((s) => s.id === sceneId)
        if (sceneIdx === -1) throw new Error(`Scene ${sceneId} not found in storyboard`)

        const scene = sb.scenes[sceneIdx]
        const targetCharId = characterId || scene.characterId
        let referenceImageName: string | undefined

        const pod = await findPod(targetModel)
        const podId = (pod?.id as string) || null
        if (!podId) throw new Error(`No active ${targetModel.toUpperCase()} GPU pod found. Call movie_pod_start with model="${targetModel}" first.`)

        const allChars = getCharacters()

        if (targetCharId) {
          const char = allChars.find((c) => c.id === targetCharId)
          if (char?.imageFile) {
            const buf = readCharacterImage(char.imageFile)
            if (buf) {
              referenceImageName = await uploadImageToPod(podId, buf, char.imageFile)
            }
          }
        }

        const effectivePrompt = composeScenePrompt(scene, allChars)
        const targetSeed = seed || Math.floor(Math.random() * 1000000)
        const dim = parseResolution(sb.resolution)

        const built = buildWorkflow({
          model: targetModel,
          prompt: effectivePrompt,
          width: dim.width,
          height: dim.height,
          seconds: scene.seconds || 5,
          seed: targetSeed,
          referenceImage: referenceImageName,
          referenceStrength: referenceStrength ?? 0.85,
        })

        const { prompt_id } = await submitPrompt(podId, built.workflow)
        sb.scenes[sceneIdx].state = 'running'
        sb.scenes[sceneIdx].promptId = prompt_id
        saveStoryboard(sb)

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ success: true, sceneId, promptId: prompt_id, model: targetModel, referenceImage: referenceImageName }, null, 2),
            },
          ],
        }
      }

      case 'movie_assemble_film': {
        const { storyboardId, captionsEnabled } = args as any
        const sb = getStoryboard(storyboardId)
        if (!sb) throw new Error(`Storyboard ${storyboardId} not found`)

        const pod = await findPod()
        const podId = (pod?.id as string) || null
        if (!podId) throw new Error('Pod required for assembly. Call movie_pod_start first.')

        const film = startAssembly(sb, podId, {
          enabled: captionsEnabled ?? true,
          font: 'DejaVu Sans',
          fontSize: 22,
          color: '#FFFFFF',
          outlineColor: '#000000',
          outlineWidth: 2,
          position: 'bottom',
          boxed: false,
          uppercase: false,
        })

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(film, null, 2),
            },
          ],
        }
      }

      case 'movie_get_film': {
        const { filmId } = args as any
        const film = getFilm(filmId)
        if (!film) throw new Error(`Film ${filmId} not found`)

        let videoUrl = `/api/admin/videogen/assemble?file=${film.file || filmId + '.mp4'}`
        if (film.storage === 'r2' || (isR2Configured() && film.r2Key)) {
          const r2Url = await signedUrl(film.r2Key || `${filmId}.mp4`)
          if (r2Url) videoUrl = r2Url
        }

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ ...film, videoUrl }, null, 2),
            },
          ],
        }
      }

      case 'movie_list_films': {
        const films = getFilms()
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(films, null, 2),
            },
          ],
        }
      }

      default:
        throw new Error(`Unknown tool: ${name}`)
    }
  } catch (err: any) {
    return {
      isError: true,
      content: [
        {
          type: 'text',
          text: `Error executing tool ${name}: ${err.message}`,
        },
      ],
    }
  }
})

async function main() {
  const transport = new StdioServerTransport()
  await server.connect(transport)
  console.error('Movie Studio MCP Server running on stdio')
}

main().catch((err) => {
  console.error('Fatal error in MCP Server:', err)
  process.exit(1)
})
