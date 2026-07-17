import { describe, expect, it } from 'vitest'
import { normalizeActionIntent, normalizeActions } from '../shared/keeper'
import { handleDeterministicSceneTransition } from '../worker/core/deterministic'
import { inferEnding } from '../worker/core/ending'
import { handleOfficerArrival } from '../worker/core/officer'
import { sanitizeKeeperRequest } from '../worker/core/sanitize'

describe('normalizeActionIntent', () => {
  it('接受合法意圖並丟棄無效輸入', () => {
    expect(normalizeActionIntent({ to: '002_friend_apartment', type: 'move' })).toEqual({
      to: '002_friend_apartment',
      type: 'move',
    })
    expect(normalizeActionIntent({ type: 'leave' })).toEqual({ type: 'leave' })
    expect(normalizeActionIntent({ type: 'call_police' })).toEqual({
      type: 'call_police',
    })
    expect(normalizeActionIntent({ type: 'none' })).toBeUndefined()
    expect(normalizeActionIntent({ type: 'move' })).toBeUndefined()
    expect(normalizeActionIntent({ type: 'hack' })).toBeUndefined()
    expect(normalizeActionIntent('move')).toBeUndefined()
  })

  it('normalizeActions 傳遞 intent', () => {
    const actions = normalizeActions([
      { id: 'x', intent: { to: '004_friend_kitchen', type: 'move' }, label: '去廚房' },
      { id: 'y', intent: { type: 'junk' }, label: '看看' },
    ])

    expect(actions[0].intent).toEqual({ to: '004_friend_kitchen', type: 'move' })
    expect(actions[1].intent).toBeUndefined()
  })

  it('sanitizeKeeperRequest 保留 selectedAction 的 intent', () => {
    const body = sanitizeKeeperRequest({
      selectedAction: {
        id: 'x',
        intent: { to: '004_friend_kitchen', type: 'move' },
        label: '去廚房',
      },
    })

    expect(body.selectedAction?.intent).toEqual({
      to: '004_friend_kitchen',
      type: 'move',
    })
  })
})

describe('intent 驅動的轉場', () => {
  it('label 完全不含關鍵字也能依 move intent 轉場', () => {
    const response = handleDeterministicSceneTransition(
      '003_friend_apartment_livingroom',
      '去那邊看看',
      {
        id: 'model-action',
        intent: { to: '003_friend_bedroom', type: 'move' },
        label: '去那邊看看',
      },
    )

    expect(response?.effects?.nextSceneId).toBe('003_friend_bedroom')
  })

  it('move intent 不受否定語氣誤傷', () => {
    const response = handleDeterministicSceneTransition(
      '003_friend_apartment_livingroom',
      '先不看客廳了，去臥室',
      {
        id: 'model-action',
        intent: { to: '003_friend_bedroom', type: 'move' },
        label: '先不看客廳了，去臥室',
      },
    )

    expect(response?.effects?.nextSceneId).toBe('003_friend_bedroom')
  })

  it('move intent 仍受 requiresFlag 限制（木門未開不能進客廳）', () => {
    const response = handleDeterministicSceneTransition(
      '002_friend_apartment',
      '進去',
      {
        id: 'model-action',
        intent: { to: '003_friend_apartment_livingroom', type: 'move' },
        label: '進去',
      },
      { flags: {} },
    )

    expect(response).toBeUndefined()
  })

  it('move intent 仍受 blockedByFlag 限制（阿陽登場後不能下樓）', () => {
    const response = handleDeterministicSceneTransition(
      '002_friend_apartment',
      '下去',
      {
        id: 'model-action',
        intent: { to: '001_apartment_entrance', type: 'move' },
        label: '下去',
      },
      { flags: { officer_a_yang_arrived: true } },
    )

    expect(response).toBeUndefined()
  })
})

describe('intent 驅動的結局與報警', () => {
  it('leave intent 不需離開關鍵字也觸發結局', () => {
    const ending = inferEnding('001_apartment_entrance', '算了', {
      flags: {},
      inventory: [],
    }, {
      id: 'model-action',
      intent: { type: 'leave' },
      label: '算了，今晚就到這裡',
    })

    expect(ending?.id).toBe('ending_ordinary_departure')
  })

  it('call_police intent 觸發阿陽到場', () => {
    const response = handleOfficerArrival(
      '003_friend_apartment_livingroom',
      '打電話求助',
      {
        id: 'model-action',
        intent: { type: 'call_police' },
        label: '打電話求助',
      },
      { flags: {} },
    )

    expect(response?.effects?.setFlags?.officer_a_yang_arrived).toBe(true)
  })

  it('leave intent 的選項含報警字眼時，走結局而非到場', () => {
    const response = handleOfficerArrival(
      '003_friend_apartment_livingroom',
      '離開這裡去報警',
      {
        id: 'model-action',
        intent: { type: 'leave' },
        label: '離開這裡去報警',
      },
      { flags: {} },
    )

    expect(response).toBeUndefined()
  })
})
