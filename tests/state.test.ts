import { describe, expect, it } from 'vitest'
import {
  applyTurnEffects,
  canonicalFromWireState,
  type CanonicalGameState,
} from '../shared/state'

function baseState(): CanonicalGameState {
  return {
    belief: {
      evidence: [],
      signalLog: [],
      stage: 'skeptical',
      testedMythRules: [],
      verifiedMythRules: [],
    },
    currentSceneId: '003_friend_bedroom',
    discoveredClues: [],
    flags: {},
    hitPoints: { current: 11, max: 11 },
    inventory: ['智慧型手機'],
    sanity: { current: 55, lostToday: 0, starting: 55 },
    visitedScenes: ['000_prologue', '003_friend_bedroom'],
  }
}

describe('applyTurnEffects', () => {
  it('套用場景轉移、旗標、線索與 SAN 損失', () => {
    const next = applyTurnEffects(
      baseState(),
      { reason: '玩家測試假說', signal: 'test_myth' },
      {
        discoverClues: ['item_warding_star_mark'],
        nextSceneId: '003_friend_apartment_livingroom',
        sanityDelta: -2,
        setFlags: { officer_a_yang_arrived: true },
      },
      {
        signalLog: ['test_myth:warding_star_mark'],
        stage: 'hypothesis',
        testedMythRules: ['warding_star_mark'],
        verifiedMythRules: [],
      },
    )

    expect(next.currentSceneId).toBe('003_friend_apartment_livingroom')
    expect(next.visitedScenes).toContain('003_friend_apartment_livingroom')
    expect(next.flags.officer_a_yang_arrived).toBe(true)
    expect(next.discoveredClues).toContain('item_warding_star_mark')
    expect(next.sanity.current).toBe(53)
    expect(next.sanity.lostToday).toBe(2)
    expect(next.belief.stage).toBe('hypothesis')
    expect(next.belief.evidence).toContain('玩家測試假說')
  })

  it('SAN 不會低於 0，HP 不會超過上限', () => {
    const low = applyTurnEffects(baseState(), undefined, { sanityDelta: -99 })
    expect(low.sanity.current).toBe(0)

    const healed = applyTurnEffects(baseState(), undefined, { hitPointDelta: 5 })
    expect(healed.hitPoints.current).toBe(11)
  })

  it('結局設定後保留；沒有結局時維持 undefined', () => {
    const ended = applyTurnEffects(baseState(), undefined, {
      endingId: 'ending_truth_in_hand',
      endingTitle: '真相在手',
    })
    expect(ended.ending).toEqual({ id: 'ending_truth_in_hand', title: '真相在手' })

    const unchanged = applyTurnEffects(ended, undefined, {})
    expect(unchanged.ending?.id).toBe('ending_truth_in_hand')
  })

  it('道具移除與新增去重', () => {
    const next = applyTurnEffects(baseState(), undefined, {
      addInventory: ['item_hidden_memory_card', '智慧型手機'],
      removeInventory: ['智慧型手機'],
    })

    expect(next.inventory).toEqual(['item_hidden_memory_card', '智慧型手機'])
  })

  it('visitSceneId 在轉場前記錄本回合場景', () => {
    const next = applyTurnEffects(
      baseState(),
      undefined,
      { nextSceneId: '004_friend_kitchen' },
      undefined,
      '003_friend_bedroom',
    )

    expect(next.visitedScenes).toContain('003_friend_bedroom')
    expect(next.visitedScenes).toContain('004_friend_kitchen')
  })
})

describe('canonicalFromWireState', () => {
  it('數字型 sanity 與缺欄位都能播種出完整狀態', () => {
    const seeded = canonicalFromWireState({
      currentSceneId: '002_friend_apartment',
      sanity: 48,
    })

    expect(seeded.sanity).toEqual({ current: 48, lostToday: 0, starting: 48 })
    expect(seeded.belief.stage).toBe('skeptical')
    expect(seeded.visitedScenes).toEqual(['002_friend_apartment'])
  })

  it('undefined 播種出楔子起始狀態', () => {
    const seeded = canonicalFromWireState(undefined)

    expect(seeded.currentSceneId).toBe('000_prologue')
    expect(seeded.hitPoints).toEqual({ current: 11, max: 11 })
  })
})
