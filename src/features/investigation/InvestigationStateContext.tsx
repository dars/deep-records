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
import { applyTurnEffects } from '../../../shared/state'
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

// 權威 reduce 邏輯在 shared/state.ts（與 worker 端 Durable Object 共用同一實作）；
// 這裡只是把 canonical 欄位套回含 investigator 的前端狀態。
export function reduceInvestigationStateValue(
  state: InvestigationState,
  observation?: BeliefObservation,
  effects?: InvestigationEffects,
  beliefUpdate?: BeliefUpdate,
): InvestigationState {
  return {
    ...state,
    ...applyTurnEffects(state, observation, effects, beliefUpdate),
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
