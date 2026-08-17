# Complete MiniMax Hailuo 3 (HL3) & GPT-5.6 Luna Pricing Walkthrough

## Summary of Completed Work

### 1. Full End-to-End MiniMax Hailuo 3 (HL3) Integration
- **Automated Provisioning Script ([`scripts/provision-minimax.sh`](file:///Users/siddhant/DEV-ENV/AntiGravity/movie-studio/scripts/provision-minimax.sh))**:
  - Validates **48GB+ VRAM** (supports NVIDIA RTX A6000, A40, L40S, A100 80GB PCIe/SXM).
  - Installs ComfyUI v0.33.1 and required video nodes.
  - Multi-stream high-speed parallel range downloads for `minimax-h3-int8.safetensors` and `t5xxl_fp8_e4m3fn.safetensors`.
  - Links checkpoints and sets up persistent volume mounting (`minimax-h3-models`).
- **RunPod Configurations ([`lib/runpod.ts`](file:///Users/siddhant/DEV-ENV/AntiGravity/movie-studio/lib/runpod.ts))**:
  - `POD_NAMES`: `ltx25-videogen` & `minimax-videogen`.
  - `VOLUME_NAMES`: `ltx25-models` & `minimax-h3-models`.
- **Pod Lifecycle Management ([`lib/podops.ts`](file:///Users/siddhant/DEV-ENV/AntiGravity/movie-studio/lib/podops.ts))**:
  - Updated `findPod(model)`, `findVolume(model)`, `bringUp(tier, terminatePodId, model)`, `stopPod(id, model)`, and `tearDown(id, model)`.
- **ComfyUI Workflow Engine ([`lib/comfyui.ts`](file:///Users/siddhant/DEV-ENV/AntiGravity/movie-studio/lib/comfyui.ts))**:
  - Added `buildMiniMaxWorkflow()` supporting INT8 quantized MiniMax Hailuo 3, CFG guiders, and optional character image-to-video reference seeding.
- **REST & Streaming API Routes**:
  - [`app/api/videogen/pod/route.ts`](file:///Users/siddhant/DEV-ENV/AntiGravity/movie-studio/app/api/videogen/pod/route.ts): Accepts `model: 'ltx25' | 'minimax'` in GET and POST requests.
  - [`app/api/videogen/generate/route.ts`](file:///Users/siddhant/DEV-ENV/AntiGravity/movie-studio/app/api/videogen/generate/route.ts): Dispatches to the active target model pod.
- **Frontend Pod Control UI ([`app/movie/PodPanel.tsx`](file:///Users/siddhant/DEV-ENV/AntiGravity/movie-studio/app/movie/PodPanel.tsx))**:
  - Added dedicated Model Switcher tabs (**🎬 LTX 2.5 (24GB)** vs **⚡ MiniMax Hailuo 3 (48GB+)**).
  - Displays dynamic pricing and hardware tier details in real time.
- **MCP Server Tools ([`mcp/server.ts`](file:///Users/siddhant/DEV-ENV/AntiGravity/movie-studio/mcp/server.ts))**:
  - `movie_pod_start`: Supports `model: 'ltx25' | 'minimax'` and `tier: 'standard' | 'ultra_4k'`.
  - `movie_pod_status`: Returns live status for requested model.
  - `movie_pod_stop`: Stops or terminates the specific model pod.
  - `movie_pod_resume`: Resumes stopped compute instances.
  - `movie_generate_scene`: Generates scene clips on the chosen model.
- **CLI Tooling ([`scripts/pod.sh`](file:///Users/siddhant/DEV-ENV/AntiGravity/movie-studio/scripts/pod.sh))**:
  - Supports `MODEL=minimax ./scripts/pod.sh up|down|status|volume`.

---

### 2. OpenAI GPT-5.6 Luna AI Script Pricing Correction
- Fixed pricing in [`lib/usage.ts`](file:///Users/siddhant/DEV-ENV/AntiGravity/movie-studio/lib/usage.ts):
  - **Prompt Tokens**: **$0.60 / 1M tokens** ($0.0000006 / token)
  - **Completion Tokens**: **$2.40 / 1M tokens** ($0.0000024 / token)
- Corrected unit economics and forecasting in [`app/components/UsageDashboard.tsx`](file:///Users/siddhant/DEV-ENV/AntiGravity/movie-studio/app/components/UsageDashboard.tsx) (~4.63M tokens costs **~$5.70/mo**, down from outdated $43.25 fallback).
- Updated prompt generator defaults to `gpt-5.6-luna`.

---

### 3. Per-Generation Cost Comparison

| Model Pipeline | Recommended Hardware | VRAM Needed | Render Time (5s Clip) | Cost per 5s Clip | 1-Min Film (12 clips) | Volume Storage |
|---|---|---|---|---|---|---|
| **LTX 2.5** | RTX 3090 / RTX 4090 | 24 GB | ~50–70s | **$0.004 – $0.007** | ~$0.05 – $0.09 | $4.20 / mo (60GB) |
| **MiniMax Hailuo 3** | RTX A6000 / A40 / L40S / A100 | 48 GB+ | ~45–65s | **$0.0045 – $0.015** | ~$0.06 – $0.18 | $5.60 / mo (80GB) |
| **GPT-5.6 Luna** (AI Script) | OpenAI API ($0.60/$2.40 per 1M) | Cloud API | ~3s | **&lt; $0.005** | ~$0.005 (Full script) | N/A |

---

### 4. Verification
- `npm run build` compiled 100% cleanly with full Next.js Turbopack static & dynamic route generation.
- Documentation updated in [`docs/HANDOVER.md`](file:///Users/siddhant/DEV-ENV/AntiGravity/movie-studio/docs/HANDOVER.md), [`public/docs/index.html`](file:///Users/siddhant/DEV-ENV/AntiGravity/movie-studio/public/docs/index.html), and [`scripts/README.md`](file:///Users/siddhant/DEV-ENV/AntiGravity/movie-studio/scripts/README.md).
