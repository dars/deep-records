import { describe, expect, it } from 'vitest'
import type { KeeperResponse } from '../shared/keeper'
import { computeBeliefUpdate, gateWitnessEnding } from '../worker/core/belief'
import { observationBeliefSignals } from '../worker/core/gemini'
import { ollamaKeeperSchema } from '../worker/core/ollama'
import { beliefSignals } from '../shared/keeper'

function stateWithLog(signalLog: string[], stage?: string) {
  return {
    belief: {
      signalLog,
      stage: stage as never,
      testedMythRules: [],
      verifiedMythRules: [],
    },
  }
}

function observed(signal: string, mythRuleId?: string) {
  return { mythRuleId, reason: '測試', signal: signal as never }
}

describe('computeBeliefUpdate：累積制階段判定', () => {
  it('propose/test 一次推進到 hypothesis', () => {
    expect(
      computeBeliefUpdate(stateWithLog([]), observed('test_myth', 'idol_watch'), undefined)
        .stage,
    ).toBe('hypothesis')
  })

  it('單一 accept_myth_cost 從 skeptical 只推進到 operational，不直升 convinced', () => {
    expect(
      computeBeliefUpdate(stateWithLog([]), observed('accept_myth_cost', 'idol'), undefined)
        .stage,
    ).toBe('operational')
  })

  it('已達 operational 後的 accept_myth_cost 才形成 convinced', () => {
    const update = computeBeliefUpdate(
      stateWithLog(['accept_myth_cost:idol']),
      observed('accept_myth_cost', 'ritual_symbols'),
      undefined,
    )

    expect(update.stage).toBe('convinced')
  })

  it('單一 rely_on_myth 只到 hypothesis；兩個不同規則的 rely 才到 operational', () => {
    expect(
      computeBeliefUpdate(stateWithLog([]), observed('rely_on_myth', 'a'), undefined).stage,
    ).toBe('hypothesis')
    expect(
      computeBeliefUpdate(
        stateWithLog(['rely_on_myth:a']),
        observed('rely_on_myth', 'b'),
        undefined,
      ).stage,
    ).toBe('operational')
  })

  it('先測試過假說，一次 rely 即構成 operational', () => {
    expect(
      computeBeliefUpdate(
        stateWithLog(['test_myth:idol_watch']),
        observed('rely_on_myth', 'idol_watch'),
        undefined,
      ).stage,
    ).toBe('operational')
  })

  it('防刷分：同一（訊號, 規則）組合不重複累積', () => {
    const update = computeBeliefUpdate(
      stateWithLog(['rely_on_myth:a']),
      observed('rely_on_myth', 'a'),
      undefined,
    )

    expect(update.signalLog).toEqual(['rely_on_myth:a'])
    expect(update.stage).toBe('hypothesis')
  })

  it('rational/none/withhold 不進入訊號紀錄', () => {
    const update = computeBeliefUpdate(
      stateWithLog([]),
      observed('rational_investigation'),
      undefined,
    )

    expect(update.signalLog).toEqual([])
    expect(update.stage).toBe('skeptical')
  })

  it('舊存檔遷移：無 signalLog 但已有階段時，不回落', () => {
    const update = computeBeliefUpdate(
      stateWithLog([], 'operational'),
      observed('rational_investigation'),
      undefined,
    )

    expect(update.stage).toBe('operational')
  })

  it('test_myth 的 mythRuleId 與 effects 的 tested/verified 都會累積', () => {
    const update = computeBeliefUpdate(
      stateWithLog([]),
      observed('test_myth', 'idol_watch'),
      { testedMythRuleId: 'salt_line', verifiedMythRuleId: 'idol_watch' },
    )

    expect(update.testedMythRules).toEqual(['idol_watch', 'salt_line'])
    expect(update.verifiedMythRules).toEqual(['idol_watch'])
  })
})

describe('gateWitnessEnding：見證者資格守門', () => {
  const witnessResponse: KeeperResponse = {
    actions: [],
    checks: [],
    effects: { endingId: 'ending_great_witness', endingTitle: '成功結局：偉大的見證者' },
    narration: ['……'],
  }

  it('convinced 玩家可獲得偉大見證者結局', () => {
    const gated = gateWitnessEnding(witnessResponse, 'convinced')

    expect(gated.effects?.endingId).toBe('ending_great_witness')
  })

  it('未達 convinced 時降級為一同被埋葬', () => {
    for (const stage of ['skeptical', 'hypothesis', 'operational'] as const) {
      const gated = gateWitnessEnding(witnessResponse, stage)

      expect(gated.effects?.endingId).toBe('ending_buried_together')
      expect(gated.effects?.endingTitle).toBeUndefined()
    }
  })

  it('其他結局不受影響', () => {
    const gated = gateWitnessEnding(
      {
        ...witnessResponse,
        effects: { endingId: 'ending_truth_in_hand' },
      },
      'skeptical',
    )

    expect(gated.effects?.endingId).toBe('ending_truth_in_hand')
  })
})

describe('observation schema 與信念訊號的一致性', () => {
  it('模型可發出的 observation 訊號涵蓋所有共享信念訊號', () => {
    // reducer 只吃 observation.signal；enum 漏列任何訊號都會讓該階梯永遠無法觸發
    // （曾漏列 rely_on_myth，導致最基本的依賴訊號記錄不到）。
    for (const signal of beliefSignals) {
      expect(observationBeliefSignals).toContain(signal)
    }
  })
})

describe('ollama schema 與信念訊號的一致性', () => {
  it('observation 訊號 enum 覆蓋所有共享信念訊號', () => {
    const enumValues =
      ollamaKeeperSchema.properties.observation.properties.signal.enum

    for (const signal of beliefSignals) {
      expect(enumValues).toContain(signal)
    }
  })
})
