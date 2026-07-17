import { describe, expect, it } from 'vitest'
import {
  handleDeterministicInvestigationAction,
  handleDeterministicSceneTransition,
} from '../worker/core/deterministic'
import { inferEnding } from '../worker/core/ending'

describe('handleDeterministicSceneTransition', () => {
  it('從一樓上樓觸發 002 轉場', () => {
    const response = handleDeterministicSceneTransition(
      '001_apartment_entrance',
      '沿著樓梯前往四樓',
    )

    expect(response?.effects?.nextSceneId).toBe('002_friend_apartment')
    expect(response?.actions.length).toBeGreaterThan(0)
  })

  it('否定語氣不觸發轉場', () => {
    const response = handleDeterministicSceneTransition(
      '001_apartment_entrance',
      '先不上樓，繼續看信箱',
    )

    expect(response).toBeUndefined()
  })

  it('尚未開木門時，進屋敘述不觸發 003 轉場', () => {
    const response = handleDeterministicSceneTransition(
      '002_friend_apartment',
      '走進客廳',
      undefined,
      { flags: {} },
    )

    expect(response).toBeUndefined()
  })

  it('木門已開時可進入客廳', () => {
    const response = handleDeterministicSceneTransition(
      '002_friend_apartment',
      '走進客廳',
      undefined,
      { flags: { friend_apartment_wooden_door_opened: true } },
    )

    expect(response?.effects?.nextSceneId).toBe('003_friend_apartment_livingroom')
  })
})

describe('handleDeterministicInvestigationAction', () => {
  it('第一次查信箱取得備用鑰匙', () => {
    const response = handleDeterministicInvestigationAction(
      '001_apartment_entrance',
      '查看阿宏提過的一樓信箱',
    )

    expect(response?.effects?.addInventory).toEqual(['item_friend_apartment_spare_key'])
  })

  it('已持有鑰匙時回頭查信箱不再重複給', () => {
    const response = handleDeterministicInvestigationAction(
      '001_apartment_entrance',
      '再看一次信箱',
      undefined,
      { inventory: ['item_friend_apartment_spare_key'] },
    )

    expect(response?.effects?.addInventory).toBeUndefined()
    expect(response?.narration.join('')).toContain('已經在你身上')
  })

  it('未取得記憶卡時嘗試讀取會被擋下', () => {
    const response = handleDeterministicInvestigationAction(
      '003_friend_apartment_livingroom',
      '用筆電讀取記憶卡',
      undefined,
      { inventory: [] },
    )

    expect(response?.effects?.addInventory).toBeUndefined()
    expect(response?.narration.join('')).toContain('先確定它真的已經在你手裡')
  })
})

describe('inferEnding', () => {
  it('楔子不觸發結局', () => {
    expect(inferEnding('000_prologue', '轉身離開回家')).toBeUndefined()
  })

  it('在一樓離開觸發平庸結局', () => {
    const ending = inferEnding('001_apartment_entrance', '轉身離開公寓')

    expect(ending?.id).toBe('ending_ordinary_departure')
    expect(ending?.title).toBe('平庸的結局')
  })

  it('帶著記憶卡離開且交給警方，依信念階段分流', () => {
    const skeptical = inferEnding('003_friend_apartment_livingroom', '離開公寓去報警，交出記憶卡', {
      belief: { stage: 'skeptical' },
      inventory: ['item_hidden_memory_card'],
    })
    const convinced = inferEnding('003_friend_apartment_livingroom', '離開公寓去報警，交出記憶卡', {
      belief: { stage: 'convinced' },
      inventory: ['item_hidden_memory_card'],
    })

    expect(skeptical?.id).toBe('ending_surrendered_evidence')
    expect(convinced?.id).toBe('ending_suppressed_truth')
  })

  it('帶著記憶卡自行離開是開放結局', () => {
    const ending = inferEnding('003_friend_apartment_livingroom', '帶著東西離開公寓回家', {
      inventory: ['item_hidden_memory_card'],
    })

    expect(ending?.id).toBe('ending_truth_in_hand')
  })

  it('沒有記憶卡從四樓離開是不安結局', () => {
    const ending = inferEnding('003_friend_apartment_livingroom', '放棄調查，離開公寓', {
      inventory: [],
    })

    expect(ending?.id).toBe('ending_uneasy_departure')
  })

  it('沒有離開語意不觸發結局', () => {
    expect(
      inferEnding('003_friend_apartment_livingroom', '繼續調查木桌'),
    ).toBeUndefined()
  })
})
