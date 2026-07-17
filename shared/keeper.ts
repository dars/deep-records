// 前端與 worker 共用的 Keeper 協定型別與正規化邏輯。

export type BeliefStage = 'skeptical' | 'hypothesis' | 'operational' | 'convinced'

export type BeliefSignal =
  | 'none'
  | 'rational_investigation'
  | 'withhold_judgment'
  | 'propose_myth'
  | 'test_myth'
  | 'rely_on_myth'
  | 'rely_on_verified_myth'
  | 'accept_myth_cost'

export const beliefSignals: BeliefSignal[] = [
  'none',
  'rational_investigation',
  'withhold_judgment',
  'propose_myth',
  'test_myth',
  'rely_on_myth',
  'rely_on_verified_myth',
  'accept_myth_cost',
]

export type KeeperAction = {
  beliefSignal?: BeliefSignal
  id: string
  label: string
  mythRuleId?: string
}

export type BeliefObservation = {
  mythRuleId?: string
  reason?: string
  signal: BeliefSignal
}

export type InvestigationEffects = {
  addInventory?: string[]
  discoverClues?: string[]
  endingId?: string
  endingTitle?: string
  hitPointDelta?: number
  nextSceneId?: string
  removeInventory?: string[]
  sanityDelta?: number
  setFlags?: Record<string, boolean>
  testedMythRuleId?: string
  verifiedMythRuleId?: string
}

export type KeeperCheck = {
  attribute: string
  difficulty: number
  reason: string
}

export type KeeperCheckResult = KeeperCheck & {
  outcome: 'failure' | 'success'
  roll: number
}

export type KeeperResponse = {
  actions: KeeperAction[]
  checks: KeeperCheck[]
  effects?: InvestigationEffects
  narration: string[]
  observation?: BeliefObservation
}

export type TurnHistoryEntry = {
  narration: string[]
  playerAction: string
}

export type KeeperWireState = {
  belief?: {
    evidence?: string[]
    stage?: BeliefStage
    testedMythRules?: string[]
    verifiedMythRules?: string[]
  }
  currentSceneId?: string
  discoveredClues?: string[]
  flags?: Record<string, boolean>
  hitPoints?: {
    current?: number
    max?: number
  }
  inventory?: string[]
  sanity?:
    | number
    | {
        current?: number
        lostToday?: number
        starting?: number
      }
  visitedScenes?: string[]
}

export type KeeperRequestBody = {
  character?: {
    attributes?: Record<string, number>
    occupation?: string
  }
  checkResults?: KeeperCheckResult[]
  history?: TurnHistoryEntry[]
  playerAction?: string
  sceneId?: string
  selectedAction?: KeeperAction
  state?: KeeperWireState
}

export function normalizeBeliefSignal(value: unknown): BeliefSignal {
  return beliefSignals.includes(value as BeliefSignal)
    ? (value as BeliefSignal)
    : 'none'
}

export function normalizeActions(value: unknown): KeeperAction[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value.flatMap((item, index): KeeperAction[] => {
    if (typeof item === 'string') {
      return item.trim()
        ? [
            {
              beliefSignal: 'none',
              id: `keeper-action-${index + 1}`,
              label: item,
            },
          ]
        : []
    }

    if (!item || typeof item !== 'object') {
      return []
    }

    const action = item as Partial<KeeperAction>

    if (typeof action.label !== 'string' || !action.label.trim()) {
      return []
    }

    return [
      {
        beliefSignal: normalizeBeliefSignal(action.beliefSignal),
        id:
          typeof action.id === 'string' && action.id.trim()
            ? action.id
            : `keeper-action-${index + 1}`,
        label: action.label,
        mythRuleId:
          typeof action.mythRuleId === 'string' && action.mythRuleId.trim()
            ? action.mythRuleId
            : undefined,
      },
    ]
  })
}

export function normalizeNarration(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean)
}

export function normalizeChecks(value: unknown): KeeperCheck[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') {
      return []
    }

    const check = item as Partial<KeeperCheck>
    const difficulty = Number(check.difficulty)

    if (
      typeof check.attribute !== 'string' ||
      !Number.isFinite(difficulty) ||
      typeof check.reason !== 'string'
    ) {
      return []
    }

    return [
      {
        attribute: check.attribute,
        difficulty,
        reason: check.reason,
      },
    ]
  })
}

export function normalizeObservation(value: unknown): BeliefObservation | undefined {
  if (!value || typeof value !== 'object') {
    return undefined
  }

  const observation = value as Partial<BeliefObservation>

  return {
    mythRuleId:
      typeof observation.mythRuleId === 'string' && observation.mythRuleId.trim()
        ? observation.mythRuleId
        : undefined,
    reason: typeof observation.reason === 'string' ? observation.reason : undefined,
    signal: normalizeBeliefSignal(observation.signal),
  }
}

export function normalizeStringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined
  }

  const items = value.filter((item): item is string => typeof item === 'string')

  return items.length > 0 ? items : undefined
}

// setFlags 同時接受物件（舊格式）與字串陣列（responseSchema 無法描述動態 key，
// 因此模型輸出改用「要設為 true 的旗標名稱陣列」）。
function normalizeSetFlags(value: unknown): Record<string, boolean> | undefined {
  if (Array.isArray(value)) {
    const entries = value
      .filter((flag): flag is string => typeof flag === 'string' && Boolean(flag.trim()))
      .map((flag) => [flag.trim(), true] as const)

    return entries.length > 0 ? Object.fromEntries(entries) : undefined
  }

  if (!value || typeof value !== 'object') {
    return undefined
  }

  const entries = Object.entries(value).filter(
    (entry): entry is [string, boolean] => typeof entry[1] === 'boolean',
  )

  return entries.length > 0 ? Object.fromEntries(entries) : undefined
}

export function normalizeEffects(value: unknown): InvestigationEffects | undefined {
  if (!value || typeof value !== 'object') {
    return undefined
  }

  const effects = value as Record<string, unknown>
  const hitPointDelta = Number(effects.hitPointDelta)
  const sanityDelta = Number(effects.sanityDelta)

  const normalizeId = (input: unknown) =>
    typeof input === 'string' && input.trim() ? input : undefined

  return {
    addInventory: normalizeStringList(effects.addInventory),
    discoverClues: normalizeStringList(effects.discoverClues),
    endingId: normalizeId(effects.endingId),
    endingTitle: normalizeId(effects.endingTitle),
    hitPointDelta: Number.isFinite(hitPointDelta) ? hitPointDelta : undefined,
    nextSceneId: normalizeId(effects.nextSceneId),
    removeInventory: normalizeStringList(effects.removeInventory),
    sanityDelta: Number.isFinite(sanityDelta) ? sanityDelta : undefined,
    setFlags: normalizeSetFlags(effects.setFlags),
    testedMythRuleId: normalizeId(effects.testedMythRuleId),
    verifiedMythRuleId: normalizeId(effects.verifiedMythRuleId),
  }
}
