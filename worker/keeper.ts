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
} from './core/deterministic'
import { inferEnding } from './core/ending'
import { callGeminiKeeper, geminiModel } from './core/gemini'
import { buildPrompt } from './core/prompt'
import { sanitizeKeeperRequest } from './core/sanitize'
import {
  enforceDiscoveryConstraints,
  ensureAvailableActions,
  validateKeeperResponse,
} from './core/validate'
import { scenes } from './generated/content'

type RateLimiter = {
  limit: (options: { key: string }) => Promise<{ success: boolean }>
}

type Env = {
  GEMINI_API_KEY: string
  KEEPER_RATE_LIMITER?: RateLimiter
}

const workerVersion = 'keeper-refactor-2026-07-17-1'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders })
    }

    const url = new URL(request.url)

    if (url.pathname === '/health') {
      return json({ model: geminiModel, ok: true, version: workerVersion })
    }

    if (url.pathname !== '/api/keeper') {
      return json({ error: 'not_found' }, 404)
    }

    if (request.method !== 'POST') {
      return json({ error: 'method_not_allowed' }, 405)
    }

    if (env.KEEPER_RATE_LIMITER) {
      const clientIp = request.headers.get('cf-connecting-ip') ?? 'unknown'
      const { success } = await env.KEEPER_RATE_LIMITER.limit({ key: clientIp })

      if (!success) {
        return json({ error: 'rate_limited', message: '請稍後再試。' }, 429)
      }
    }

    try {
      const body = sanitizeKeeperRequest(await request.json())

      return await handleKeeperTurn(body, env)
    } catch (error) {
      // 詳細錯誤只進 observability log，不回傳給 client。
      console.error('keeper_failed', error instanceof Error ? error.message : error)

      return json(
        {
          error: 'keeper_failed',
          message: '守密人暫時沒有回應，請稍後再試。',
        },
        500,
      )
    }
  },
}

async function handleKeeperTurn(body: KeeperRequestBody, env: Env): Promise<Response> {
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
    )
  }

  const response =
    handleDeterministicSceneTransition(
      sceneId,
      playerAction,
      body.selectedAction,
      body.state,
    ) ??
    handleDeterministicInvestigationAction(
      sceneId,
      playerAction,
      body.selectedAction,
      body.state,
      body.character,
    ) ??
    (await runModelTurn(body, sceneId, playerAction, env))

  return json(
    validateKeeperResponse(
      applyInferredEnding(response, sceneId, playerAction, body),
      sceneId,
      body.state,
    ),
  )
}

async function runModelTurn(
  body: KeeperRequestBody,
  sceneId: string,
  playerAction: string,
  env: Env,
): Promise<KeeperResponse> {
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
  const modelResponse =
    (await callGeminiKeeper(env, prompt)) ??
    createKeeperFallbackResponse(
      sceneId,
      playerAction,
      sceneFallbackNarration,
      genericFallbackNarration,
    )
  const constrainedResponse = enforceDiscoveryConstraints(
    modelResponse,
    sceneId,
    playerAction,
    body.state,
  )

  return ensureAvailableActions(constrainedResponse, sceneId, playerAction)
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

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json; charset=utf-8',
    },
    status,
  })
}
