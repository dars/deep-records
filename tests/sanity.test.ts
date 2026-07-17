import { describe, expect, it } from 'vitest'
import { handleScriptedInvestigation } from '../worker/core/deterministic'
import {
  resolveSanityCheck,
  resolveSanityEffects,
  rollDiceExpression,
} from '../worker/core/sanity'

// 可預測的假亂數：依序回傳指定值。
function fixedRandom(...values: number[]) {
  let index = 0

  return () => values[Math.min(index++, values.length - 1)]
}

describe('rollDiceExpression', () => {
  it('常數與骰式都能解析', () => {
    expect(rollDiceExpression('0')).toBe(0)
    expect(rollDiceExpression('1')).toBe(1)
    expect(rollDiceExpression('1D3', fixedRandom(0.99))).toBe(3)
    expect(rollDiceExpression('1D3', fixedRandom(0))).toBe(1)
    expect(rollDiceExpression('junk')).toBeUndefined()
  })
})

describe('resolveSanityCheck', () => {
  it('擲骰結果小於等於目前 SAN 視為通過，使用通過損失', () => {
    // roll = floor(0.10*100)+1 = 11 <= 55 → 通過 → 損失 0
    const result = resolveSanityCheck('0/1', 55, fixedRandom(0.1))

    expect(result?.passed).toBe(true)
    expect(result?.delta).toBe(0)
  })

  it('未通過時使用未通過損失', () => {
    // roll = 91 > 55 → 未通過 → 損失 1
    const result = resolveSanityCheck('0/1', 55, fixedRandom(0.9))

    expect(result?.passed).toBe(false)
    expect(result?.delta).toBe(-1)
  })

  it('1/1D3 通過仍至少損失 1', () => {
    const result = resolveSanityCheck('1/1D3', 55, fixedRandom(0.1))

    expect(result?.passed).toBe(true)
    expect(result?.delta).toBe(-1)
  })

  it('無效規格回傳 undefined', () => {
    expect(resolveSanityCheck('abc', 55)).toBeUndefined()
    expect(resolveSanityCheck('1D3', 55)).toBeUndefined()
  })
})

describe('resolveSanityEffects', () => {
  const baseResponse = {
    actions: [],
    checks: [],
    narration: ['段落。'],
  }

  it('解析 sanityCheck 為 sanityDelta 並記錄事件旗標', () => {
    const resolved = resolveSanityEffects(
      {
        ...baseResponse,
        effects: {
          sanityCheck: { eventFlag: 'san_checked_black_residue', spec: '0/1' },
        },
      },
      { sanity: { current: 55, starting: 55 } },
      fixedRandom(0.9, 0.5),
    )

    expect(resolved.effects?.sanityDelta).toBe(-1)
    expect(resolved.effects?.setFlags?.san_checked_black_residue).toBe(true)
    expect(resolved.effects?.sanityCheck).toBeUndefined()
  })

  it('事件旗標已存在時不重複扣除', () => {
    const resolved = resolveSanityEffects(
      {
        ...baseResponse,
        effects: {
          sanityCheck: { eventFlag: 'san_checked_black_residue', spec: '0/1' },
        },
      },
      {
        flags: { san_checked_black_residue: true },
        sanity: { current: 54, starting: 55 },
      },
      fixedRandom(0.9),
    )

    expect(resolved.effects?.sanityDelta).toBeUndefined()
    expect(resolved.effects?.setFlags).toBeUndefined()
  })

  it('非法旗標名稱直接忽略', () => {
    const resolved = resolveSanityEffects(
      {
        ...baseResponse,
        effects: {
          sanityCheck: { eventFlag: 'bad flag!', spec: '0/1' },
        },
      },
      { sanity: { current: 55, starting: 55 } },
    )

    expect(resolved.effects?.sanityDelta).toBeUndefined()
  })

  it('沒有 sanityCheck 時原樣返回', () => {
    const resolved = resolveSanityEffects(
      { ...baseResponse, effects: { sanityDelta: -2 } },
      { sanity: { current: 55, starting: 55 } },
    )

    expect(resolved.effects?.sanityDelta).toBe(-2)
  })
})

describe('開木門的腳本 SAN 事件', () => {
  const doorState = {
    flags: { friend_apartment_iron_door_opened: true },
    inventory: ['item_friend_apartment_spare_key'],
    sanity: { current: 55, starting: 55 },
  }

  it('開木門會進行 0/1 氣味判定並設下事件旗標', () => {
    const response = handleScriptedInvestigation(
      '002_friend_apartment',
      '拿另一把鑰匙開啟後方木門',
      undefined,
      doorState,
      { occupation: 'occupation_software_engineer' },
    )

    expect(response?.effects?.setFlags?.san_checked_seawater_stench).toBe(true)
    const delta = response?.effects?.sanityDelta

    expect(delta === undefined || delta === -1).toBe(true)
  })

  it('護理師免除氣味判定', () => {
    const response = handleScriptedInvestigation(
      '002_friend_apartment',
      '拿另一把鑰匙開啟後方木門',
      undefined,
      doorState,
      { occupation: 'occupation_nurse' },
    )

    expect(response?.effects?.setFlags?.san_checked_seawater_stench).toBeUndefined()
    expect(response?.effects?.sanityDelta).toBeUndefined()
  })

  it('已判定過的氣味事件不重複', () => {
    const response = handleScriptedInvestigation(
      '002_friend_apartment',
      '拿另一把鑰匙開啟後方木門',
      undefined,
      {
        ...doorState,
        flags: {
          ...doorState.flags,
          san_checked_seawater_stench: true,
        },
      },
      { occupation: 'occupation_software_engineer' },
    )

    expect(response?.effects?.sanityDelta).toBeUndefined()
    expect(response?.effects?.setFlags?.san_checked_seawater_stench).toBeUndefined()
  })
})
