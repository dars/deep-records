import {
  normalizeActions,
  normalizeBeliefUpdate,
  normalizeChecks,
  normalizeEffects,
  normalizeNarration,
  normalizeObservation,
  type KeeperCheckResult,
  type KeeperRequestBody,
  type KeeperResponse,
  type TurnHistoryEntry,
} from '../../../shared/keeper'
import type { ActionOption, InvestigationState } from '../../types/investigation'

export type { KeeperCheck, KeeperCheckResult, KeeperResponse } from '../../../shared/keeper'

// 正式環境與 worker 同源（Workers Assets），使用相對路徑；
// 本地 vite dev 由 proxy 轉給 wrangler dev。需要覆寫時設定 VITE_KEEPER_ENDPOINT。
const keeperEndpoint: string =
  import.meta.env.VITE_KEEPER_ENDPOINT ?? '/api/keeper'

const ttsEndpoint: string = keeperEndpoint.replace(/\/keeper$/, '/tts')

// 向 worker 請求敘事語音（ElevenLabs 代理）；失敗時拋錯讓呼叫端退回 Web Speech。
export async function requestNarrationAudio(
  text: string,
  signal?: AbortSignal,
): Promise<Blob> {
  const response = await fetch(ttsEndpoint, {
    body: JSON.stringify({ text }),
    headers: {
      'Content-Type': 'application/json',
    },
    method: 'POST',
    signal,
  })

  if (!response.ok) {
    throw new Error(`tts_${response.status}`)
  }

  return await response.blob()
}

export async function requestKeeperTurn(
  playerAction: string,
  options: {
    checkResults?: KeeperCheckResult[]
    history?: TurnHistoryEntry[]
    investigationState: InvestigationState
    sceneId?: string
    selectedAction?: ActionOption
  },
): Promise<KeeperResponse> {
  const investigationState = options.investigationState
  const requestBody: KeeperRequestBody = {
    character: {
      attributes: Object.fromEntries(
        investigationState.investigator.attributes.map(([label, value]) => [
          label,
          Number(value),
        ]),
      ),
      occupation: investigationState.investigator.occupationId,
    },
    checkResults: options.checkResults,
    history: options.history,
    playerAction,
    sceneId: options.sceneId ?? investigationState.currentSceneId,
    selectedAction: options.selectedAction,
    state: investigationState,
  }

  const response = await fetch(keeperEndpoint, {
    body: JSON.stringify(requestBody),
    headers: {
      'Content-Type': 'application/json',
    },
    method: 'POST',
  })

  const data = (await response.json()) as Record<string, unknown>

  if (!response.ok) {
    const message =
      typeof data?.message === 'string' ? data.message : '守密人暫時沒有回應。'
    throw new Error(message)
  }

  return {
    actions: normalizeActions(data.actions),
    belief: normalizeBeliefUpdate(data.belief),
    checks: normalizeChecks(data.checks),
    effects: normalizeEffects(data.effects),
    narration: normalizeNarration(data.narration),
    observation: normalizeObservation(data.observation),
  }
}
