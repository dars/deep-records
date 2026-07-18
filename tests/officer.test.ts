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

import {
  computeWitnessReadiness,
  processEscortPacing,
  processOfficerDoorPhase,
  processOfficerHiddenPhase,
  witnessRipeThreshold,
} from '../worker/core/officer'
import { handleDeterministicInvestigationAction } from '../worker/core/deterministic'

describe('阿陽門外流程狀態機', () => {
  const arrivedFlags = { officer_a_yang_arrived: true }

  it('未登場或已進門時不啟動', () => {
    expect(
      processOfficerDoorPhase('003_friend_apartment_livingroom', '調查木桌', undefined, {
        flags: {},
      }),
    ).toBeUndefined()
    expect(
      processOfficerDoorPhase('003_friend_apartment_livingroom', '調查木桌', undefined, {
        flags: { ...arrivedFlags, officer_entered_with_key: true },
      }),
    ).toBeUndefined()
  })

  it('第 1 次不理：只記錄旗標，不搶佔回合', () => {
    const result = processOfficerDoorPhase(
      '003_friend_apartment_livingroom',
      '不理會敲門聲，繼續調查木桌',
      undefined,
      { flags: arrivedFlags },
    )

    expect(result?.preempt).toBeUndefined()
    expect(result?.markFlags).toEqual({ officer_wait_one: true, player_hiding: false })
  })

  it('第 2 次不理：搶佔回合加重語氣', () => {
    const result = processOfficerDoorPhase(
      '003_friend_apartment_livingroom',
      '繼續搜索臥室',
      undefined,
      { flags: { ...arrivedFlags, officer_wait_one: true } },
    )

    expect(result?.preempt?.effects?.setFlags?.officer_knock_escalated).toBe(true)
    expect(result?.preempt?.narration.join('')).toContain('妨礙公務')
  })

  it('第 3 次不理：拿房東鑰匙進門並要求配合', () => {
    const result = processOfficerDoorPhase(
      '004_friend_kitchen',
      '站在原地不出聲，等他離開',
      undefined,
      {
        flags: {
          ...arrivedFlags,
          officer_knock_escalated: true,
          officer_wait_one: true,
        },
      },
    )

    expect(result?.preempt?.effects?.setFlags?.officer_entered_with_key).toBe(true)
    expect(result?.preempt?.effects?.setFlags?.officer_door_opened).toBe(true)
    expect(result?.preempt?.narration.join('')).toContain('鑰匙')
    expect(result?.preempt?.narration.join('')).toContain('配合')
  })

  it('玩家開門：記錄旗標並交給模型', () => {
    const result = processOfficerDoorPhase(
      '003_friend_apartment_livingroom',
      '走向門口開門',
      undefined,
      { flags: arrivedFlags },
    )

    expect(result?.preempt).toBeUndefined()
    expect(result?.markFlags).toEqual({ officer_door_opened: true, player_hiding: false })
  })

  it('「先不開門」的否定語氣視為不理會', () => {
    const result = processOfficerDoorPhase(
      '003_friend_apartment_livingroom',
      '先不開門，把記憶卡藏起來',
      undefined,
      { flags: arrivedFlags },
    )

    // 藏「物品」不是藏自己，不得誤判為躲藏姿態。
    expect(result?.markFlags).toEqual({ officer_wait_one: true, player_hiding: false })
  })
})

describe('讀卡機設備判斷', () => {
  it('已開啟過記憶卡檔案後，讀取不再要求尋找設備', () => {
    const response = handleDeterministicInvestigationAction(
      '003_friend_bedroom',
      '再讀一次記憶卡裡的檔案',
      undefined,
      {
        flags: { memory_card_initial_files_opened: true },
        inventory: ['item_hidden_memory_card'],
      },
    )

    expect(
      response?.actions.some((action) => action.id === 'find-compatible-card-reader'),
    ).toBe(false)
    expect(response?.narration.join('')).toContain('資料夾')
  })
})

import { validateNextSceneId, ensureAvailableActions } from '../worker/core/validate'
import { normalizeEffects } from '../shared/keeper'

describe('場景脫鉤修復', () => {
  it('「逃向客廳」觸發臥室→客廳轉場（阿陽未登場時）', () => {
    const response = handleDeterministicSceneTransition(
      '003_friend_bedroom',
      '拼命逃向客廳',
      undefined,
      { flags: {} },
    )

    expect(response?.effects?.nextSceneId).toBe('003_friend_apartment_livingroom')
  })

  it('阿陽登場後（即使僅在門外）罐頭轉場全面停用', () => {
    const response = handleDeterministicSceneTransition(
      '003_friend_bedroom',
      '拼命逃向客廳',
      undefined,
      { flags: { officer_a_yang_arrived: true } },
    )

    expect(response).toBeUndefined()
  })

  it('阿陽已進屋後，罐頭轉場停用（交給模型連同他的存在一起敘事）', () => {
    const response = handleDeterministicSceneTransition(
      '003_friend_bedroom',
      '拼命逃向客廳',
      undefined,
      {
        flags: {
          officer_a_yang_arrived: true,
          officer_entered_with_key: true,
        },
      },
    )

    expect(response).toBeUndefined()
  })

  it('召喚或受制後可從建築內任何位置被押送至五樓（含一樓被捕）', () => {
    const summoned = {
      flags: { officer_a_yang_arrived: true, officer_escort_summons: true },
    }
    const restrained = {
      flags: { officer_a_yang_arrived: true, officer_player_restrained: true },
    }

    expect(
      validateNextSceneId('007_landlord_apartment', '003_friend_bedroom', summoned),
    ).toBe('007_landlord_apartment')
    expect(
      validateNextSceneId('007_landlord_apartment', '001_apartment_entrance', restrained),
    ).toBe('007_landlord_apartment')
  })

  it('登場但未召喚：模型不得自行推進五樓（硬守門）', () => {
    expect(
      validateNextSceneId('007_landlord_apartment', '003_friend_bedroom', {
        flags: { officer_a_yang_arrived: true },
      }),
    ).toBeUndefined()
  })

  it('總回合數保底：沒有任何里程碑也會觸發登場', () => {
    const response = handleOfficerArrival(
      '003_friend_apartment_livingroom',
      '站在窗邊看雨',
      undefined,
      { flags: {} },
      12,
    )

    expect(response?.effects?.setFlags?.officer_a_yang_arrived).toBe(true)

    expect(
      handleOfficerArrival(
        '003_friend_apartment_livingroom',
        '站在窗邊看雨',
        undefined,
        { flags: {} },
        11,
      ),
    ).toBeUndefined()
  })

  it('樓梯間登場視為正面接觸（officer_door_opened 一併設下）', () => {
    const response = handleOfficerArrival(
      '002_friend_apartment',
      '繼續檢查鐵門',
      undefined,
      { ...threeMilestonesState, currentSceneId: '002_friend_apartment' },
    )

    expect(response?.effects?.setFlags?.officer_door_opened).toBe(true)
  })

  it('阿陽未登場時，非連通場景仍不能前往五樓', () => {
    expect(
      validateNextSceneId('007_landlord_apartment', '003_friend_bedroom', { flags: {} }),
    ).toBeUndefined()
  })

  it('阿陽在場時的備援選項是對峙導向，不是調查', () => {
    const ensured = ensureAvailableActions(
      { actions: [], checks: [], narration: ['……'] },
      '003_friend_bedroom',
      '呆立原地',
      { flags: { officer_a_yang_arrived: true, officer_entered_with_key: true } },
    )

    expect(ensured.actions.length).toBeGreaterThan(0)
    expect(ensured.actions.every((a) => !/調查|查看.*物品/.test(a.label))).toBe(true)
  })

  it('五樓的備援選項同樣是對峙導向', () => {
    const ensured = ensureAvailableActions(
      { actions: [], checks: [], narration: ['……'] },
      '007_landlord_apartment',
      '呆立原地',
      { flags: {} },
    )

    expect(ensured.actions.some((a) => /脫身|反抗|觀察/.test(a.label))).toBe(true)
  })
})

describe('clearFlags 解除旗標', () => {
  it('clearFlags 合併為 setFlags 的 false 值（掙脫拘束）', () => {
    const effects = normalizeEffects({
      clearFlags: ['officer_player_restrained'],
      setFlags: ['some_new_flag'],
    })

    expect(effects?.setFlags).toEqual({
      officer_player_restrained: false,
      some_new_flag: true,
    })
  })
})

import {
  countRitualTurns,
  processRitualPacing,
  ritualGraceTurns,
} from '../worker/core/ritual'

describe('五樓終局節奏', () => {
  it('前三回合只記錄回合旗標，不搶佔', () => {
    const turn1 = processRitualPacing('007_landlord_apartment', { flags: {} })

    expect(turn1?.preempt).toBeUndefined()
    expect(turn1?.markFlags).toEqual({ fifth_floor_turn_1: true })

    const turn3 = processRitualPacing('007_landlord_apartment', {
      flags: { fifth_floor_turn_1: true, fifth_floor_turn_2: true },
    })

    expect(turn3?.markFlags).toEqual({ fifth_floor_turn_3: true })
  })

  it('超過寬限回合後，阿陽失去耐心並強制推進', () => {
    const result = processRitualPacing('007_landlord_apartment', {
      flags: {
        fifth_floor_turn_1: true,
        fifth_floor_turn_2: true,
        fifth_floor_turn_3: true,
      },
    })

    expect(result?.preempt?.effects?.setFlags?.ritual_forced_climax).toBe(true)
    expect(result?.preempt?.effects?.setFlags?.officer_player_restrained).toBe(true)
    expect(result?.preempt?.narration.join('')).toContain('耐性')
  })

  it('強制推進後不再重複觸發，交給模型收束', () => {
    expect(
      processRitualPacing('007_landlord_apartment', {
        flags: { ritual_forced_climax: true },
      }),
    ).toBeUndefined()
  })

  it('非五樓場景不啟動', () => {
    expect(
      processRitualPacing('003_friend_apartment_livingroom', { flags: {} }),
    ).toBeUndefined()
  })

  it('回合計數與寬限常數一致', () => {
    expect(ritualGraceTurns).toBe(3)
    expect(countRitualTurns({ flags: { fifth_floor_turn_1: true } })).toBe(1)
  })
})

describe('門邊互動的場景強制切換', () => {
  const arrivedFlags = { officer_a_yang_arrived: true }

  it('從臥室走向門口開門：場景強制切到客廳', () => {
    const result = processOfficerDoorPhase(
      '003_friend_bedroom',
      '走向門口開門',
      { id: 'answer-door-to-officer', label: '整理好身上的物品，走向門口應對' },
      { flags: arrivedFlags },
    )

    expect(result?.markFlags).toEqual({ officer_door_opened: true, player_hiding: false })
    expect(result?.forceSceneId).toBe('003_friend_apartment_livingroom')
  })

  it('已在客廳開門：不需要切場景', () => {
    const result = processOfficerDoorPhase(
      '003_friend_apartment_livingroom',
      '開門',
      undefined,
      { flags: arrivedFlags },
    )

    expect(result?.markFlags).toEqual({ officer_door_opened: true, player_hiding: false })
    expect(result?.forceSceneId).toBeUndefined()
  })

  it('從臥室隔著鐵門質問：切到客廳並記錄第一次未開門', () => {
    const result = processOfficerDoorPhase(
      '003_friend_bedroom',
      '隔著鐵門，要求他出示證件',
      { id: 'question-officer-through-door', label: '隔著鐵門，先確認對方的身分與來意' },
      { flags: arrivedFlags },
    )

    expect(result?.markFlags).toEqual({ officer_wait_one: true, player_hiding: false })
    expect(result?.forceSceneId).toBe('003_friend_apartment_livingroom')
  })

  it('躲在臥室保持安靜：不切場景', () => {
    const result = processOfficerDoorPhase(
      '003_friend_bedroom',
      '保持安靜，先不回應敲門聲',
      undefined,
      { flags: arrivedFlags },
    )

    expect(result?.markFlags).toEqual({ officer_wait_one: true, player_hiding: false })
    expect(result?.forceSceneId).toBeUndefined()
  })
})

describe('躲藏狀態機', () => {
  const enteredHidden = {
    officer_a_yang_arrived: true,
    officer_door_opened: true,
    officer_entered_with_key: true,
    player_hiding: true,
  }

  it('躲藏姿態在門外回合被記錄；進門時走隱藏視角變體', () => {
    const marked = processOfficerDoorPhase(
      '003_friend_bedroom',
      '躲進衣櫃不出聲',
      undefined,
      { flags: { officer_a_yang_arrived: true } },
    )
    expect(marked?.markFlags).toEqual({ officer_wait_one: true, player_hiding: true })

    const entry = processOfficerDoorPhase(
      '003_friend_bedroom',
      '繼續躲著',
      undefined,
      {
        flags: {
          officer_a_yang_arrived: true,
          officer_wait_one: true,
          officer_knock_escalated: true,
          player_hiding: true,
        },
      },
    )
    expect(entry?.preempt?.narration.join('')).toContain('你看不見他')
    expect(entry?.preempt?.actions.map((a) => a.id)).toEqual([
      'reveal-from-hiding',
      'stay-hidden',
    ])
  })

  it('躲藏期間調查被擋下，只剩現身／繼續躲', () => {
    const blocked = processOfficerHiddenPhase(
      '翻找書桌抽屜',
      undefined,
      { flags: enteredHidden },
    )
    expect(blocked?.actions.map((a) => a.id)).toEqual([
      'reveal-from-hiding',
      'stay-hidden',
    ])
    expect(blocked?.effects).toBeUndefined()
  })

  it('繼續躲第一次：對講機暗示；第二次：被筆直找到＋SAN 事件', () => {
    const first = processOfficerHiddenPhase(
      '屏住呼吸，繼續躲著不動',
      { id: 'stay-hidden', label: '屏住呼吸，繼續躲著不動' },
      { flags: enteredHidden },
    )
    expect(first?.effects?.setFlags?.officer_hidden_wait_one).toBe(true)

    const found = processOfficerHiddenPhase(
      '屏住呼吸，繼續躲著不動',
      { id: 'stay-hidden', label: '屏住呼吸，繼續躲著不動' },
      { flags: { ...enteredHidden, officer_hidden_wait_one: true } },
    )
    expect(found?.effects?.setFlags?.officer_found_hiding_player).toBe(true)
    expect(found?.effects?.setFlags?.player_hiding).toBe(false)
    expect(found?.effects?.sanityCheck?.eventFlag).toBe('san_checked_found_while_hiding')
    expect(found?.narration.join('')).toContain('筆直')
  })

  it('主動現身：清除躲藏、回到客廳對峙', () => {
    const reveal = processOfficerHiddenPhase(
      '深呼吸，主動從藏身處現身',
      { id: 'reveal-from-hiding', label: '深呼吸，主動從藏身處現身' },
      { flags: enteredHidden },
    )
    expect(reveal?.effects?.setFlags?.player_hiding).toBe(false)
    expect(reveal?.effects?.nextSceneId).toBe('003_friend_apartment_livingroom')
  })

  it('被找到後狀態機停用，交回一般對峙流程', () => {
    expect(
      processOfficerHiddenPhase('觀察阿陽', undefined, {
        flags: { ...enteredHidden, player_hiding: false, officer_found_hiding_player: true },
      }),
    ).toBeUndefined()
  })
})

describe('見證者熟成度與押送節奏', () => {
  const presentFlags = {
    officer_a_yang_arrived: true,
    officer_door_opened: true,
  }
  const ripeState = {
    belief: { stage: 'hypothesis' as const },
    discoveredClues: ['item_deep_sea_gold_brooch'],
    flags: { ...presentFlags, memory_card_initial_files_opened: true },
    sanity: { current: 50, lostToday: 3, starting: 55 },
  }

  it('熟成度計分：讀卡＋動搖＋信念＋線索', () => {
    expect(computeWitnessReadiness(ripeState)).toBeGreaterThanOrEqual(
      witnessRipeThreshold,
    )
    expect(computeWitnessReadiness({ flags: presentFlags })).toBe(0)
  })

  it('不熟：只累計在場回合旗標', () => {
    const result = processEscortPacing(
      '003_friend_apartment_livingroom',
      '回答他的問題',
      undefined,
      { flags: presentFlags },
    )

    expect(result?.preempt).toBeUndefined()
    expect(result?.markFlags).toEqual({ officer_stay_turn_1: true })
  })

  it('夠熟且問話已鋪陳兩回合：對講機召喚', () => {
    const result = processEscortPacing(
      '003_friend_apartment_livingroom',
      '繼續說明',
      undefined,
      {
        ...ripeState,
        flags: {
          ...ripeState.flags,
          officer_stay_turn_1: true,
          officer_stay_turn_2: true,
        },
      },
    )

    expect(result?.preempt?.effects?.setFlags?.officer_escort_summons).toBe(true)
    expect(result?.preempt?.narration.join('')).toContain('帶上來')
  })

  it('硬上限：不熟也召喚（房東等不及）', () => {
    const flags: Record<string, boolean> = { ...presentFlags }
    for (let i = 1; i <= 5; i += 1) {
      flags[`officer_stay_turn_${i}`] = true
    }

    const result = processEscortPacing(
      '003_friend_apartment_livingroom',
      '再看看客廳',
      undefined,
      { flags },
    )

    expect(result?.preempt?.effects?.setFlags?.officer_escort_summons).toBe(true)
  })

  it('召喚後任何行動都押送上五樓；抗拒者被制伏', () => {
    const summoned = {
      ...ripeState,
      flags: { ...ripeState.flags, officer_escort_summons: true },
    }

    const comply = processEscortPacing(
      '003_friend_apartment_livingroom',
      '跟著他往樓上走',
      undefined,
      summoned,
    )
    expect(comply?.preempt?.effects?.nextSceneId).toBe('007_landlord_apartment')
    expect(
      comply?.preempt?.effects?.setFlags?.officer_player_restrained,
    ).toBeUndefined()

    const resist = processEscortPacing(
      '003_friend_apartment_livingroom',
      '抗拒，表明自己哪裡都不去',
      undefined,
      summoned,
    )
    expect(resist?.preempt?.effects?.nextSceneId).toBe('007_landlord_apartment')
    expect(resist?.preempt?.effects?.setFlags?.officer_player_restrained).toBe(true)
  })

  it('躲藏或受制期間不啟動押送節奏', () => {
    expect(
      processEscortPacing('003_friend_bedroom', '繼續躲著', undefined, {
        flags: {
          ...presentFlags,
          officer_entered_with_key: true,
          player_hiding: true,
        },
      }),
    ).toBeUndefined()
    expect(
      processEscortPacing('003_friend_apartment_livingroom', '掙扎', undefined, {
        flags: { ...presentFlags, officer_player_restrained: true },
      }),
    ).toBeUndefined()
  })
})

describe('瘋狂濾鏡：腳本節點的失序變體', () => {
  const disorderedSanity = { current: 47, lostToday: 8, starting: 55 }

  it('失序玩家聽到的敲門不是人的敲門', () => {
    const response = handleOfficerArrival(
      '003_friend_apartment_livingroom',
      '站在原地',
      undefined,
      {
        flags: {
          hidden_memory_card_found: true,
          memory_card_initial_files_opened: true,
          star_spawn_idol_examined: true,
        },
        sanity: disorderedSanity,
      },
    )

    expect(response?.narration.join('')).toContain('濕重')
    expect(response?.effects?.setFlags?.officer_a_yang_arrived).toBe(true)
  })

  it('穩定玩家維持寫實敘事', () => {
    const response = handleOfficerArrival(
      '003_friend_apartment_livingroom',
      '站在原地',
      undefined,
      {
        flags: {
          hidden_memory_card_found: true,
          memory_card_initial_files_opened: true,
          star_spawn_idol_examined: true,
        },
        sanity: { current: 55, lostToday: 0, starting: 55 },
      },
    )

    expect(response?.narration.join('')).not.toContain('濕重')
  })

  it('失序召喚：對講機裡是水聲；機制旗標不變', () => {
    const result = processEscortPacing(
      '003_friend_apartment_livingroom',
      '喃喃自語',
      undefined,
      {
        flags: {
          officer_a_yang_arrived: true,
          officer_door_opened: true,
          officer_stay_turn_1: true,
          officer_stay_turn_2: true,
          memory_card_initial_files_opened: true,
        },
        sanity: disorderedSanity,
        belief: { stage: 'hypothesis' },
      },
    )

    expect(result?.preempt?.narration.join('')).toContain('水聲')
    expect(result?.preempt?.effects?.setFlags?.officer_escort_summons).toBe(true)
  })
})

import { applyHpZeroEnding } from '../worker/keeper'

describe('HP 歸零的無名屍結局', () => {
  const baseResponse = {
    actions: [{ id: 'a', label: '掙扎' }],
    checks: [],
    effects: { hitPointDelta: -4 },
    narration: ['阿陽的手肘壓上你的後頸。'],
  }

  it('傷害使 HP 歸零：強制 ending_buried_together', () => {
    const result = applyHpZeroEnding(baseResponse, {
      hitPoints: { current: 3, max: 11 },
      sanity: { current: 50, lostToday: 1, starting: 55 },
    })

    expect(result.effects?.endingId).toBe('ending_buried_together')
    expect(result.narration.length).toBeGreaterThan(1)
  })

  it('HP 仍為正：不觸發', () => {
    const result = applyHpZeroEnding(baseResponse, {
      hitPoints: { current: 8, max: 11 },
    })

    expect(result.effects?.endingId).toBeUndefined()
  })

  it('失序玩家的死亡敘事走瘋狂濾鏡', () => {
    const result = applyHpZeroEnding(baseResponse, {
      hitPoints: { current: 2, max: 11 },
      sanity: { current: 40, lostToday: 9, starting: 55 },
    })

    expect(result.narration.join('')).toContain('水聲')
  })
})
