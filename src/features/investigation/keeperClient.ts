import type {
  ActionOption,
  BeliefObservation,
  BeliefSignal,
  InvestigationEffects,
  InvestigationState,
} from '../../types/investigation'

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
  actions: ActionOption[]
  checks: KeeperCheck[]
  effects?: InvestigationEffects
  narration: string[]
  observation?: BeliefObservation
}

type KeeperRequest = {
  checkResults?: KeeperCheckResult[]
  playerAction: string
  sceneId: string
  selectedAction?: ActionOption
  state: InvestigationState
  character: {
    occupation: string
    attributes: Record<string, number>
  }
}

const keeperEndpoint = 'https://keeper.devlin-865.workers.dev/api/keeper'

export async function requestKeeperTurn(
  playerAction: string,
  options?: {
    checkResults?: KeeperCheckResult[]
    investigationState: InvestigationState
    sceneId?: string
    selectedAction?: ActionOption
  },
): Promise<KeeperResponse> {
  const requestBody: KeeperRequest = {
    checkResults: options?.checkResults,
    sceneId: options?.sceneId ?? '001_apartment_entrance',
    playerAction,
    selectedAction: options?.selectedAction,
    state:
      options?.investigationState ??
      ({
        currentSceneId: options?.sceneId ?? '001_apartment_entrance',
      } as InvestigationState),
    character: {
      occupation: requestBodyStateToOccupation(options?.investigationState),
      attributes: Object.fromEntries(
        (options?.investigationState?.investigator.attributes ?? []).map(
          ([label, value]) => [label, Number(value)],
        ),
      ),
    },
  }

  const response = await fetch(keeperEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(requestBody),
  })

  const data = await response.json()

  if (!response.ok) {
    const message =
      typeof data?.message === 'string' ? data.message : '守密人暫時沒有回應。'
    throw new Error(message)
  }

  return {
    narration: Array.isArray(data.narration) ? data.narration : [],
    actions: normalizeActions(data.actions),
    checks: Array.isArray(data.checks) ? data.checks : [],
    effects: normalizeEffects(data.effects),
    observation: normalizeObservation(data.observation),
  }
}

function requestBodyStateToOccupation(
  investigationState: InvestigationState | undefined,
) {
  return investigationState?.investigator.occupationId ?? 'occupation_software_engineer'
}

const beliefSignals: BeliefSignal[] = [
  'none',
  'rational_investigation',
  'withhold_judgment',
  'propose_myth',
  'test_myth',
  'rely_on_myth',
  'rely_on_verified_myth',
  'accept_myth_cost',
]

function normalizeBeliefSignal(value: unknown): BeliefSignal {
  return beliefSignals.includes(value as BeliefSignal)
    ? (value as BeliefSignal)
    : 'none'
}

function normalizeActions(value: unknown): ActionOption[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value.flatMap((item, index) => {
    if (typeof item === 'string') {
      return [
        {
          id: `keeper-action-${Date.now()}-${index}`,
          label: item,
        },
      ]
    }

    if (!item || typeof item !== 'object') {
      return []
    }

    const action = item as Partial<ActionOption>

    if (typeof action.label !== 'string') {
      return []
    }

    return [
      {
        beliefSignal: normalizeBeliefSignal(action.beliefSignal),
        id:
          typeof action.id === 'string'
            ? action.id
            : `keeper-action-${Date.now()}-${index}`,
        label: action.label,
        mythRuleId: action.mythRuleId,
      },
    ]
  })
}

function normalizeObservation(value: unknown): BeliefObservation | undefined {
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

function normalizeStringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined
  }

  const items = value.filter((item): item is string => typeof item === 'string')

  return items.length > 0 ? items : undefined
}

function normalizeEffects(value: unknown): InvestigationEffects | undefined {
  if (!value || typeof value !== 'object') {
    return undefined
  }

  const effects = value as Partial<InvestigationEffects>
  const hitPointDelta = Number(effects.hitPointDelta)
  const sanityDelta = Number(effects.sanityDelta)
  const setFlags =
    effects.setFlags && typeof effects.setFlags === 'object'
      ? Object.fromEntries(
          Object.entries(effects.setFlags).filter(
            ([, flagValue]) => typeof flagValue === 'boolean',
          ),
        )
      : undefined

  return {
    addInventory: normalizeStringList(effects.addInventory),
    discoverClues: normalizeStringList(effects.discoverClues),
    endingId:
      typeof effects.endingId === 'string' && effects.endingId.trim()
        ? effects.endingId
        : undefined,
    endingTitle:
      typeof effects.endingTitle === 'string' && effects.endingTitle.trim()
        ? effects.endingTitle
        : undefined,
    hitPointDelta: Number.isFinite(hitPointDelta) ? hitPointDelta : undefined,
    nextSceneId:
      typeof effects.nextSceneId === 'string' && effects.nextSceneId.trim()
        ? effects.nextSceneId
        : undefined,
    removeInventory: normalizeStringList(effects.removeInventory),
    sanityDelta: Number.isFinite(sanityDelta) ? sanityDelta : undefined,
    setFlags:
      setFlags && Object.keys(setFlags).length > 0
        ? (setFlags as Record<string, boolean>)
        : undefined,
    testedMythRuleId:
      typeof effects.testedMythRuleId === 'string' && effects.testedMythRuleId.trim()
        ? effects.testedMythRuleId
        : undefined,
    verifiedMythRuleId:
      typeof effects.verifiedMythRuleId === 'string' &&
      effects.verifiedMythRuleId.trim()
        ? effects.verifiedMythRuleId
        : undefined,
  }
}
