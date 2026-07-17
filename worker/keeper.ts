// Worker 入口：路由、rate limit、請求清洗與回合流程編排。
// 劇本內容一律來自 worker/generated/content.ts（由 scenarios/*.md codegen 產生）。
import type { KeeperRequestBody, KeeperResponse } from '../shared/keeper'
import {
  genericFallbackNarration,
  sceneFallbackNarration,
} from './config/fallbacks'
import {
  createKeeperFallbackResponse,
  handleDeterministicInvestigationAction,
  handleDeterministicSceneTransition,
  handleScriptedInvestigation,
} from './core/deterministic'
import {
  handleAdminPage,
  handleAdminSession,
  handleAdminStats,
} from './core/admin'
import { logTurnEvent, type TurnSource } from './core/analytics'
import { computeBeliefUpdate, gateWitnessEnding } from './core/belief'
import { inferEnding } from './core/ending'
import { callGeminiKeeper, geminiModel } from './core/gemini'
import { handleOfficerArrival, processOfficerDoorPhase } from './core/officer'
import { buildPrompt } from './core/prompt'
import { processRitualPacing } from './core/ritual'
import { resolveSanityEffects } from './core/sanity'
import { handleTtsRequest } from './core/tts'
import { sanitizeKeeperRequest } from './core/sanitize'
import {
  enforceDiscoveryConstraints,
  ensureAvailableActions,
  removeRepeatedActions,
  validateKeeperResponse,
} from './core/validate'
import { scenes } from './generated/content'

type RateLimiter = {
  limit: (options: { key: string }) => Promise<{ success: boolean }>
}

type Env = {
  ADMIN_KEY?: string
  ANALYTICS_DB?: D1Database
  ELEVENLABS_API_KEY?: string
  ELEVENLABS_VOICE_ID?: string
  GEMINI_API_KEY: string
  KEEPER_RATE_LIMITER?: RateLimiter
  TTS_RATE_LIMITER?: RateLimiter
}

const workerVersion = 'keeper-analytics-2026-07-18-6'

// 前端站台在 deep-records.pages.dev（含 preview deployment 子網域）。
// workers.dev 上的同源請求不需要 CORS。
function corsHeadersFor(request: Request): Record<string, string> {
  const origin = request.headers.get('Origin')
  const isAllowed =
    origin === 'https://deep-records.pages.dev' ||
    (origin?.startsWith('https://') === true &&
      origin.endsWith('.deep-records.pages.dev'))

  if (!origin || !isAllowed) {
    return {}
  }

  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin',
  }
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const corsHeaders = corsHeadersFor(request)

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders })
    }

    const url = new URL(request.url)

    if (url.pathname === '/health') {
      return json({ model: geminiModel, ok: true, version: workerVersion }, 200, corsHeaders)
    }

    if (url.pathname === '/admin') {
      return handleAdminPage()
    }

    if (url.pathname === '/api/admin/stats') {
      return handleAdminStats(request, env)
    }

    if (url.pathname === '/api/admin/session') {
      return handleAdminSession(request, env)
    }

    if (url.pathname === '/api/tts') {
      if (request.method !== 'POST') {
        return json({ error: 'method_not_allowed' }, 405, corsHeaders)
      }

      if (env.TTS_RATE_LIMITER) {
        const clientIp = request.headers.get('cf-connecting-ip') ?? 'unknown'
        const { success } = await env.TTS_RATE_LIMITER.limit({ key: clientIp })

        if (!success) {
          return json({ error: 'rate_limited', message: '請稍後再試。' }, 429, corsHeaders)
        }
      }

      return handleTtsRequest(request, env, corsHeaders, ctx)
    }

    if (url.pathname !== '/api/keeper') {
      return json({ error: 'not_found' }, 404, corsHeaders)
    }

    if (request.method !== 'POST') {
      return json({ error: 'method_not_allowed' }, 405, corsHeaders)
    }

    if (env.KEEPER_RATE_LIMITER) {
      const clientIp = request.headers.get('cf-connecting-ip') ?? 'unknown'
      const { success } = await env.KEEPER_RATE_LIMITER.limit({ key: clientIp })

      if (!success) {
        return json({ error: 'rate_limited', message: '請稍後再試。' }, 429, corsHeaders)
      }
    }

    try {
      const body = sanitizeKeeperRequest(await request.json())

      return await handleKeeperTurn(body, env, corsHeaders, ctx)
    } catch (error) {
      // 詳細錯誤只進 observability log，不回傳給 client。
      console.error('keeper_failed', error instanceof Error ? error.message : error)

      return json(
        {
          error: 'keeper_failed',
          message: '守密人暫時沒有回應，請稍後再試。',
        },
        500,
        corsHeaders,
      )
    }
  },
}

async function handleKeeperTurn(
  body: KeeperRequestBody,
  env: Env,
  corsHeaders: Record<string, string>,
  ctx: ExecutionContext,
): Promise<Response> {
  const sceneId = body.sceneId ?? body.state?.currentSceneId ?? '001_apartment_entrance'
  const playerAction = body.playerAction ?? ''
  const scene = scenes[sceneId]

  if (!scene) {
    return json(
      {
        error: 'unknown_scene',
        message: `Unknown sceneId: ${sceneId}`,
      },
      400,
      corsHeaders,
    )
  }

  // 阿陽登場後的門外流程：催促與強制進門會搶佔回合；
  // 開門或首次不理只需記錄旗標（合併進本回合的 effects）。
  const doorPhase = processOfficerDoorPhase(
    sceneId,
    playerAction,
    body.selectedAction,
    body.state,
  )
  // 五樓終局節奏：自由回合計數；超過寬限後阿陽強制推進儀式。
  const ritualPacing = processRitualPacing(sceneId, body.state)

  // 依序嘗試各處理層，並記錄回應來源與模型延遲（供遊玩事件記錄）。
  let turnSource: TurnSource = 'scripted'
  let latencyMs = 0
  let response: KeeperResponse | undefined =
    ritualPacing?.preempt ??
    doorPhase?.preempt ??
    // 阿陽登場條件成立時搶佔本回合行動（跨過第二個不可逆門檻）。
    handleOfficerArrival(sceneId, playerAction, body.selectedAction, body.state)

  if (!response) {
    response = handleDeterministicSceneTransition(
      sceneId,
      playerAction,
      body.selectedAction,
      body.state,
    )

    if (response) {
      turnSource = 'transition'
    }
  }

  if (!response) {
    response =
      handleScriptedInvestigation(
        sceneId,
        playerAction,
        body.selectedAction,
        body.state,
        body.character,
      ) ??
      handleDeterministicInvestigationAction(
        sceneId,
        playerAction,
        body.selectedAction,
        body.state,
        body.character,
      )

    if (response) {
      turnSource = 'deterministic'
    }
  }

  if (!response) {
    const startedAt = Date.now()
    const modelTurn = await runModelTurn(body, sceneId, playerAction, env)
    latencyMs = Date.now() - startedAt
    response = modelTurn.response
    turnSource = modelTurn.source
  }

  const markFlags = { ...doorPhase?.markFlags, ...ritualPacing?.markFlags }

  if (Object.keys(markFlags).length > 0) {
    response = {
      ...response,
      effects: {
        ...response.effects,
        setFlags: {
          ...response.effects?.setFlags,
          ...markFlags,
        },
      },
    }
  }

  // 信念階段由 server 累積制判定；本回合的訊號立即生效，
  // 供見證者終局守門與結局路由（交警方分流）使用。
  const beliefUpdate = computeBeliefUpdate(body.state, response.observation, response.effects)
  const effectiveBody: KeeperRequestBody = {
    ...body,
    state: {
      ...body.state,
      belief: { ...body.state?.belief, stage: beliefUpdate.stage },
    },
  }

  response = {
    ...applyInferredEnding(
      resolveSanityEffects(gateWitnessEnding(response, beliefUpdate.stage), body.state),
      sceneId,
      playerAction,
      effectiveBody,
    ),
    belief: beliefUpdate,
  }

  const validated = validateKeeperResponse(response, sceneId, body.state)

  logTurnEvent(env, ctx, {
    beliefStage: beliefUpdate.stage,
    body,
    latencyMs,
    response: validated,
    sceneId,
    source: turnSource,
  })

  return json(validated, 200, corsHeaders)
}

async function runModelTurn(
  body: KeeperRequestBody,
  sceneId: string,
  playerAction: string,
  env: Env,
): Promise<{ response: KeeperResponse; source: TurnSource }> {
  const prompt = buildPrompt({
    character: body.character,
    checkResults: body.checkResults,
    history: body.history,
    playerAction,
    scene: scenes[sceneId].markdown,
    sceneId,
    selectedAction: body.selectedAction,
    state: body.state,
  })
  const modelResponse = await callGeminiKeeper(env, prompt)
  const source: TurnSource = modelResponse ? 'model' : 'fallback'
  const baseResponse =
    modelResponse ??
    createKeeperFallbackResponse(
      sceneId,
      playerAction,
      sceneFallbackNarration,
      genericFallbackNarration,
    )
  const constrainedResponse = enforceDiscoveryConstraints(
    removeRepeatedActions(baseResponse, body.history),
    sceneId,
    playerAction,
    body.state,
  )

  return {
    response: ensureAvailableActions(
      constrainedResponse,
      sceneId,
      playerAction,
      body.state,
    ),
    source,
  }
}

function applyInferredEnding(
  response: KeeperResponse,
  sceneId: string,
  playerAction: string,
  body: KeeperRequestBody,
): KeeperResponse {
  if (sceneId === '000_prologue') {
    // 楔子階段不允許結局與換場；前端會提供固定的下一步選項。
    return {
      ...response,
      effects: {
        ...response.effects,
        endingId: undefined,
        endingTitle: undefined,
        nextSceneId: undefined,
      },
    }
  }

  // 本回合正是阿陽登場回合時（旗標剛設下、state 還沒反映），同樣不得產生離開結局。
  if (response.effects?.setFlags?.officer_a_yang_arrived === true) {
    return response
  }

  const ending = inferEnding(sceneId, playerAction, body.state, body.selectedAction)

  if (!ending) {
    return response
  }

  return {
    ...response,
    effects: {
      ...response.effects,
      endingId: ending.id,
      endingTitle: ending.title,
    },
  }
}

function json(
  data: unknown,
  status = 200,
  extraHeaders: Record<string, string> = {},
) {
  return new Response(JSON.stringify(data), {
    headers: {
      ...extraHeaders,
      'Content-Type': 'application/json; charset=utf-8',
    },
    status,
  })
}
