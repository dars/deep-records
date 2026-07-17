import {
  createContext,
  useContext,
  useMemo,
  useState,
  type Dispatch,
  type PropsWithChildren,
  type SetStateAction,
} from 'react'
import type { BeliefUpdate } from '../../../shared/keeper'
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
    options?: { beliefUpdate?: BeliefUpdate; visitSceneId?: string },
  ) => void
  setInvestigationState: Dispatch<SetStateAction<InvestigationState>>
}

const InvestigationStateContext =
  createContext<InvestigationStateContextValue | null>(null)

function addUnique<T>(items: T[], nextItems: T[] = []) {
  return Array.from(new Set([...items, ...nextItems]))
}

// 信念階段由 worker 以累積制計算（worker/core/belief.ts），
// 前端只套用 server 回傳的 beliefUpdate 並在本地保存 evidence 敘述。
// 沒有 beliefUpdate 時（理論上不會發生）保守維持現狀，不自行推進階段。
function updateBelief(
  state: InvestigationState,
  observation?: BeliefObservation,
  beliefUpdate?: BeliefUpdate,
) {
  const belief = state.belief
  const evidence = [...belief.evidence]

  if (observation?.reason) {
    evidence.push(observation.reason)
  }

  if (!beliefUpdate) {
    return {
      ...belief,
      evidence: evidence.slice(-12),
    }
  }

  return {
    evidence: evidence.slice(-12),
    signalLog: beliefUpdate.signalLog,
    stage: beliefUpdate.stage,
    testedMythRules: beliefUpdate.testedMythRules,
    verifiedMythRules: beliefUpdate.verifiedMythRules,
  }
}

export function reduceInvestigationStateValue(
  state: InvestigationState,
  observation?: BeliefObservation,
  effects?: InvestigationEffects,
  beliefUpdate?: BeliefUpdate,
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
    belief: updateBelief(state, observation, beliefUpdate),
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
  initialState?: InvestigationState
  investigator?: InvestigatorProfile
}>

export function InvestigationStateProvider({
  children,
  initialState,
  investigator,
}: InvestigationStateProviderProps) {
  const [investigationState, setInvestigationState] = useState(
    () =>
      initialState ??
      (investigator
        ? createInitialInvestigationState(investigator)
        : initialInvestigationState),
  )

  const value = useMemo<InvestigationStateContextValue>(
    () => ({
      investigationState,
      // 一律以 functional update 為基底 reduce，避免以請求發出當下的
      // 舊 state 覆蓋期間發生的其他更新。
      reduceInvestigationState: (observation, effects, options) => {
        setInvestigationState((currentState) =>
          reduceInvestigationStateValue(
            options?.visitSceneId
              ? addVisitedScene(currentState, options.visitSceneId)
              : currentState,
            observation,
            effects,
            options?.beliefUpdate,
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
