import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'

import { findPod, bringUp, tearDown, accountBalance, comfyReady } from '../lib/podops'
import { getStoryboards, getStoryboard, saveStoryboard, newId, Storyboard, Scene } from '../lib/studio'
import { startAssembly, getFilms, getFilm } from '../lib/assemble'
import { signedUrl, isR2Configured } from '../lib/storage'
import { buildWorkflow, submitPrompt } from '../lib/comfyui'

const server = new Server(
  {
    name: 'movie-studio-mcp',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
)

function parseResolution(resStr?: string): { width: number; height: number } {
  if (resStr === '1024x576') return { width: 1024, height: 576 }
  if (resStr === '704x384') return { width: 704, height: 384 }
  return { width: 1280, height: 704 }
}

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'movie_pod_status',
        description: 'Check GPU pod status, ComfyUI availability, and RunPod account balance.',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'movie_pod_start',
        description: 'Start and provision an LTX 2.5 GPU pod on RunPod for video generation.',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'movie_pod_stop',
        description: 'Terminate the GPU pod to stop billing.',
        inputSchema: {
          type: 'object',
          properties: {},
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
        description: 'Trigger LTX 2.5 video clip workflow submission for a single scene.',
        inputSchema: {
          type: 'object',
          properties: {
            storyboardId: { type: 'string' },
            sceneId: { type: 'string' },
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
        const pod = await findPod()
        const bal = await accountBalance()
        const podId = (pod?.id as string) || null
        const ready = podId ? await comfyReady(podId) : false

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ pod, podId, ready, balance: bal?.balance ?? null }, null, 2),
            },
          ],
        }
      }

      case 'movie_pod_start': {
        let logs: string[] = []
        for await (const line of bringUp()) {
          logs.push(`[${line.level.toUpperCase()}] ${line.text}`)
        }
        return {
          content: [
            {
              type: 'text',
              text: logs.join('\n') || 'Pod startup process executed.',
            },
          ],
        }
      }

      case 'movie_pod_stop': {
        let logs: string[] = []
        for await (const line of tearDown()) {
          logs.push(`[${line.level.toUpperCase()}] ${line.text}`)
        }
        return {
          content: [
            {
              type: 'text',
              text: logs.join('\n') || 'GPU pod termination executed.',
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
          seconds: sc.seconds || 5,
          narration: sc.narration || '',
          state: 'idle',
        }))

        const newSb: Storyboard = {
          id: newId(),
          title: title || 'Untitled Film',
          resolution: resolution || '1280x704',
          audioMode: audioMode || 'both',
          voiceId: 'elevenlabs_default',
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
        const { storyboardId, sceneId, seed } = args as any
        const sb = getStoryboard(storyboardId)
        if (!sb) throw new Error(`Storyboard ${storyboardId} not found`)
        const sceneIdx = sb.scenes.findIndex((s) => s.id === sceneId)
        if (sceneIdx === -1) throw new Error(`Scene ${sceneId} not found in storyboard`)

        const pod = await findPod()
        const podId = (pod?.id as string) || null
        if (!podId) throw new Error('No active GPU pod found. Call movie_pod_start first.')

        const targetSeed = seed || Math.floor(Math.random() * 1000000)
        const dim = parseResolution(String(sb.resolution ?? '1280x704'))

        const workflow = buildWorkflow({
          prompt: sb.scenes[sceneIdx].prompt,
          width: dim.width,
          height: dim.height,
          seconds: sb.scenes[sceneIdx].seconds || 5,
          seed: targetSeed,
        })

        const { prompt_id } = await submitPrompt(podId, workflow)
        sb.scenes[sceneIdx].state = 'running'
        sb.scenes[sceneIdx].promptId = prompt_id
        saveStoryboard(sb)

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ success: true, sceneId, promptId: prompt_id }, null, 2),
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
