// Gemini API 呼叫：金鑰走 header、45 秒 timeout、429/5xx 重試一次、
// 以 responseSchema 強制輸出符合 Keeper 協定的 JSON。
import {
  normalizeActions,
  normalizeChecks,
  normalizeEffects,
  normalizeNarration,
  normalizeObservation,
  type KeeperResponse,
} from '../../shared/keeper'
import { completeAbruptNarration } from './narration'

export const geminiModel = 'gemini-3.5-flash'

const requestTimeoutMs = 45_000
const retryDelayMs = 700
const retryableStatuses = new Set([429, 500, 502, 503])

export const actionBeliefSignals = [
  'none',
  'rational_investigation',
  'withhold_judgment',
  'test_myth',
  'rely_on_myth',
  'accept_myth_cost',
]

export const observationBeliefSignals = [
  'none',
  'rational_investigation',
  'withhold_judgment',
  'propose_myth',
  'test_myth',
  'rely_on_myth',
  'rely_on_verified_myth',
  'accept_myth_cost',
]

const keeperResponseSchema = {
  type: 'OBJECT',
  properties: {
    narration: { type: 'ARRAY', items: { type: 'STRING' } },
    actions: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          id: { type: 'STRING' },
          label: { type: 'STRING' },
          beliefSignal: { type: 'STRING', enum: actionBeliefSignals },
          mythRuleId: { type: 'STRING' },
          intent: {
            type: 'OBJECT',
            properties: {
              type: {
                type: 'STRING',
                enum: ['move', 'leave', 'call_police', 'none'],
              },
              to: { type: 'STRING' },
            },
            required: ['type'],
          },
        },
        required: ['id', 'label'],
      },
    },
    checks: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          attribute: { type: 'STRING' },
          difficulty: { type: 'INTEGER' },
          reason: { type: 'STRING' },
        },
        required: ['attribute', 'difficulty', 'reason'],
      },
    },
    observation: {
      type: 'OBJECT',
      properties: {
        signal: { type: 'STRING', enum: observationBeliefSignals },
        mythRuleId: { type: 'STRING' },
        reason: { type: 'STRING' },
      },
      required: ['signal'],
    },
    effects: {
      type: 'OBJECT',
      properties: {
        // 必填 + sentinel（none/none）：選填巢狀物件在 structured output
        // 下常被模型一律省略，必填能強迫它每回合明確判斷 SAN 事件。
        sanityCheck: {
          type: 'OBJECT',
          properties: {
            spec: { type: 'STRING' },
            eventFlag: { type: 'STRING' },
          },
          required: ['spec', 'eventFlag'],
        },
        hitPointDelta: { type: 'INTEGER' },
        addInventory: { type: 'ARRAY', items: { type: 'STRING' } },
        removeInventory: { type: 'ARRAY', items: { type: 'STRING' } },
        discoverClues: { type: 'ARRAY', items: { type: 'STRING' } },
        endingId: { type: 'STRING' },
        endingTitle: { type: 'STRING' },
        setFlags: { type: 'ARRAY', items: { type: 'STRING' } },
        clearFlags: { type: 'ARRAY', items: { type: 'STRING' } },
        testedMythRuleId: { type: 'STRING' },
        verifiedMythRuleId: { type: 'STRING' },
        nextSceneId: { type: 'STRING' },
      },
      required: ['sanityCheck'],
    },
  },
  required: ['narration', 'actions', 'checks', 'effects'],
}

type GeminiEnv = {
  GEMINI_API_KEY: string
}

// 帶狀態碼的錯誤，讓上層能分辨「額度／頻率耗盡」跟其他連線層失敗。
export class GeminiHttpError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export type GeminiKeeperResult = {
  // 實際完成呼叫的模型（指定模型不存在時保險絲會退回預設模型）。
  modelUsed: string
  response: KeeperResponse | undefined
  // 重試耗盡後仍是 429（RESOURCE_EXHAUSTED）：額度或頻率限制用盡，
  // 與其他連線層失敗（逾時、5xx、地區封鎖）分開標記。
  quotaExhausted?: boolean
}

export async function callGeminiKeeper(
  env: GeminiEnv,
  prompt: string,
  model: string = geminiModel,
): Promise<GeminiKeeperResult> {
  let modelUsed = model

  // 解析失敗時重新取樣一次（截斷或格式錯誤通常是偶發），仍失敗才交給 fallback。
  // 連線層錯誤（重試耗盡、逾時）也不外拋——回 undefined 讓回合降級成
  // 罐頭敘事，玩家看到的是遊戲內文字而不是錯誤畫面。
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let generated: { modelUsed: string; text: string }

    try {
      generated = await generateGeminiText(env, prompt, model)
    } catch (error) {
      console.error(
        'keeper_model_unreachable',
        error instanceof Error ? error.message : error,
      )
      return {
        modelUsed,
        quotaExhausted: error instanceof GeminiHttpError && error.status === 429,
        response: undefined,
      }
    }

    modelUsed = generated.modelUsed

    try {
      const parsed = parseKeeperJson(generated.text)

      return {
        modelUsed,
        response: {
          actions: normalizeActions(parsed.actions),
          checks: normalizeChecks(parsed.checks),
          effects: normalizeEffects(parsed.effects),
          narration: normalizeNarration(parsed.narration).map(completeAbruptNarration),
          observation: normalizeObservation(parsed.observation),
        },
      }
    } catch {
      console.error(
        'keeper_json_parse_failed',
        `attempt=${attempt + 1}`,
        generated.text.slice(0, 300),
      )
    }
  }

  return { modelUsed, response: undefined }
}

// 限制模型思考深度是延遲的最大槓桿：守密人回合以格式化與敘事為主，
// 不需要深度推理。不同 Gemini 世代的欄位不同，遇到 400 時自動降級：
// thinkingLevel（Gemini 3 系列）→ thinkingBudget（2.5 系列）→ 不帶參數。
type ThinkingMode = 'level' | 'budget' | 'none'

// 混合路由下不同模型可能支援不同的 thinking 欄位，降級狀態逐模型記錄。
const thinkingModes = new Map<string, ThinkingMode>()

function getThinkingMode(model: string): ThinkingMode {
  return thinkingModes.get(model) ?? 'level'
}

function downgradeThinkingMode(model: string): boolean {
  const current = getThinkingMode(model)

  if (current === 'level') {
    thinkingModes.set(model, 'budget')
    return true
  }

  if (current === 'budget') {
    thinkingModes.set(model, 'none')
    return true
  }

  return false
}

function buildRequestBody(prompt: string, model: string) {
  const thinkingMode = getThinkingMode(model)
  const thinkingConfig =
    thinkingMode === 'level'
      ? { thinkingLevel: 'low' }
      : thinkingMode === 'budget'
        ? { thinkingBudget: 0 }
        : undefined

  return JSON.stringify({
    contents: [
      {
        parts: [{ text: prompt }],
        role: 'user',
      },
    ],
    generationConfig: {
      // 需要足夠餘裕容納完整 JSON 與殘餘 thinking token，太低會導致輸出被截斷。
      maxOutputTokens: 8192,
      responseMimeType: 'application/json',
      responseSchema: keeperResponseSchema,
      temperature: 0.8,
      ...(thinkingConfig ? { thinkingConfig } : {}),
    },
  })
}

async function generateGeminiText(
  env: GeminiEnv,
  prompt: string,
  model: string,
): Promise<{ modelUsed: string; text: string }> {
  let lastError: Error | undefined
  let attempts = 0
  let locationRetries = 0
  let activeModel = model
  // 一般錯誤最多重試一次；thinkingConfig 欄位不相容的降級重試另計（最多兩次）；
  // 出口地區被拒的重試另計（最多四次，每次換出口 IP 的機會）。
  const maxLocationRetries = 6
  const maxAttempts = 2 + 2 + maxLocationRetries

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (attempts >= 2) {
      break
    }

    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${activeModel}:generateContent`,
        {
          body: buildRequestBody(prompt, activeModel),
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': env.GEMINI_API_KEY,
          },
          method: 'POST',
          signal: AbortSignal.timeout(requestTimeoutMs),
        },
      )

      if (!response.ok) {
        const errorBody = await response.text()

        if (
          response.status === 400 &&
          /thinking/i.test(errorBody) &&
          downgradeThinkingMode(activeModel)
        ) {
          console.error(
            'keeper_thinking_mode_downgraded',
            activeModel,
            getThinkingMode(activeModel),
          )
          continue
        }

        // 混合路由的保險絲：指定的高階模型不存在時退回預設模型，
        // 不中斷遊戲回合。
        if (
          activeModel !== geminiModel &&
          (response.status === 404 ||
            /not found|model.*is not supported/i.test(errorBody))
        ) {
          console.error('keeper_climax_model_unavailable', activeModel)
          activeModel = geminiModel
          continue
        }

        // Cloudflare 出口 IP 偶爾落在 Gemini 不支援的地區（IP 池輪替，
        // 時好時壞）：這類 400 視為可重試，換一次出口通常就過。
        if (
          response.status === 400 &&
          /location is not supported/i.test(errorBody) &&
          locationRetries < maxLocationRetries
        ) {
          locationRetries += 1
          console.error('keeper_gemini_location_retry', locationRetries)
          await new Promise((resolve) => setTimeout(resolve, 250))
          continue
        }

        lastError = new GeminiHttpError(
          response.status,
          `Gemini HTTP ${response.status}: ${errorBody.slice(0, 500)}`,
        )

        if (retryableStatuses.has(response.status)) {
          attempts += 1
          await new Promise((resolve) => setTimeout(resolve, retryDelayMs))
          continue
        }

        throw lastError
      }

      const data = await response.json<Record<string, unknown>>()

      return { modelUsed: activeModel, text: extractGeminiText(data) }
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))

      const isAbortOrNetwork =
        lastError.name === 'TimeoutError' ||
        lastError.name === 'AbortError' ||
        lastError.message.includes('Network') ||
        lastError.message.startsWith('Gemini HTTP')

      if (!isAbortOrNetwork) {
        throw lastError
      }

      attempts += 1
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs))
    }
  }

  throw lastError ?? new Error('Gemini request failed')
}

function extractGeminiText(data: Record<string, unknown>) {
  const candidates = data.candidates

  if (!Array.isArray(candidates)) {
    throw new Error('Gemini response missing candidates')
  }

  const firstCandidate = candidates[0] as
    | {
        content?: {
          parts?: Array<{ text?: string }>
        }
        finishReason?: string
      }
    | undefined

  if (firstCandidate?.finishReason && firstCandidate.finishReason !== 'STOP') {
    console.error('keeper_gemini_finish_reason', firstCandidate.finishReason)
  }

  const text = firstCandidate?.content?.parts
    ?.map((part) => part.text ?? '')
    .join('')

  if (!text) {
    throw new Error('Gemini response missing text')
  }

  return text
}

export function parseKeeperJson(text: string): Record<string, unknown> {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/i, '')
    .trim()

  try {
    return JSON.parse(cleaned) as Record<string, unknown>
  } catch {
    const start = cleaned.indexOf('{')
    const end = findFirstJsonObjectEnd(cleaned, start)

    if (start >= 0 && end > start) {
      return JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>
    }

    throw new Error(`Gemini response is not valid JSON: ${cleaned.slice(0, 500)}`)
  }
}

function findFirstJsonObjectEnd(text: string, start: number) {
  if (start < 0) {
    return -1
  }

  let depth = 0
  let isEscaped = false
  let isInsideString = false

  for (let index = start; index < text.length; index += 1) {
    const char = text[index]

    if (isInsideString) {
      if (isEscaped) {
        isEscaped = false
      } else if (char === '\\') {
        isEscaped = true
      } else if (char === '"') {
        isInsideString = false
      }

      continue
    }

    if (char === '"') {
      isInsideString = true
    } else if (char === '{') {
      depth += 1
    } else if (char === '}') {
      depth -= 1

      if (depth === 0) {
        return index
      }
    }
  }

  return -1
}
