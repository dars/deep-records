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

const actionBeliefSignals = [
  'none',
  'rational_investigation',
  'withhold_judgment',
  'test_myth',
  'rely_on_myth',
  'accept_myth_cost',
]

const observationBeliefSignals = [
  'none',
  'rational_investigation',
  'withhold_judgment',
  'propose_myth',
  'test_myth',
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
        sanityDelta: { type: 'INTEGER' },
        hitPointDelta: { type: 'INTEGER' },
        addInventory: { type: 'ARRAY', items: { type: 'STRING' } },
        removeInventory: { type: 'ARRAY', items: { type: 'STRING' } },
        discoverClues: { type: 'ARRAY', items: { type: 'STRING' } },
        endingId: { type: 'STRING' },
        endingTitle: { type: 'STRING' },
        setFlags: { type: 'ARRAY', items: { type: 'STRING' } },
        testedMythRuleId: { type: 'STRING' },
        verifiedMythRuleId: { type: 'STRING' },
        nextSceneId: { type: 'STRING' },
      },
    },
  },
  required: ['narration', 'actions', 'checks'],
}

type GeminiEnv = {
  GEMINI_API_KEY: string
}

export async function callGeminiKeeper(
  env: GeminiEnv,
  prompt: string,
): Promise<KeeperResponse | undefined> {
  // 解析失敗時重新取樣一次（截斷或格式錯誤通常是偶發），仍失敗才交給 fallback。
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const text = await generateGeminiText(env, prompt)

    try {
      const parsed = parseKeeperJson(text)

      return {
        actions: normalizeActions(parsed.actions),
        checks: normalizeChecks(parsed.checks),
        effects: normalizeEffects(parsed.effects),
        narration: normalizeNarration(parsed.narration).map(completeAbruptNarration),
        observation: normalizeObservation(parsed.observation),
      }
    } catch {
      console.error(
        'keeper_json_parse_failed',
        `attempt=${attempt + 1}`,
        text.slice(0, 300),
      )
    }
  }

  return undefined
}

async function generateGeminiText(env: GeminiEnv, prompt: string) {
  const requestBody = JSON.stringify({
    contents: [
      {
        parts: [{ text: prompt }],
        role: 'user',
      },
    ],
    generationConfig: {
      // 需要足夠餘裕容納模型的 thinking token 與完整 JSON，太低會導致輸出被截斷。
      maxOutputTokens: 8192,
      responseMimeType: 'application/json',
      responseSchema: keeperResponseSchema,
      temperature: 0.8,
    },
  })

  let lastError: Error | undefined

  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (attempt > 0) {
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs))
    }

    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent`,
        {
          body: requestBody,
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
        lastError = new Error(`Gemini HTTP ${response.status}: ${errorBody.slice(0, 500)}`)

        if (retryableStatuses.has(response.status)) {
          continue
        }

        throw lastError
      }

      const data = await response.json<Record<string, unknown>>()

      return extractGeminiText(data)
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
