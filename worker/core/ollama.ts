// Ollama 供應商（實驗機制）：經 Cloudflare tunnel 打回本機／內網的 Ollama，
// 用 /api/chat 的 JSON Schema 結構化輸出跑守密人回合。
// 串接規格沿用 alignment_compass：stream:false、think:false、format=<schema>、
// 選配 CF Access service token（tunnel 有 Access 保護時才需要）。
// 注意延遲：gemma4:12b 短 prompt 實測 ~51s、e2b ~17s，實戰回合更久——
// 這是實驗開關，不是產線預設；失敗時自動退回 Gemini。
import {
  normalizeActions,
  normalizeChecks,
  normalizeEffects,
  normalizeNarration,
  normalizeObservation,
  type KeeperResponse,
} from '../../shared/keeper'
import { actionBeliefSignals, observationBeliefSignals } from './gemini'

// 與 gemini.ts 的 responseSchema 對應的標準 JSON Schema 版本。
export const ollamaKeeperSchema = {
  type: 'object',
  properties: {
    narration: { type: 'array', items: { type: 'string' } },
    actions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          label: { type: 'string' },
          beliefSignal: { type: 'string', enum: actionBeliefSignals },
          intent: {
            type: 'object',
            properties: {
              type: { type: 'string', enum: ['move', 'leave', 'call_police'] },
              to: { type: 'string' },
            },
            required: ['type'],
          },
        },
        required: ['id', 'label'],
      },
    },
    checks: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          attribute: { type: 'string' },
          difficulty: { type: 'integer' },
          reason: { type: 'string' },
        },
        required: ['attribute', 'difficulty', 'reason'],
      },
    },
    observation: {
      type: 'object',
      properties: {
        signal: { type: 'string', enum: observationBeliefSignals },
        mythRuleId: { type: 'string' },
        reason: { type: 'string' },
      },
      required: ['signal'],
    },
    effects: {
      type: 'object',
      properties: {
        sanityCheck: {
          type: 'object',
          properties: {
            spec: { type: 'string' },
            eventFlag: { type: 'string' },
          },
          required: ['spec', 'eventFlag'],
        },
        hitPointDelta: { type: 'integer' },
        addInventory: { type: 'array', items: { type: 'string' } },
        removeInventory: { type: 'array', items: { type: 'string' } },
        discoverClues: { type: 'array', items: { type: 'string' } },
        endingId: { type: 'string' },
        endingTitle: { type: 'string' },
        setFlags: { type: 'array', items: { type: 'string' } },
        clearFlags: { type: 'array', items: { type: 'string' } },
        testedMythRuleId: { type: 'string' },
        verifiedMythRuleId: { type: 'string' },
        nextSceneId: { type: 'string' },
      },
      required: ['sanityCheck'],
    },
  },
  required: ['narration', 'actions', 'checks', 'effects'],
} as const

export type OllamaEnv = {
  CF_ACCESS_CLIENT_ID?: string
  CF_ACCESS_CLIENT_SECRET?: string
  OLLAMA_MODEL?: string
  OLLAMA_TIMEOUT_MS?: string
  OLLAMA_URL?: string
}

export type OllamaKeeperResult = {
  modelUsed: string
  response: KeeperResponse | undefined
}

const defaultTimeoutMs = 90_000

export async function callOllamaKeeper(
  env: OllamaEnv,
  prompt: string,
): Promise<OllamaKeeperResult> {
  const model = env.OLLAMA_MODEL ?? 'gemma4:12b'
  const modelUsed = `ollama/${model}`

  if (!env.OLLAMA_URL) {
    return { modelUsed, response: undefined }
  }

  const timeoutMs = Number(env.OLLAMA_TIMEOUT_MS) || defaultTimeoutMs
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }

  if (env.CF_ACCESS_CLIENT_ID && env.CF_ACCESS_CLIENT_SECRET) {
    headers['CF-Access-Client-Id'] = env.CF_ACCESS_CLIENT_ID
    headers['CF-Access-Client-Secret'] = env.CF_ACCESS_CLIENT_SECRET
  }

  // 本地模型太慢，不做重取樣；單次失敗直接交還呼叫端退回 Gemini。
  try {
    const response = await fetch(env.OLLAMA_URL, {
      body: JSON.stringify({
        format: ollamaKeeperSchema,
        messages: [{ content: prompt, role: 'user' }],
        model,
        options: { temperature: 0.8, top_k: 40, top_p: 0.9 },
        stream: false,
        think: false,
      }),
      headers,
      method: 'POST',
      signal: AbortSignal.timeout(timeoutMs),
    })

    if (!response.ok) {
      const errorBody = await response.text()
      console.error('ollama_http_error', response.status, errorBody.slice(0, 300))
      return { modelUsed, response: undefined }
    }

    const data = await response.json<{ error?: string; message?: { content?: string } }>()

    if (data.error || !data.message?.content) {
      console.error('ollama_bad_payload', data.error ?? 'empty content')
      return { modelUsed, response: undefined }
    }

    // 小模型偶爾包 code fence，寬鬆剝除。
    const trimmed = data.message.content
      .trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/```\s*$/, '')
    const parsed = JSON.parse(trimmed) as Record<string, unknown>

    return {
      modelUsed,
      response: {
        actions: normalizeActions(parsed.actions),
        checks: normalizeChecks(parsed.checks),
        effects: normalizeEffects(parsed.effects),
        narration: normalizeNarration(parsed.narration),
        observation: normalizeObservation(parsed.observation),
      },
    }
  } catch (error) {
    console.error(
      'ollama_call_failed',
      error instanceof Error ? error.message : error,
    )
    return { modelUsed, response: undefined }
  }
}
