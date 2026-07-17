import { describe, expect, it } from 'vitest'
import { handleDeterministicSceneTransition } from '../worker/core/deterministic'
import { inferEnding } from '../worker/core/ending'
import {
  countSignificantInvestigations,
  handleOfficerArrival,
} from '../worker/core/officer'

const threeMilestonesState = {
  flags: {
    hidden_memory_card_found: true,
    memory_card_initial_files_opened: true,
    star_spawn_idol_examined: true,
  },
  inventory: ['item_hidden_memory_card'],
  visitedScenes: ['003_friend_apartment_livingroom'],
}

describe('countSignificantInvestigations', () => {
  it('以里程碑旗標與造訪房間計算實質調查次數', () => {
    expect(countSignificantInvestigations(undefined)).toBe(0)
    expect(countSignificantInvestigations(threeMilestonesState)).toBe(3)
    expect(
      countSignificantInvestigations({
        flags: { star_spawn_idol_examined: true },
        visitedScenes: ['003_friend_bedroom', '006_friend_balcony'],
      }),
    ).toBe(3)
  })
})

describe('handleOfficerArrival', () => {
  it('三次實質調查後，任意行動都會被到場搶佔並設下旗標', () => {
    const response = handleOfficerArrival(
      '003_friend_apartment_livingroom',
      '繼續調查沙發',
      undefined,
      threeMilestonesState,
    )

    expect(response?.effects?.setFlags?.officer_a_yang_arrived).toBe(true)
    expect(response?.narration.join('')).toContain('警察')
    expect(response?.actions.length).toBeGreaterThan(0)
  })

  it('調查不足三次且未報警時不觸發', () => {
    const response = handleOfficerArrival(
      '003_friend_apartment_livingroom',
      '繼續調查沙發',
      undefined,
      { flags: { star_spawn_idol_examined: true } },
    )

    expect(response).toBeUndefined()
  })

  it('玩家報警會立即觸發到場（不需調查次數）', () => {
    const response = handleOfficerArrival(
      '004_friend_kitchen',
      '拿出手機報警，請警方過來確認',
      undefined,
      { flags: {} },
    )

    expect(response?.effects?.setFlags?.officer_a_yang_arrived).toBe(true)
    expect(response?.effects?.setFlags?.officer_called_by_player).toBe(true)
  })

  it('「離開公寓去報警」屬於離開結局路線，不觸發到場', () => {
    const response = handleOfficerArrival(
      '003_friend_apartment_livingroom',
      '離開公寓去報警，把記憶卡交給警方',
      undefined,
      { flags: {} },
    )

    expect(response).toBeUndefined()
  })

  it('已登場後不重複觸發', () => {
    const response = handleOfficerArrival(
      '003_friend_apartment_livingroom',
      '繼續調查沙發',
      undefined,
      {
        ...threeMilestonesState,
        flags: { ...threeMilestonesState.flags, officer_a_yang_arrived: true },
      },
    )

    expect(response).toBeUndefined()
  })

  it('一樓入口與楔子不觸發', () => {
    expect(
      handleOfficerArrival('001_apartment_entrance', '報警', undefined, { flags: {} }),
    ).toBeUndefined()
    expect(
      handleOfficerArrival('000_prologue', '報警', undefined, { flags: {} }),
    ).toBeUndefined()
  })

  it('在四樓門外樓梯間觸發時使用樓梯間敘事', () => {
    const response = handleOfficerArrival(
      '002_friend_apartment',
      '繼續檢查鐵門',
      undefined,
      { ...threeMilestonesState, currentSceneId: '002_friend_apartment' },
    )

    expect(response?.narration.join('')).toContain('樓梯間')
    expect(response?.narration.join('')).not.toContain('敲了三下，力道規律')
  })
})

describe('阿陽登場後的封鎖', () => {
  const arrivedState = {
    flags: { officer_a_yang_arrived: true },
    inventory: ['item_hidden_memory_card'],
  }

  it('inferEnding 不再回傳任何離開結局', () => {
    expect(
      inferEnding('003_friend_apartment_livingroom', '離開公寓回家', arrivedState),
    ).toBeUndefined()
    expect(
      inferEnding('003_friend_apartment_livingroom', '離開公寓去報警，交出記憶卡', arrivedState),
    ).toBeUndefined()
  })

  it('002→001 的確定性下樓轉場停用，交給模型敘事', () => {
    const response = handleDeterministicSceneTransition(
      '002_friend_apartment',
      '沿樓梯下樓，回到一樓',
      undefined,
      { flags: { officer_a_yang_arrived: true } },
    )

    expect(response).toBeUndefined()
  })

  it('未登場時下樓轉場仍正常', () => {
    const response = handleDeterministicSceneTransition(
      '002_friend_apartment',
      '沿樓梯下樓，回到一樓',
      undefined,
      { flags: {} },
    )

    expect(response?.effects?.nextSceneId).toBe('001_apartment_entrance')
  })
})
