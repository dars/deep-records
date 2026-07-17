import type { BeliefStage, KeeperAction } from '../../shared/keeper'

export type {
  BeliefObservation,
  BeliefSignal,
  BeliefStage,
  InvestigationEffects,
  KeeperAction,
  KeeperCheck,
  KeeperCheckResult,
  KeeperResponse,
  TurnHistoryEntry,
} from '../../shared/keeper'

// 前端沿用的名稱：與 Keeper 協定中的 KeeperAction 相同。
export type ActionOption = KeeperAction

export type SanityState = {
  current: number
  lostToday: number
  starting: number
}

export type HitPointState = {
  current: number
  max: number
}

export type InvestigatorProfile = {
  attributes: Array<[string, string]>
  creditRating: number
  hitPoints: number
  initialInventory: string[]
  name: string
  occupationId: string
  occupationTitle: string
  skills: Array<[string, string]>
}

export type InvestigationState = {
  belief: {
    evidence: string[]
    signalLog: string[]
    stage: BeliefStage
    testedMythRules: string[]
    verifiedMythRules: string[]
  }
  currentSceneId: string
  discoveredClues: string[]
  ending?: {
    id: string
    title: string
  }
  flags: Record<string, boolean>
  hitPoints: HitPointState
  investigator: InvestigatorProfile
  inventory: string[]
  sanity: SanityState
  visitedScenes: string[]
}

export const defaultInvestigatorProfile: InvestigatorProfile = {
  attributes: [
    ['體能', '40'],
    ['靈巧', '50'],
    ['觀察', '60'],
    ['分析', '75'],
    ['應對', '50'],
    ['意志', '55'],
  ],
  creditRating: 45,
  hitPoints: 11,
  initialInventory: [
    '內建 microSD 讀卡槽的私人筆記型電腦',
    '智慧型手機',
    '未完成的工作專案',
    '現金與悠遊卡',
  ],
  name: '林亦辰',
  occupationId: 'occupation_software_engineer',
  occupationTitle: '軟體工程師',
  skills: [
    ['電腦使用', '75'],
    ['圖書館使用', '55'],
    ['電子學', '50'],
    ['科學（密碼學）', '45'],
    ['母語', '80'],
    ['英語', '55'],
    ['心理學', '45'],
    ['鎖匠開鎖', '35'],
  ],
}

export function createInitialInvestigationState(
  investigator = defaultInvestigatorProfile,
): InvestigationState {
  const startingSanity =
    Number(investigator.attributes.find(([label]) => label === '意志')?.[1]) || 55

  return {
    belief: {
      evidence: [],
      signalLog: [],
      stage: 'skeptical',
      testedMythRules: [],
      verifiedMythRules: [],
    },
    currentSceneId: '000_prologue',
    discoveredClues: [],
    ending: undefined,
    flags: {},
    hitPoints: {
      current: investigator.hitPoints,
      max: investigator.hitPoints,
    },
    investigator,
    inventory: investigator.initialInventory,
    sanity: {
      current: startingSanity,
      lostToday: 0,
      starting: startingSanity,
    },
    visitedScenes: ['000_prologue'],
  }
}

export const initialInvestigationState: InvestigationState = {
  ...createInitialInvestigationState(),
}
