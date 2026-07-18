// 每場遊戲一個 Durable Object：權威遊戲狀態活在 server。
// client 每回合只送玩家行動；DO 以儲存的 canonical state 執行回合管線、
// 套用共享 reducer、持久化後回傳完整快照。client 傳來的 state 只在
// 首回合播種時使用（舊存檔遷移路徑），之後一律以 server 為準——防篡改。
import type { KeeperRequestBody } from '../shared/keeper'
import {
  applyTurnEffects,
  canonicalFromWireState,
  type CanonicalGameState,
} from '../shared/state'
import { executeKeeperTurn, type Env } from './keeper'

const stateKey = 'state'

export class KeeperSession {
  private state: DurableObjectState
  private env: Env

  constructor(state: DurableObjectState, env: Env) {
    this.state = state
    this.env = env
  }

  async fetch(request: Request): Promise<Response> {
    let body: KeeperRequestBody

    try {
      body = (await request.json()) as KeeperRequestBody
    } catch {
      return Response.json({ error: 'invalid_body' }, { status: 400 })
    }

    const stored = await this.state.storage.get<CanonicalGameState>(stateKey)
    // 已有結局的會期不再接受回合（重玩必須開新 sessionId）。
    if (stored?.ending) {
      return Response.json(
        { error: 'session_ended', message: '這場調查已經結束。' },
        { status: 409 },
      )
    }

    const seeded = stored ?? canonicalFromWireState(body.state)
    // 楔子出口是前端驅動的固定轉換（resolveRequestSceneId 的特例）：
    // 這是唯一允許 client 主張場景的情況，其餘一律以 server 為準。
    const claimsPrologueExit =
      seeded.currentSceneId === '000_prologue' &&
      body.sceneId === '001_apartment_entrance'
    const canonical = claimsPrologueExit
      ? { ...seeded, currentSceneId: '001_apartment_entrance' }
      : seeded
    // 場景與狀態以 server 為準：client 傳來的 sceneId/state 只在播種時有效。
    const effectiveBody: KeeperRequestBody = {
      ...body,
      sceneId: canonical.currentSceneId,
      state: canonical,
    }

    let turn
    try {
      turn = await executeKeeperTurn(effectiveBody, this.env, this.state)
    } catch (error) {
      console.error(
        'session_turn_failed',
        error instanceof Error ? error.message : error,
      )
      return Response.json(
        { error: 'keeper_failed', message: '守密人暫時沒有回應，請稍後再試。' },
        { status: 500 },
      )
    }

    if ('error' in turn) {
      return Response.json(turn, { status: 400 })
    }

    const nextState = applyTurnEffects(
      canonical,
      turn.validated.observation,
      turn.validated.effects,
      turn.validated.belief,
      turn.sceneId,
    )
    await this.state.storage.put(stateKey, nextState)

    return Response.json({ ...turn.validated, state: nextState })
  }
}
