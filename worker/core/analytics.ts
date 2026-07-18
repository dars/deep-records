// 遊玩事件記錄：每回合一列寫入 D1（ctx.waitUntil 非同步，不影響回應延遲）。
// 隱私原則：只記匿名 session id 與遊戲內狀態，不記玩家姓名與 IP。
import type { KeeperRequestBody, KeeperResponse } from '../../shared/keeper'

export type TurnSource =
  | 'deterministic'
  | 'fallback'
  | 'model'
  | 'scripted'
  | 'transition'

type AnalyticsEnv = {
  ANALYTICS_DB?: D1Database
}

const systemActionPatterns = [
  /^開始楔子/,
  /^進入 001_apartment_entrance/,
  /^依據本次擲骰結果/,
]

function deriveActionKind(body: KeeperRequestBody): string {
  if (body.checkResults && body.checkResults.length > 0) {
    return 'check_result'
  }

  if (body.selectedAction) {
    return 'option'
  }

  const playerAction = body.playerAction ?? ''

  if (systemActionPatterns.some((pattern) => pattern.test(playerAction))) {
    return 'system'
  }

  return 'free_text'
}

export function logTurnEvent(
  env: AnalyticsEnv,
  ctx: ExecutionContext,
  input: {
    beliefStage: string
    body: KeeperRequestBody
    latencyMs: number
    model: string | null
    response: KeeperResponse
    sceneId: string
    source: TurnSource
  },
) {
  if (!env.ANALYTICS_DB || !input.body.sessionId) {
    return
  }

  const { body, response } = input
  const sanity =
    typeof body.state?.sanity === 'number'
      ? body.state.sanity
      : (body.state?.sanity?.current ?? null)

  const write = env.ANALYTICS_DB.prepare(
    `INSERT INTO turn_events
      (session_id, turn_index, ts, scene_id, action_kind, player_action,
       selected_action_id, turn_source, belief_stage, sanity, ending_id,
       latency_ms, occupation, model)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      body.sessionId,
      body.turnIndex ?? 0,
      Date.now(),
      input.sceneId,
      deriveActionKind(body),
      body.playerAction ?? '',
      body.selectedAction?.id ?? null,
      input.source,
      input.beliefStage,
      sanity,
      response.effects?.endingId ?? null,
      input.latencyMs,
      body.character?.occupation ?? null,
      input.model,
    )
    .run()
    .catch((error: unknown) => {
      console.error(
        'analytics_write_failed',
        error instanceof Error ? error.message : error,
      )
    })

  ctx.waitUntil(write)
}
