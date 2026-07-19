// Worker 入口：路由、rate limit、請求清洗與回合流程編排。
// 劇本內容一律來自 worker/generated/content.ts（由 scenarios/*.md codegen 產生）。
import type {
  KeeperRequestBody,
  KeeperResponse,
  KeeperWireState,
} from '../shared/keeper'
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
  isAuthorized,
} from './core/admin'
import { logTurnEvent, type TurnSource } from './core/analytics'
import { computeBeliefUpdate, gateWitnessEnding } from './core/belief'
import { inferEnding } from './core/ending'
import { callGeminiKeeper, geminiModel } from './core/gemini'
import { callOllamaKeeper } from './core/ollama'
import {
  attackOfficerPattern,
  handleOfficerArrival,
  isOfficerPresent,
  processEscortPacing,
  processOfficerDoorPhase,
  processOfficerHiddenPhase,
} from './core/officer'
import { buildPrompt } from './core/prompt'
import { processRitualPacing } from './core/ritual'
import { isWireStateDisordered, resolveSanityEffects } from './core/sanity'
import { handleTtsRequest } from './core/tts'
import { sanitizeKeeperRequest } from './core/sanitize'
import {
  enforceDiscoveryConstraints,
  ensureAvailableActions,
  removeRepeatedActions,
  validateKeeperResponse,
} from './core/validate'
import { scenes } from './generated/content'

export { KeeperSession } from './session'

type RateLimiter = {
  limit: (options: { key: string }) => Promise<{ success: boolean }>
}

export type Env = {
  ADMIN_KEY?: string
  ANALYTICS_DB?: D1Database
  ELEVENLABS_API_KEY?: string
  ELEVENLABS_VOICE_ID?: string
  GEMINI_API_KEY: string
  CF_ACCESS_CLIENT_ID?: string
  CF_ACCESS_CLIENT_SECRET?: string
  // 混合路由：五樓／強制高潮回合改用的高階模型；未設定時全程使用預設模型。
  GEMINI_CLIMAX_MODEL?: string
  // 供應商切換（實驗）：'ollama' 時模型回合改走 tunnel 後的本機 Ollama，
  // 失敗自動退回 Gemini。其餘值（或未設定）＝Gemini。
  KEEPER_PROVIDER?: string
  OLLAMA_MODEL?: string
  OLLAMA_TIMEOUT_MS?: string
  OLLAMA_URL?: string
  KEEPER_RATE_LIMITER?: RateLimiter
  KEEPER_SESSION?: DurableObjectNamespace
  TTS_CACHE?: KVNamespace
  TTS_RATE_LIMITER?: RateLimiter
}

// 執行期供應商設定（KV 覆寫 > wrangler.toml var）：/admin 面板可即時切換免部署。
// KV 為最終一致，全球生效約需一分鐘內。
export type KeeperRuntimeConfig = {
  ollamaModel?: string
  provider?: string
}

const runtimeConfigKey = 'config:keeper'

async function readRuntimeConfig(env: Env): Promise<KeeperRuntimeConfig> {
  if (!env.TTS_CACHE) {
    return {}
  }

  try {
    const raw = await env.TTS_CACHE.get(runtimeConfigKey, 'json')

    return (raw as KeeperRuntimeConfig | null) ?? {}
  } catch {
    return {}
  }
}

const workerVersion = 'keeper-session-2026-07-18-39'

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
      const config = await readRuntimeConfig(env)
      const provider =
        (config.provider ?? env.KEEPER_PROVIDER) === 'ollama' ? 'ollama' : 'gemini'

      return json(
        {
          climaxModel: env.GEMINI_CLIMAX_MODEL ?? null,
          model: geminiModel,
          ok: true,
          provider,
          providerSource: config.provider ? 'kv' : 'var',
          ...(provider === 'ollama'
            ? { ollamaModel: config.ollamaModel ?? env.OLLAMA_MODEL ?? 'qwen3:8b' }
            : {}),
          version: workerVersion,
        },
        200,
        corsHeaders,
      )
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

    // 執行期供應商設定：GET 讀取、POST 寫入（KV，免部署即時切換）。
    if (url.pathname === '/api/admin/config') {
      if (!isAuthorized(request, env)) {
        return json({ error: 'unauthorized' }, 401)
      }

      if (request.method === 'POST') {
        if (!env.TTS_CACHE) {
          return json({ error: 'kv_unavailable' }, 500)
        }

        const body = (await request.json().catch(() => ({}))) as KeeperRuntimeConfig
        const provider = body.provider === 'ollama' ? 'ollama' : 'gemini'
        const config: KeeperRuntimeConfig = {
          provider,
          ...(typeof body.ollamaModel === 'string' && body.ollamaModel.trim()
            ? { ollamaModel: body.ollamaModel.trim() }
            : {}),
        }
        await env.TTS_CACHE.put(runtimeConfigKey, JSON.stringify(config))

        return json({ ok: true, ...config })
      }

      const config = await readRuntimeConfig(env)

      return json({
        effectiveProvider:
          (config.provider ?? env.KEEPER_PROVIDER) === 'ollama' ? 'ollama' : 'gemini',
        kv: config,
        varDefault: env.KEEPER_PROVIDER === 'ollama' ? 'ollama' : 'gemini',
        varOllamaModel: env.OLLAMA_MODEL ?? 'qwen3:8b',
      })
    }

    // 列出目前金鑰可用的 Gemini 模型（挑選混合路由高階模型用）。
    if (url.pathname === '/api/admin/models') {
      if (!isAuthorized(request, env)) {
        return json({ error: 'unauthorized' }, 401)
      }

      const listResponse = await fetch(
        'https://generativelanguage.googleapis.com/v1beta/models?pageSize=100',
        { headers: { 'x-goog-api-key': env.GEMINI_API_KEY } },
      )
      const data = await listResponse.json<{ models?: Array<{ name?: string }> }>()

      return json({
        models: (data.models ?? [])
          .map((m) => (m.name ?? '').replace('models/', ''))
          .filter(Boolean)
          .sort(),
      })
    }

    // 遊戲結束後的星級評分：每 session 一筆（重評覆蓋）。
    if (url.pathname === '/api/rating') {
      if (request.method !== 'POST') {
        return json({ error: 'method_not_allowed' }, 405, corsHeaders)
      }

      if (!env.ANALYTICS_DB) {
        return json({ error: 'unavailable' }, 500, corsHeaders)
      }

      const body = (await request.json().catch(() => ({}))) as {
        rating?: number
        sessionId?: string
      }
      const sessionId = typeof body.sessionId === 'string' ? body.sessionId : ''
      const rating = Number(body.rating)
      const isValidRating =
        Number.isFinite(rating) &&
        rating >= 0.5 &&
        rating <= 5 &&
        Math.round(rating * 2) === rating * 2

      if (!/^[a-zA-Z0-9-]{8,64}$/.test(sessionId) || !isValidRating) {
        return json({ error: 'invalid_rating' }, 400, corsHeaders)
      }

      await env.ANALYTICS_DB.prepare(
        `INSERT INTO ratings (session_id, rating, ts) VALUES (?, ?, ?)
         ON CONFLICT(session_id) DO UPDATE SET rating = excluded.rating, ts = excluded.ts`,
      )
        .bind(sessionId, rating, Date.now())
        .run()

      return json({ ok: true }, 200, corsHeaders)
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

      // 權威狀態路徑：每個 session 一個 Durable Object，狀態活在 server。
      if (body.sessionId && env.KEEPER_SESSION) {
        const stub = env.KEEPER_SESSION.get(
          env.KEEPER_SESSION.idFromName(body.sessionId),
        )
        const doResponse = await stub.fetch('https://keeper-session/turn', {
          body: JSON.stringify(body),
          headers: { 'Content-Type': 'application/json' },
          method: 'POST',
        })
        const payload = await doResponse.text()

        return new Response(payload, {
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
            ...corsHeaders,
          },
          status: doResponse.status,
        })
      }

      // 無 sessionId 的備援路徑：無狀態回合（信任 client 傳來的 state）。
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

// Durable Object 與無狀態路徑共用的 waitUntil 介面。
type CtxLike = {
  waitUntil(promise: Promise<unknown>): void
}

async function handleKeeperTurn(
  body: KeeperRequestBody,
  env: Env,
  corsHeaders: Record<string, string>,
  ctx: ExecutionContext,
): Promise<Response> {
  const turn = await executeKeeperTurn(body, env, ctx)

  if ('error' in turn) {
    return json(turn, 400, corsHeaders)
  }

  return json(turn.validated, 200, corsHeaders)
}

// 回合管線本體：清洗後的 body 進、驗證後的權威回應出。
// 由無狀態路徑與 KeeperSession Durable Object 共用。
export async function executeKeeperTurn(
  body: KeeperRequestBody,
  env: Env,
  ctx: CtxLike,
): Promise<
  | { error: string; message: string }
  | { sceneId: string; validated: KeeperResponse }
> {
  const sceneId = body.sceneId ?? body.state?.currentSceneId ?? '001_apartment_entrance'
  const playerAction = body.playerAction ?? ''
  const scene = scenes[sceneId]

  if (!scene) {
    return {
      error: 'unknown_scene',
      message: `Unknown sceneId: ${sceneId}`,
    }
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
  // 四樓押送節奏：見證者熟成度＋在場回合數決定召喚與押送時機。
  const escortPacing = processEscortPacing(
    sceneId,
    playerAction,
    body.selectedAction,
    body.state,
  )

  // 依序嘗試各處理層，並記錄回應來源與模型延遲（供遊玩事件記錄）。
  let turnSource: TurnSource = 'scripted'
  let latencyMs = 0
  let response: KeeperResponse | undefined =
    ritualPacing?.preempt ??
    doorPhase?.preempt ??
    // 玩家躲藏期間的封閉狀態機（阿陽已持鑰匙進門、玩家尚未現身／被找到）。
    processOfficerHiddenPhase(playerAction, body.selectedAction, body.state) ??
    // 召喚與押送搶佔（熟成或硬上限到時）。
    escortPacing?.preempt ??
    // 阿陽登場條件成立時搶佔本回合行動（跨過第二個不可逆門檻）。
    handleOfficerArrival(
      sceneId,
      playerAction,
      body.selectedAction,
      body.state,
      body.turnIndex,
    )

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

  let turnModel: string | null = null

  if (!response) {
    const startedAt = Date.now()
    const modelTurn = await runModelTurn(body, sceneId, playerAction, env)
    latencyMs = Date.now() - startedAt
    response = modelTurn.response
    turnSource = modelTurn.source
    turnModel = modelTurn.model
  }

  // 對阿陽動手：記錄攻擊旗標（BGM 緊張切換與後續對峙敘事的依據）。
  const attacksOfficer =
    isOfficerPresent(body.state) &&
    body.state?.flags?.player_attacked_officer !== true &&
    attackOfficerPattern.test(
      `${body.selectedAction?.label ?? ''}\n${playerAction}`,
    )

  const markFlags = {
    ...doorPhase?.markFlags,
    ...ritualPacing?.markFlags,
    ...escortPacing?.markFlags,
    ...(attacksOfficer ? { player_attacked_officer: true } : {}),
  }

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

  // 玩家走向大門與阿陽互動：大門在客廳，場景強制切到客廳，
  // 避免敘事已在門邊、畫面卻停在臥室等房間的錯位。
  if (doorPhase?.forceSceneId) {
    response = {
      ...response,
      effects: {
        ...response.effects,
        nextSceneId: doorPhase.forceSceneId,
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

  response = applyHpZeroEnding(response, body.state)

  const validated = validateKeeperResponse(response, sceneId, body.state)

  logTurnEvent(env, ctx, {
    beliefStage: beliefUpdate.stage,
    body,
    latencyMs,
    model: turnModel,
    response: validated,
    sceneId,
    source: turnSource,
  })

  return { sceneId, validated }
}

async function runModelTurn(
  body: KeeperRequestBody,
  sceneId: string,
  playerAction: string,
  env: Env,
): Promise<{ model: string; response: KeeperResponse; source: TurnSource }> {
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
  // 供應商切換（實驗）：Ollama 模式下所有模型回合走本機模型，
  // 失敗（連線、逾時、解析）自動退回 Gemini，遊戲不中斷。
  // KV 執行期設定優先於 wrangler var（/admin 可免部署切換）。
  const runtimeConfig = await readRuntimeConfig(env)
  const effectiveProvider = runtimeConfig.provider ?? env.KEEPER_PROVIDER
  let modelResponse: KeeperResponse | undefined
  let usedModel: string
  // Gemini 重試耗盡後仍是 429：額度或頻率限制用盡，回合降級為罐頭敘事時
  // 額外附上一句 OOC 提示，與其他連線層失敗（逾時、地區封鎖）區分。
  let quotaExhausted = false

  if (effectiveProvider === 'ollama' && env.OLLAMA_URL) {
    const ollamaResult = await callOllamaKeeper(env, prompt, runtimeConfig.ollamaModel)
    modelResponse = ollamaResult.response
    usedModel = ollamaResult.modelUsed

    if (!modelResponse) {
      console.error('ollama_fallback_to_gemini')
      const geminiResult = await callGeminiKeeper(env, prompt, geminiModel)
      modelResponse = geminiResult.response
      usedModel = geminiResult.modelUsed
      quotaExhausted = geminiResult.quotaExhausted === true
    }
  } else {
    // 混合路由：五樓與強制高潮回合是玩家記憶最深的段落，
    // 改用高階模型拉高敘事品質；其餘回合維持低延遲低成本的預設模型。
    const isClimaxTurn =
      sceneId === '007_landlord_apartment' ||
      body.state?.flags?.ritual_forced_climax === true
    const model =
      isClimaxTurn && env.GEMINI_CLIMAX_MODEL ? env.GEMINI_CLIMAX_MODEL : geminiModel
    const geminiResult = await callGeminiKeeper(env, prompt, model)
    modelResponse = geminiResult.response
    usedModel = geminiResult.modelUsed
    quotaExhausted = geminiResult.quotaExhausted === true
  }

  // SAN 與時間完全 server 權威：模型只能透過 effects.sanityCheck 申報事件，
  // 裸 sanityDelta 與 timeCostMinutes 一律剝除。
  if (
    modelResponse?.effects?.sanityDelta !== undefined ||
    modelResponse?.effects?.timeCostMinutes !== undefined
  ) {
    const {
      sanityDelta: _droppedDelta,
      timeCostMinutes: _droppedTime,
      ...effects
    } = modelResponse.effects ?? {}
    modelResponse = { ...modelResponse, effects }
  }
  const source: TurnSource = modelResponse ? 'model' : 'fallback'
  const baseResponse =
    modelResponse ??
    createKeeperFallbackResponse(
      sceneId,
      playerAction,
      sceneFallbackNarration,
      genericFallbackNarration,
      quotaExhausted,
    )
  const constrainedResponse = enforceDiscoveryConstraints(
    removeRepeatedActions(baseResponse, body.history),
    sceneId,
    playerAction,
    body.state,
  )

  return {
    model: usedModel,
    response: ensureAvailableActions(
      constrainedResponse,
      sceneId,
      playerAction,
      body.state,
    ),
    source,
  }
}

// HP 歸零＝角色死亡：強制走「兩具無名屍體」結局（ending_buried_together 的
// 第二條進入路徑）。實務上只有與阿陽或信徒的肢體衝突會累積到這裡。
export function applyHpZeroEnding(
  response: KeeperResponse,
  state?: KeeperWireState,
): KeeperResponse {
  const currentHp = state?.hitPoints?.current

  if (typeof currentHp !== 'number') {
    return response
  }

  const delta = Math.max(-10, Math.min(0, response.effects?.hitPointDelta ?? 0))

  if (currentHp + delta > 0) {
    return response
  }

  const disordered = isWireStateDisordered(state)
  const deathNarration = disordered
    ? [
        '疼痛忽然停了。不是好轉——是你跟身體之間的線被剪斷了。你從很高的地方看著自己倒下去，看著那個穿制服的形狀低頭俯視，看著房間的光像退潮一樣從四周撤走。',
        '最後留在你耳裡的是水聲。很深、很靜的水。然後連水聲也沒有了。',
      ]
    : [
        '你的膝蓋先失去力氣，然後是視野——房間傾斜、變窄、暗下來。你聽見有人在很遠的地方說了一句什麼，語氣平穩，像在報告一件例行公事。',
        '意識沉下去之前，你最後想到的是阿宏。你們最後會在同一個地方被找到——或者，永遠不會被找到。',
      ]

  return {
    ...response,
    effects: {
      ...response.effects,
      endingId: 'ending_buried_together',
    },
    narration: [...response.narration, ...deathNarration],
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
