import {
  createContext,
  useContext,
  useMemo,
  useState,
  type Dispatch,
  type PropsWithChildren,
  type SetStateAction,
} from 'react'
import {
  createInitialInvestigationState,
  initialInvestigationState,
  type BeliefObservation,
  type InvestigationEffects,
  type InvestigationState,
  type InvestigatorProfile,
} from '../../types/investigation'

type InvestigationStateContextValue = {
  investigationState: InvestigationState
  reduceInvestigationState: (
    observation?: BeliefObservation,
    effects?: InvestigationEffects,
    baseState?: InvestigationState,
  ) => void
  setInvestigationState: Dispatch<SetStateAction<InvestigationState>>
}

const InvestigationStateContext =
  createContext<InvestigationStateContextValue | null>(null)

function addUnique<T>(items: T[], nextItems: T[] = []) {
  return Array.from(new Set([...items, ...nextItems]))
}

function updateBelief(
  state: InvestigationState,
  observation?: BeliefObservation,
  effects?: InvestigationEffects,
) {
  const belief = state.belief
  let stage = belief.stage
  let testedMythRules = addUnique(
    belief.testedMythRules,
    effects?.testedMythRuleId ? [effects.testedMythRuleId] : [],
  )
  const verifiedMythRules = addUnique(
    belief.verifiedMythRules,
    effects?.verifiedMythRuleId ? [effects.verifiedMythRuleId] : [],
  )
  const evidence = [...belief.evidence]

  if (observation?.mythRuleId && observation.signal === 'test_myth') {
    testedMythRules = addUnique(testedMythRules, [observation.mythRuleId])
  }

  if (
    observation?.signal === 'propose_myth' ||
    observation?.signal === 'test_myth'
  ) {
    if (stage === 'skeptical') {
      stage = 'hypothesis'
    }
  }

  if (
    observation?.signal === 'rely_on_myth' ||
    observation?.signal === 'rely_on_verified_myth'
  ) {
    if (stage === 'skeptical' || stage === 'hypothesis') {
      stage = 'operational'
    }
  }

  if (observation?.signal === 'accept_myth_cost') {
    stage = 'convinced'
  }

  if (observation?.reason) {
    evidence.push(observation.reason)
  }

  return {
    evidence: evidence.slice(-12),
    stage,
    testedMythRules,
    verifiedMythRules,
  }
}

export function reduceInvestigationStateValue(
  state: InvestigationState,
  observation?: BeliefObservation,
  effects?: InvestigationEffects,
) {
  const nextSceneId = effects?.nextSceneId ?? state.currentSceneId
  const sanityDelta = effects?.sanityDelta ?? 0
  const hitPointDelta = effects?.hitPointDelta ?? 0
  const currentHitPoints = state.hitPoints?.current ?? state.investigator.hitPoints
  const maxHitPoints = state.hitPoints?.max ?? state.investigator.hitPoints
  const nextCurrentSanity = Math.max(0, state.sanity.current + sanityDelta)
  const nextCurrentHitPoints = Math.max(
    0,
    Math.min(maxHitPoints, currentHitPoints + hitPointDelta),
  )

  return {
    ...state,
    belief: updateBelief(state, observation, effects),
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
      max: maxHitPoints,
      current: nextCurrentHitPoints,
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
    visitedScenes: addUnique(state.visitedScenes, [nextSceneId]),
  }
}

export function addVisitedScene(
  state: InvestigationState,
  sceneId: string,
): InvestigationState {
  return {
    ...state,
    currentSceneId: sceneId,
    visitedScenes: addUnique(state.visitedScenes, [sceneId]),
  }
}

type InvestigationStateProviderProps = PropsWithChildren<{
  investigator?: InvestigatorProfile
}>

export function InvestigationStateProvider({
  children,
  investigator,
}: InvestigationStateProviderProps) {
  const [investigationState, setInvestigationState] = useState(() =>
    investigator
      ? createInitialInvestigationState(investigator)
      : initialInvestigationState,
  )

  const value = useMemo<InvestigationStateContextValue>(
    () => ({
      investigationState,
      reduceInvestigationState: (observation, effects, baseState) => {
        setInvestigationState((currentState) =>
          reduceInvestigationStateValue(
            baseState ?? currentState,
            observation,
            effects,
          ),
        )
      },
      setInvestigationState,
    }),
    [investigationState],
  )

  return (
    <InvestigationStateContext.Provider value={value}>
      {children}
    </InvestigationStateContext.Provider>
  )
}

export function useInvestigationState() {
  const value = useContext(InvestigationStateContext)

  if (!value) {
    throw new Error(
      'useInvestigationState must be used inside InvestigationStateProvider',
    )
  }

  return value
}
