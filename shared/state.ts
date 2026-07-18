// 權威遊戲狀態與回合 reducer：前端與 worker（Durable Object）共用同一份實作，
// 保證兩側 reduce 永遠一致。investigator 個人資料屬於前端呈現層，不在此範圍。
import type {
  BeliefObservation,
  BeliefStage,
  BeliefUpdate,
  InvestigationEffects,
  KeeperWireState,
} from './keeper'

export type CanonicalBelief = {
  evidence: string[]
  signalLog: string[]
  stage: BeliefStage
  testedMythRules: string[]
  verifiedMythRules: string[]
}

// 遊戲時鐘：7月15日深夜 01:17 開始，每回合前進 4 分鐘。
// 時間是劇情推進的觸發器之一（阿陽的到場時刻、儀式死線）。
export const gameClockStartMinutes = 1 * 60 + 17
export const gameClockStepMinutes = 4

export function formatGameClock(clockMinutes: number): string {
  const hours = Math.floor(clockMinutes / 60) % 24
  const minutes = clockMinutes % 60
  const period = hours >= 3 && hours < 6 ? '凌晨' : '深夜'

  return `${period} ${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
}

export type CanonicalGameState = {
  belief: CanonicalBelief
  clockMinutes: number
  currentSceneId: string
  discoveredClues: string[]
  ending?: {
    id: string
    title: string
  }
  flags: Record<string, boolean>
  hitPoints: {
    current: number
    max: number
  }
  inventory: string[]
  sanity: {
    current: number
    lostToday: number
    starting: number
  }
  visitedScenes: string[]
}

function addUnique(items: string[], nextItems: string[] = []) {
  return Array.from(new Set([...items, ...nextItems]))
}

// 由 client 傳來的 wire state 建立 canonical state（首回合播種／舊存檔遷移）。
export function canonicalFromWireState(
  wire: KeeperWireState | undefined,
): CanonicalGameState {
  const sanity =
    typeof wire?.sanity === 'number'
      ? { current: wire.sanity, lostToday: 0, starting: wire.sanity }
      : {
          current: wire?.sanity?.current ?? 55,
          lostToday: wire?.sanity?.lostToday ?? 0,
          starting: wire?.sanity?.starting ?? wire?.sanity?.current ?? 55,
        }

  return {
    belief: {
      evidence: wire?.belief?.evidence ?? [],
      signalLog: wire?.belief?.signalLog ?? [],
      stage: wire?.belief?.stage ?? 'skeptical',
      testedMythRules: wire?.belief?.testedMythRules ?? [],
      verifiedMythRules: wire?.belief?.verifiedMythRules ?? [],
    },
    clockMinutes: wire?.clockMinutes ?? gameClockStartMinutes,
    currentSceneId: wire?.currentSceneId ?? '000_prologue',
    discoveredClues: wire?.discoveredClues ?? [],
    flags: wire?.flags ?? {},
    hitPoints: {
      current: wire?.hitPoints?.current ?? 11,
      max: wire?.hitPoints?.max ?? wire?.hitPoints?.current ?? 11,
    },
    inventory: wire?.inventory ?? [],
    sanity,
    visitedScenes: wire?.visitedScenes ?? [wire?.currentSceneId ?? '000_prologue'],
  }
}

function reduceBelief(
  belief: CanonicalBelief,
  observation?: BeliefObservation,
  beliefUpdate?: BeliefUpdate,
): CanonicalBelief {
  const evidence = [...belief.evidence]

  if (observation?.reason) {
    evidence.push(observation.reason)
  }

  if (!beliefUpdate) {
    return { ...belief, evidence: evidence.slice(-12) }
  }

  return {
    evidence: evidence.slice(-12),
    signalLog: beliefUpdate.signalLog,
    stage: beliefUpdate.stage,
    testedMythRules: beliefUpdate.testedMythRules,
    verifiedMythRules: beliefUpdate.verifiedMythRules,
  }
}

// 一回合的權威狀態轉移：套用 effects 與信念更新。
// visitSceneId 是本回合實際發生的場景（在 nextSceneId 生效前）。
export function applyTurnEffects(
  state: CanonicalGameState,
  observation?: BeliefObservation,
  effects?: InvestigationEffects,
  beliefUpdate?: BeliefUpdate,
  visitSceneId?: string,
): CanonicalGameState {
  const visited = visitSceneId
    ? addUnique(state.visitedScenes, [visitSceneId])
    : state.visitedScenes
  const nextSceneId = effects?.nextSceneId ?? state.currentSceneId
  const sanityDelta = effects?.sanityDelta ?? 0
  const hitPointDelta = effects?.hitPointDelta ?? 0
  const nextCurrentSanity = Math.max(0, state.sanity.current + sanityDelta)
  const nextCurrentHitPoints = Math.max(
    0,
    Math.min(state.hitPoints.max, state.hitPoints.current + hitPointDelta),
  )

  return {
    ...state,
    belief: reduceBelief(state.belief, observation, beliefUpdate),
    clockMinutes: state.clockMinutes + gameClockStepMinutes,
    currentSceneId: nextSceneId,
    discoveredClues: addUnique(state.discoveredClues, effects?.discoverClues),
    ending: effects?.endingId
      ? {
          id: effects.endingId,
          title: effects.endingTitle ?? effects.endingId,
        }
      : state.ending,
    flags: {
      ...state.flags,
      ...(effects?.setFlags ?? {}),
    },
    hitPoints: {
      current: nextCurrentHitPoints,
      max: state.hitPoints.max,
    },
    inventory: addUnique(
      state.inventory.filter((item) => !effects?.removeInventory?.includes(item)),
      effects?.addInventory,
    ),
    sanity: {
      ...state.sanity,
      current: nextCurrentSanity,
      lostToday:
        state.sanity.lostToday + (sanityDelta < 0 ? Math.abs(sanityDelta) : 0),
    },
    visitedScenes: addUnique(visited, [nextSceneId]),
  }
}

// 輕量守衛：keeperClient 透傳 server 快照前的最低限度驗證。
export function isCanonicalGameState(value: unknown): value is CanonicalGameState {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const candidate = value as Partial<CanonicalGameState>

  return (
    typeof candidate.currentSceneId === 'string' &&
    typeof candidate.flags === 'object' &&
    candidate.flags !== null &&
    Array.isArray(candidate.inventory)
  )
}

// 失序門檻（sanity-rules.md 的累計損失分層：穩定 0–2／動搖 3–5／失序 ≥6）。
// 失序後玩家失去自主行動能力：前端收起自由輸入框，只能在浮現的選項中選擇。
export const sanityDisorderThreshold = 6

export function isSanityDisordered(sanity: { lostToday: number }): boolean {
  return sanity.lostToday >= sanityDisorderThreshold
}
