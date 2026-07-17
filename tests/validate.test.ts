import { describe, expect, it } from 'vitest'
import type { KeeperResponse } from '../shared/keeper'
import {
  ensureAvailableActions,
  validateEffects,
  validateKeeperResponse,
  validateNextSceneId,
} from '../worker/core/validate'

const baseResponse: KeeperResponse = {
  actions: [{ id: 'a', label: '繼續調查' }],
  checks: [{ attribute: '觀察', difficulty: 60, reason: '測試' }],
  narration: ['測試段落。'],
}

describe('validateEffects', () => {
  it('過濾不存在的道具與不在場景內的道具', () => {
    const effects = validateEffects(
      { addInventory: ['item_not_exist', 'item_hidden_memory_card'] },
      '001_apartment_entrance',
    )

    expect(effects?.addInventory).toBeUndefined()
  })

  it('允許在正確場景取得道具', () => {
    const effects = validateEffects(
      { addInventory: ['item_friend_apartment_spare_key'] },
      '001_apartment_entrance',
    )

    expect(effects?.addInventory).toEqual(['item_friend_apartment_spare_key'])
  })

  it('已持有的一次性道具不能再次取得', () => {
    const effects = validateEffects(
      { addInventory: ['item_friend_apartment_spare_key'] },
      '001_apartment_entrance',
      { inventory: ['item_friend_apartment_spare_key'] },
    )

    expect(effects?.addInventory).toBeUndefined()
  })

  it('clamp SAN 與生命變化', () => {
    const effects = validateEffects(
      { hitPointDelta: -99, sanityDelta: -99 },
      '001_apartment_entrance',
    )

    expect(effects?.hitPointDelta).toBe(-5)
    expect(effects?.sanityDelta).toBe(-10)
  })

  it('未知 endingId 會被丟棄，已知 endingId 補上 md 標題', () => {
    const unknown = validateEffects(
      { endingId: 'ending_fake', endingTitle: '假結局' },
      '001_apartment_entrance',
    )
    const known = validateEffects(
      { endingId: 'ending_ordinary_departure' },
      '001_apartment_entrance',
    )

    expect(unknown?.endingId).toBeUndefined()
    expect(unknown?.endingTitle).toBeUndefined()
    expect(known?.endingId).toBe('ending_ordinary_departure')
    expect(known?.endingTitle).toBe('平庸的結局')
  })
})

describe('validateNextSceneId', () => {
  it('只允許 connects_to 內的轉場', () => {
    expect(validateNextSceneId('002_friend_apartment', '001_apartment_entrance')).toBe(
      '002_friend_apartment',
    )
    expect(
      validateNextSceneId('003_friend_bedroom', '001_apartment_entrance'),
    ).toBeUndefined()
    expect(validateNextSceneId('001_apartment_entrance', '001_apartment_entrance')).toBeUndefined()
    expect(validateNextSceneId('not_a_scene', '001_apartment_entrance')).toBeUndefined()
  })

  it('允許從四樓門外進入五樓終局場景', () => {
    expect(validateNextSceneId('007_landlord_apartment', '002_friend_apartment')).toBe(
      '007_landlord_apartment',
    )
  })
})

describe('validateKeeperResponse', () => {
  it('觸發結局時清空 actions 與 checks', () => {
    const validated = validateKeeperResponse(
      {
        ...baseResponse,
        effects: { endingId: 'ending_ordinary_departure' },
      },
      '001_apartment_entrance',
    )

    expect(validated.actions).toEqual([])
    expect(validated.checks).toEqual([])
    expect(validated.effects?.endingTitle).toBe('平庸的結局')
  })

  it('過濾 difficulty 超出範圍的檢定', () => {
    const validated = validateKeeperResponse(
      {
        ...baseResponse,
        checks: [
          { attribute: '觀察', difficulty: 0, reason: '無效' },
          { attribute: '觀察', difficulty: 60, reason: '有效' },
        ],
      },
      '001_apartment_entrance',
    )

    expect(validated.checks).toHaveLength(1)
    expect(validated.checks[0].reason).toBe('有效')
  })
})

describe('ensureAvailableActions', () => {
  it('沒有選項也沒有檢定時補上場景備援選項', () => {
    const ensured = ensureAvailableActions(
      { actions: [], checks: [], narration: ['……'] },
      '001_apartment_entrance',
      '看著雨發呆',
    )

    expect(ensured.actions.length).toBeGreaterThan(0)
  })

  it('楔子場景不補選項', () => {
    const ensured = ensureAvailableActions(
      { actions: [], checks: [], narration: ['……'] },
      '000_prologue',
      '開始楔子',
    )

    expect(ensured.actions).toEqual([])
  })
})
