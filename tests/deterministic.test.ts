import { describe, expect, it } from 'vitest'
import {
  createKeeperFallbackResponse,
  handleDeterministicInvestigationAction,
  handleDeterministicSceneTransition,
} from '../worker/core/deterministic'
import { inferEnding } from '../worker/core/ending'

describe('createKeeperFallbackResponse：額度耗盡提示', () => {
  const sceneNarration = { '003_friend_apartment_livingroom': ['一般罐頭敘事。'] }
  const genericNarration = ['通用罐頭敘事。']

  it('quotaExhausted 為 true 時附加 OOC 提示（一般場景分支）', () => {
    const response = createKeeperFallbackResponse(
      '003_friend_apartment_livingroom',
      '繼續調查沙發',
      sceneNarration,
      genericNarration,
      true,
    )

    expect(response.narration.join('')).toContain('額度冷卻中')
  })

  it('quotaExhausted 為 false（預設）時不附加提示', () => {
    const response = createKeeperFallbackResponse(
      '003_friend_apartment_livingroom',
      '繼續調查沙發',
      sceneNarration,
      genericNarration,
    )

    expect(response.narration.join('')).not.toContain('額度冷卻中')
  })

  it('quotaExhausted 為 true 時，未接聽電話分支同樣附加提示', () => {
    const response = createKeeperFallbackResponse(
      '003_friend_apartment_livingroom',
      '打電話給阿宏確認狀況',
      sceneNarration,
      genericNarration,
      true,
    )

    expect(response.narration.join('')).toContain('額度冷卻中')
  })
})

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

import { handleScriptedInvestigation } from '../worker/core/deterministic'
import { enforceDiscoveryConstraints } from '../worker/core/validate'

describe('handleScriptedInvestigation：木桌抽屜謎題', () => {
  it('第一次調查木桌：發現抽屜', () => {
    const response = handleScriptedInvestigation(
      '003_friend_apartment_livingroom',
      '查看客廳木桌上凌亂的文件與雜物',
      undefined,
      { flags: {} },
    )

    expect(response?.effects?.setFlags?.living_room_table_surface_examined).toBe(true)
    expect(response?.narration.join('')).toContain('木製抽屜')
  })

  it('拉開抽屜', () => {
    const response = handleScriptedInvestigation(
      '003_friend_apartment_livingroom',
      '拉開剛發現的寬大抽屜',
      undefined,
      { flags: { living_room_table_surface_examined: true } },
    )

    expect(response?.effects?.setFlags?.living_room_table_drawer_opened).toBe(true)
  })

  it('關抽屜聽到異響，標記隱藏空間', () => {
    const response = handleScriptedInvestigation(
      '003_friend_apartment_livingroom',
      '先關上抽屜，改查客廳其他地方',
      undefined,
      {
        flags: {
          living_room_table_surface_examined: true,
          living_room_table_drawer_opened: true,
        },
      },
    )

    expect(
      response?.effects?.setFlags?.living_room_table_hidden_space_suspected,
    ).toBe(true)
  })

  it('伸手調查隱藏空間：確定性地取得記憶卡與完整敘事', () => {
    const response = handleScriptedInvestigation(
      '003_friend_apartment_livingroom',
      '伸手調查抽屜後方的奇怪空間',
      { id: 'inspect-hidden-space-behind-drawer', label: '伸手調查抽屜後方的奇怪空間' },
      {
        flags: {
          living_room_table_surface_examined: true,
          living_room_table_drawer_opened: true,
          living_room_table_hidden_space_suspected: true,
        },
      },
    )

    expect(response?.effects?.addInventory).toEqual(['item_hidden_memory_card'])
    expect(response?.narration.join('')).toContain('microSD')
    expect(response?.actions.length).toBeGreaterThan(0)
  })

  it('已取得記憶卡後回訪抽屜：確定性回應已清空，不重複發放', () => {
    const response = handleScriptedInvestigation(
      '003_friend_apartment_livingroom',
      '再檢查一次抽屜',
      undefined,
      { inventory: ['item_hidden_memory_card'], flags: {} },
    )

    expect(response?.effects?.addInventory).toBeUndefined()
    expect(response?.narration.join('')).toContain('已經徹底翻過')
  })

  it('已取得記憶卡後，與抽屜無關的桌面回訪仍交給模型處理', () => {
    const response = handleScriptedInvestigation(
      '003_friend_apartment_livingroom',
      '再看一次桌上的信件',
      undefined,
      { inventory: ['item_hidden_memory_card'], flags: {} },
    )

    expect(response).toBeUndefined()
  })
})

describe('handleScriptedInvestigation：四樓門鎖', () => {
  it('持鑰匙第一次開門：開啟鐵門', () => {
    const response = handleScriptedInvestigation(
      '002_friend_apartment',
      '拿出備用鑰匙圈，嘗試打開外側紅色鐵門',
      undefined,
      { inventory: ['item_friend_apartment_spare_key'], flags: {} },
    )

    expect(response?.effects?.setFlags?.friend_apartment_iron_door_opened).toBe(true)
    expect(response?.effects?.nextSceneId).toBeUndefined()
  })

  it('鐵門已開再用鑰匙：開木門並進入客廳', () => {
    const response = handleScriptedInvestigation(
      '002_friend_apartment',
      '拿另一把鑰匙開啟後方木門',
      undefined,
      {
        inventory: ['item_friend_apartment_spare_key'],
        flags: { friend_apartment_iron_door_opened: true },
      },
    )

    expect(response?.effects?.nextSceneId).toBe('003_friend_apartment_livingroom')
    expect(response?.effects?.setFlags?.friend_apartment_wooden_door_opened).toBe(true)
  })
})

describe('enforceDiscoveryConstraints：記憶卡提前洩漏防護', () => {
  it('玩家尚未察覺隱藏空間時，模型擅自發放記憶卡會被擋下', () => {
    const constrained = enforceDiscoveryConstraints(
      {
        actions: [],
        checks: [],
        effects: {
          addInventory: ['item_hidden_memory_card'],
          discoverClues: ['神秘記憶卡'],
        },
        narration: ['模型自作主張的敘事。'],
      },
      '003_friend_apartment_livingroom',
      '隨便看看沙發',
      { flags: {} },
    )

    expect(constrained.effects?.addInventory).toEqual([])
    expect(constrained.effects?.discoverClues).toEqual([])
  })

  it('記憶卡已取得後，模型重演發現流程時附帶的線索也會被擋下（即使隱藏空間旗標已設）', () => {
    // addInventory 的重複發放已由 removeAlreadyOwnedInventory 擋下；
    // 這裡驗證的是舊版漏掉的另一半——discoverClues 沒有以擁有狀態去重，
    // 過去只要 hiddenSpaceWasSuspected 已是 true 就不再過濾，導致線索重複冒出。
    const constrained = enforceDiscoveryConstraints(
      {
        actions: [],
        checks: [],
        effects: {
          discoverClues: ['木桌抽屜後方的記憶卡'],
        },
        narration: ['模型重演一次發現流程的敘事。'],
      },
      '003_friend_apartment_livingroom',
      '再次伸手調查抽屜後方',
      {
        flags: {
          hidden_memory_card_found: true,
          living_room_table_hidden_space_suspected: true,
        },
        inventory: ['item_hidden_memory_card'],
      },
    )

    expect(constrained.effects?.discoverClues).toEqual([])
  })
})

describe('尋找讀卡設備不再死循環', () => {
  const stateWithCard = {
    flags: {},
    inventory: ['item_hidden_memory_card', '智慧型手機'],
  }

  it('在臥室尋找設備：直接找到書桌上的讀卡機', () => {
    const response = handleDeterministicInvestigationAction(
      '003_friend_bedroom',
      '尋找能讀取 microSD 的相容設備',
      { id: 'find-compatible-card-reader', label: '尋找能讀取 microSD 的相容設備' },
      stateWithCard,
    )

    expect(response?.effects?.addInventory).toContain('item_microsd_card_reader')
    expect(response?.actions.map((a) => a.id)).not.toContain(
      'find-compatible-card-reader',
    )
  })

  it('在客廳尋找設備：指路去臥室書桌，不重複同一選項', () => {
    const response = handleDeterministicInvestigationAction(
      '003_friend_apartment_livingroom',
      '尋找能讀取 microSD 的相容設備',
      { id: 'find-compatible-card-reader', label: '尋找能讀取 microSD 的相容設備' },
      stateWithCard,
    )

    expect(response?.effects?.addInventory).toBeUndefined()
    const ids = response?.actions.map((a) => a.id) ?? []
    expect(ids).toContain('go-to-bedroom-for-reader')
    expect(ids).not.toContain('find-compatible-card-reader')
    const moveAction = response?.actions.find((a) => a.id === 'go-to-bedroom-for-reader')
    expect(moveAction?.intent).toEqual({ to: '003_friend_bedroom', type: 'move' })
  })

  it('首次讀卡提示（非搜尋動作）維持原行為', () => {
    const response = handleDeterministicInvestigationAction(
      '003_friend_apartment_livingroom',
      '嘗試讀取記憶卡的內容',
      undefined,
      stateWithCard,
    )

    expect(response?.actions.map((a) => a.id)).toContain('find-compatible-card-reader')
  })
})

describe('阿陽在場時的記憶卡互動', () => {
  const officerPresentState = {
    flags: {
      officer_a_yang_arrived: true,
      officer_door_opened: true,
    },
    inventory: ['item_hidden_memory_card', '智慧型手機'],
  }

  it('遞卡給阿陽：腳本讓位給模型（依角色檔演出）', () => {
    expect(
      handleDeterministicInvestigationAction(
        '003_friend_apartment_livingroom',
        '將記憶卡遞給他，要求他用警用設備協助讀取，看看他是否會露出馬腳',
        undefined,
        officerPresentState,
      ),
    ).toBeUndefined()
  })

  it('與阿陽討論記憶卡內容：同樣交給模型', () => {
    expect(
      handleDeterministicInvestigationAction(
        '003_friend_apartment_livingroom',
        '拿著記憶卡的照片問他對房東不老有什麼看法，跟他討論',
        undefined,
        officerPresentState,
      ),
    ).toBeUndefined()
  })

  it('把手機螢幕轉向他展示記憶卡內容：同樣交給模型，不觸發重複讀卡腳本', () => {
    expect(
      handleDeterministicInvestigationAction(
        '003_friend_apartment_livingroom',
        '將手機螢幕轉向他，向他展示記憶卡裡不老的房東照片與四樓紀錄',
        undefined,
        {
          ...officerPresentState,
          flags: {
            ...officerPresentState.flags,
            memory_card_initial_files_opened: true,
          },
        },
      ),
    ).toBeUndefined()
  })

  it('阿陽在場時，自由輸入一律交給模型（即使措辭看似單純翻卡）', () => {
    const response = handleDeterministicInvestigationAction(
      '003_friend_apartment_livingroom',
      '自己接上讀卡機，讀取記憶卡的內容',
      undefined,
      officerPresentState,
    )

    expect(response).toBeUndefined()
  })

  it('阿陽在場但玩家點選腳本自己開出的翻卡按鈕：腳本流程照常', () => {
    const response = handleDeterministicInvestigationAction(
      '003_friend_apartment_livingroom',
      '自己接上讀卡機，讀取記憶卡的內容',
      {
        beliefSignal: 'rational_investigation',
        id: 'compare-memory-card-with-apartment',
        label: '把記憶卡照片與眼前住處格局互相比對',
      },
      {
        ...officerPresentState,
        flags: {
          ...officerPresentState.flags,
          memory_card_initial_files_opened: true,
        },
      },
    )

    expect(response).toBeDefined()
  })
})
