// 信念階段的累積制判定（belief-rules.md「系統信念階段」與「測試、驗證與操作性相信」）。
// 設計原則的直譯：
//   - 相信不是瞬間開關：單一訊號不得直升 convinced。
//   - hypothesis：首次 propose_myth / test_myth。
//   - operational：兩個 rely 類訊號，或「已測試過假說＋一次 rely」；
//     accept_myth_cost 在低階段時也只推進到 operational。
//   - convinced：已達 operational 之後，再出現 accept_myth_cost。
//   - 防刷分：同一（訊號, mythRuleId）組合只累積一次。
import type {
  BeliefObservation,
  BeliefStage,
  BeliefUpdate,
  InvestigationEffects,
  KeeperResponse,
  KeeperWireState,
} from '../../shared/keeper'

const stageOrder: BeliefStage[] = ['skeptical', 'hypothesis', 'operational', 'convinced']

const hypothesisSignals = new Set(['propose_myth', 'test_myth'])
const relyClassSignals = new Set(['rely_on_myth', 'rely_on_verified_myth'])

function stageIndex(stage: BeliefStage | undefined): number {
  const index = stageOrder.indexOf(stage as BeliefStage)

  return index >= 0 ? index : 0
}

function addUnique(items: string[], nextItem: string | undefined): string[] {
  if (!nextItem || items.includes(nextItem)) {
    return items
  }

  return [...items, nextItem]
}

export function computeBeliefUpdate(
  state: KeeperWireState | undefined,
  observation: BeliefObservation | undefined,
  effects: InvestigationEffects | undefined,
): BeliefUpdate {
  const belief = state?.belief
  let signalLog = [...(belief?.signalLog ?? [])]
  let testedMythRules = [...(belief?.testedMythRules ?? [])]
  let verifiedMythRules = [...(belief?.verifiedMythRules ?? [])]

  const signal = observation?.signal

  if (
    signal &&
    (hypothesisSignals.has(signal) ||
      relyClassSignals.has(signal) ||
      signal === 'accept_myth_cost')
  ) {
    const entry = `${signal}:${observation?.mythRuleId ?? 'general'}`

    if (!signalLog.includes(entry)) {
      signalLog = [...signalLog, entry].slice(-24)
    }
  }

  if (signal === 'test_myth') {
    testedMythRules = addUnique(testedMythRules, observation?.mythRuleId)
  }

  testedMythRules = addUnique(testedMythRules, effects?.testedMythRuleId).slice(-16)
  verifiedMythRules = addUnique(verifiedMythRules, effects?.verifiedMythRuleId).slice(-16)

  const computedStage = computeStageFromLog(signalLog)
  // 單向棘輪：不得低於 client 回報的既有階段
  // （兼容尚未有 signalLog 的舊存檔；設計上信念本就不因否認而回落）。
  const stage =
    stageIndex(computedStage) >= stageIndex(belief?.stage)
      ? computedStage
      : ((belief?.stage ?? 'skeptical') as BeliefStage)

  return {
    signalLog,
    stage,
    testedMythRules,
    verifiedMythRules,
  }
}

function computeStageFromLog(signalLog: string[]): BeliefStage {
  let stage = 0
  let relyCount = 0
  let hasTestedHypothesis = false

  for (const entry of signalLog) {
    const signal = entry.split(':')[0]

    if (hypothesisSignals.has(signal)) {
      hasTestedHypothesis = hasTestedHypothesis || signal === 'test_myth'
      stage = Math.max(stage, 1)
    } else if (relyClassSignals.has(signal)) {
      relyCount += 1
      stage = Math.max(stage, 1)

      if (relyCount >= 2 || hasTestedHypothesis) {
        stage = Math.max(stage, 2)
      }
    } else if (signal === 'accept_myth_cost') {
      stage = stage >= 2 ? 3 : 2
    }
  }

  return stageOrder[stage]
}

// 見證者資格守門（belief-rules.md「信念與見證者資格」＋ demo-rules 結局路由）：
// 合格見證者需要 convinced；未達標時房東判定儀式失敗，降級為「一同被埋葬」。
export function gateWitnessEnding(
  response: KeeperResponse,
  stage: BeliefStage,
): KeeperResponse {
  if (
    response.effects?.endingId !== 'ending_great_witness' ||
    stage === 'convinced'
  ) {
    return response
  }

  return {
    ...response,
    effects: {
      ...response.effects,
      endingId: 'ending_buried_together',
      // 標題交由 validateEffects 從結局 frontmatter 補上。
      endingTitle: undefined,
    },
  }
}
