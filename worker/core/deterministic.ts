// 不需要 LLM 的確定性回應：場景移動與固定調查流程（信箱鑰匙、記憶卡讀取）。
import type {
  KeeperAction,
  KeeperRequestBody,
  KeeperResponse,
  KeeperWireState,
} from '../../shared/keeper'
import { isNegatedMovement, transitionRules } from '../config/transitions'

export function handleDeterministicSceneTransition(
  sceneId: string,
  playerAction: string,
  selectedAction?: KeeperAction,
  state?: KeeperWireState,
): KeeperResponse | undefined {
  const actionText = `${selectedAction?.label ?? ''}\n${playerAction}`
  const inventory = new Set(state?.inventory ?? [])
  const flags = state?.flags ?? {}
  const isRuleUsable = (candidate: (typeof transitionRules)[number]) =>
    candidate.from === sceneId &&
    (!candidate.requiresFlag || flags[candidate.requiresFlag] === true) &&
    (!candidate.blockedByFlag || flags[candidate.blockedByFlag] !== true)

  // 選項帶有明確移動意圖時直接依目的地執行，不需要比對 label 文字。
  // 沒有對應規則（或規則被旗標擋下）時交給模型，仍受 validateNextSceneId 守門。
  const intent = selectedAction?.intent
  const rule =
    intent?.type === 'move'
      ? transitionRules.find(
          (candidate) => isRuleUsable(candidate) && candidate.to === intent.to,
        )
      : isNegatedMovement(actionText)
        ? undefined
        : transitionRules.find(
            (candidate) => isRuleUsable(candidate) && candidate.pattern.test(actionText),
          )

  if (!rule) {
    return undefined
  }

  const result = rule.build({
    hasItem: (itemId) => inventory.has(itemId),
    state,
  })

  return {
    actions: result.actions,
    checks: [],
    effects: {
      nextSceneId: rule.to,
    },
    narration: result.narration,
    observation: {
      reason: result.reason,
      signal: 'none',
    },
  }
}

export function handleDeterministicInvestigationAction(
  sceneId: string,
  playerAction: string,
  selectedAction?: KeeperAction,
  state?: KeeperWireState,
  character?: KeeperRequestBody['character'],
): KeeperResponse | undefined {
  const actionText = `${selectedAction?.label ?? ''}\n${playerAction}`
  const inventory = new Set(state?.inventory ?? [])
  const flags = state?.flags ?? {}

  if (
    sceneId === '001_apartment_entrance' &&
    /(?:信箱|郵箱|備用鑰匙|鑰匙圈|阿宏.*鑰匙|朋友.*鑰匙)/.test(actionText)
  ) {
    const hasSpareKeyring = inventory.has('item_friend_apartment_spare_key')

    if (hasSpareKeyring) {
      return {
        actions: [
          {
            beliefSignal: 'none',
            id: 'return-to-fourth-floor-with-spare-key',
            intent: { to: '002_friend_apartment', type: 'move' },
            label: '收起鑰匙圈，重新上樓前往四樓阿宏住處',
          },
          {
            beliefSignal: 'rational_investigation',
            id: 'inspect-entrance-after-key-check',
            label: '在一樓入口再確認門牌、樓梯與周遭痕跡',
          },
        ],
        checks: [],
        narration: [
          '你再次拉開阿宏對應的一樓信箱。裡面只剩被雨氣浸軟邊角的廣告傳單與幾封尚未取走的信件，沒有第二只夾鏈袋，也沒有新的鑰匙。',
          '那只掛著兩把鑰匙的備用鑰匙圈已經在你身上。信箱只能確認一件事：阿宏確實把這裡當成你進入住處的方式，而這條線索已經被你取走。',
        ],
        observation: {
          reason: '玩家回頭確認已取走備用鑰匙的一樓信箱。',
          signal: 'rational_investigation',
        },
      }
    }

    return {
      actions: [
        {
          beliefSignal: 'none',
          id: 'go-upstairs-with-spare-key',
          intent: { to: '002_friend_apartment', type: 'move' },
          label: '收好備用鑰匙圈，沿樓梯前往四樓阿宏住處',
        },
        {
          beliefSignal: 'rational_investigation',
          id: 'inspect-mailbox-letters-after-key',
          label: '先查看信箱裡剩下的信件與廣告傳單',
        },
        {
          beliefSignal: 'withhold_judgment',
          id: 'inspect-entrance-after-finding-key',
          label: '在入口處再確認門牌、樓梯與公寓狀況',
        },
      ],
      checks: [],
      effects: {
        addInventory: ['item_friend_apartment_spare_key'],
        setFlags: {
          friend_apartment_spare_key_found: true,
        },
      },
      narration: [
        '你走到一樓入口旁那排老舊金屬信箱前。幾個信箱用奇異筆寫著姓氏，褪色廣告貼紙貼在鏽斑旁邊，被雨氣泡得邊角微微翹起。',
        '阿宏對應的信箱沒有上鎖。你撥開最外側的廣告傳單與幾封尚未取走的信件，在內側摸到一只小型透明夾鏈袋。',
        '袋裡掛著兩把住家鑰匙。它們普通、冰冷，沒有任何異樣；但在這個時間點，它們就是你進入四樓住處最直接的方式。',
      ],
      observation: {
        reason: '玩家依照朋友提過的方式查看一樓信箱並取得備用鑰匙圈。',
        signal: 'rational_investigation',
      },
    }
  }

  const mentionsMemoryCard = /(?:記憶卡|micro ?sd|讀卡機|card reader)/i.test(actionText)
  const isReadingMemoryCard =
    mentionsMemoryCard &&
    /(?:讀取|查看|打開|瀏覽|連接|接上|插入|解鎖|筆電|電腦|手機|檔案|資料)/i.test(
      actionText,
    )

  if (!isReadingMemoryCard) {
    return undefined
  }

  const hasMemoryCard = inventory.has('item_hidden_memory_card')
  const hasCardReader =
    inventory.has('item_microsd_card_reader') ||
    /讀卡機|轉接器|card reader/i.test(actionText)
  const isSoftwareEngineer =
    character?.occupation === 'occupation_software_engineer' ||
    character?.occupation === 'software_engineer' ||
    character?.occupation === '軟體工程師'
  const usesAvailableDevice =
    hasCardReader ||
    isSoftwareEngineer ||
    /(?:手機|智慧型手機|筆電|電腦|micro ?sd.*槽|讀卡槽)/i.test(actionText)

  if (!hasMemoryCard) {
    return {
      actions: [
        {
          beliefSignal: 'rational_investigation',
          id: 'continue-search-for-memory-card-source',
          label: '先確認目前手上有哪些實際取得的物品',
        },
        {
          beliefSignal: 'withhold_judgment',
          id: 'return-to-current-room-search',
          label: '暫時放下讀取念頭，繼續搜索眼前空間',
        },
      ],
      checks: [],
      narration: [
        '你先確認身上的物品。要讀取那張 microSD，至少得先確定它真的已經在你手裡。',
        '現在最穩妥的做法不是憑印象跳到檔案內容，而是回到已經看見的線索與物品，確認哪一件東西能被實際取得。',
      ],
      observation: {
        reason: '玩家嘗試讀取尚未取得的記憶卡。',
        signal: 'rational_investigation',
      },
    }
  }

  if (!usesAvailableDevice) {
    return {
      actions: [
        {
          beliefSignal: 'rational_investigation',
          id: 'find-compatible-card-reader',
          label: '尋找能讀取 microSD 的相容設備',
        },
        {
          beliefSignal: 'withhold_judgment',
          id: 'keep-memory-card-for-later',
          label: '先收好記憶卡，繼續調查住處',
        },
      ],
      checks: [],
      narration: [
        '記憶卡本身沒有上鎖，但它仍只是一片細小的 microSD。你需要相容的手機、讀卡機或具備讀卡槽的筆電，才能看見裡面到底存了什麼。',
        '透明卡盒在指尖發出輕微塑膠摩擦聲。那張便條紙上的字仍然清楚：「我已經來不及了。裡面記載的所有事實，請傳出去。」',
      ],
      observation: {
        reason: '玩家已有記憶卡，但尚未具備明確讀取設備。',
        signal: 'rational_investigation',
      },
    }
  }

  if (flags.memory_card_initial_files_opened === true) {
    return {
      actions: [
        {
          beliefSignal: 'rational_investigation',
          id: 'inspect-memory-card-old-photos',
          label: '逐一查看最早的一批四樓照片',
        },
        {
          beliefSignal: 'rational_investigation',
          id: 'compare-memory-card-with-apartment',
          label: '把記憶卡照片與眼前住處格局互相比對',
        },
        {
          beliefSignal: 'withhold_judgment',
          id: 'stop-reading-memory-card-for-now',
          label: '暫停瀏覽檔案，先回到房內調查',
        },
      ],
      checks: [],
      narration: [
        '記憶卡的資料夾仍停在螢幕上。檔案沒有加密，也沒有要求新的密碼；真正讓人遲疑的是那些互相矛盾的日期、縮圖與房間角度。',
        '你已經打開了第一層檔案。接下來要做的是選擇先看哪一批內容，而不是重新確認它是否能被讀取。',
      ],
      observation: {
        reason: '玩家重複讀取已打開的記憶卡初始檔案。',
        signal: 'rational_investigation',
      },
    }
  }

  return {
    actions: [
      {
        beliefSignal: 'rational_investigation',
        id: 'inspect-memory-card-old-photos',
        label: '逐一查看最早的一批四樓照片',
      },
      {
        beliefSignal: 'withhold_judgment',
        id: 'scan-memory-card-file-list',
        label: '先只瀏覽檔名與時間戳，不打開影片',
      },
      {
        beliefSignal: 'rational_investigation',
        id: 'compare-memory-card-with-apartment',
        label: '把記憶卡照片與眼前住處格局互相比對',
      },
    ],
    checks: [],
    effects: {
      discoverClues: ['記憶卡內的四樓影像紀錄'],
      setFlags: {
        memory_card_initial_files_opened: true,
      },
    },
    narration: [
      '記憶卡接上後，螢幕短暫停頓。沒有解密畫面，沒有密碼提示，只有幾個被粗略命名的資料夾慢慢跳出來。',
      '最上層的檔案不像單純備份。照片、短影片、掃描圖與幾個無法立即辨認用途的文字檔混在一起；有些建立時間早得不合常理，有些縮圖則像是在主檔案產生以前就已存在。',
      '第一批縮圖都指向四樓。畫面裡的家具、牆角與門窗位置和你所在的租屋處能對得上，但影像年代彼此差異很大。某些東西被更換過，某些東西卻像從很久以前就一直留在同一個位置。',
    ],
    observation: {
      reason: '玩家使用可用設備讀取已取得的記憶卡。',
      signal: 'rational_investigation',
    },
  }
}

export function createKeeperFallbackResponse(
  sceneId: string,
  playerAction: string,
  sceneNarration: Record<string, string[]>,
  genericNarration: string[],
): KeeperResponse {
  if (
    /(?:打電話|撥打|撥電話|致電|聯絡|打給)/.test(playerAction) &&
    /(?:阿宏|朋友|林憲宏)/.test(playerAction)
  ) {
    const actions: KeeperAction[] =
      sceneId === '001_apartment_entrance'
        ? [
            {
              beliefSignal: 'rational_investigation',
              id: 'inspect-mailboxes-after-unanswered-call',
              label: '查看阿宏提過的一樓信箱',
            },
            {
              beliefSignal: 'none',
              id: 'enter-building-after-unanswered-call',
              intent: { to: '002_friend_apartment', type: 'move' },
              label: '先走進公寓，沿樓梯前往四樓',
            },
            {
              beliefSignal: 'withhold_judgment',
              id: 'leave-after-unanswered-call',
              intent: { type: 'leave' },
              label: '不再繼續介入，轉身離開公寓',
            },
          ]
        : [
            {
              beliefSignal: 'rational_investigation',
              id: 'continue-search-after-unanswered-call',
              label: '收起手機，繼續調查阿宏的住處',
            },
            {
              beliefSignal: 'withhold_judgment',
              id: 'review-message-after-unanswered-call',
              label: '重新查看阿宏最後傳來的簡訊',
            },
            {
              beliefSignal: 'none',
              id: 'leave-after-unanswered-call',
              intent: { type: 'leave' },
              label: '放棄等待，循原路離開公寓',
            },
          ]

    return {
      actions,
      checks: [],
      effects: {
        setFlags: { called_a_hong_no_answer: true },
      },
      narration: [
        '電話撥出去後，聽筒裡只傳來規律而單調的等待音。鈴聲持續了很久，阿宏始終沒有接聽，也沒有把電話按掉。',
        '通話最後自行轉入無人接聽。深夜的雨聲重新佔據四周；他才剛傳訊息要你過來，現在卻像突然失去了回應能力。',
      ],
      observation: {
        reason: '玩家先嘗試以日常通訊方式確認朋友狀況。',
        signal: 'rational_investigation',
      },
    }
  }

  return {
    actions: [],
    checks: [],
    effects: {},
    narration: sceneNarration[sceneId] ?? genericNarration,
    observation: {
      signal: 'none',
    },
  }
}

// 劇本腳本流程：條件成立時完全不需要模型，直接回覆固定敘事。
// 這些回合的敘事與效果都是確定的，交給模型只會增加延遲與失敗風險。
export function handleScriptedInvestigation(
  sceneId: string,
  playerAction: string,
  selectedAction?: KeeperAction,
  state?: KeeperWireState,
): KeeperResponse | undefined {
  const actionText = `${selectedAction?.label ?? ''}\n${playerAction}`
  const inventory = new Set(state?.inventory ?? [])
  const flags = state?.flags ?? {}
  const hasSpareKeyring = inventory.has('item_friend_apartment_spare_key')
  const ironDoorWasOpened = flags.friend_apartment_iron_door_opened === true
  const attemptsApartmentUnlock =
    /(?:鑰匙|開鎖|開門|解鎖)/.test(actionText) &&
    /(?:鐵門|木門|大門|住處|進屋|門)/.test(actionText)

  if (
    sceneId === '002_friend_apartment' &&
    hasSpareKeyring &&
    !ironDoorWasOpened &&
    attemptsApartmentUnlock
  ) {
    return {
      actions: [
        {
          beliefSignal: 'rational_investigation',
          id: 'unlock-inner-wooden-door',
          label: '拿另一把鑰匙開啟後方木門',
        },
        {
          beliefSignal: 'rational_investigation',
          id: 'inspect-space-between-doors',
          label: '先檢查兩道門之間與木門鎖孔',
        },
        {
          beliefSignal: 'withhold_judgment',
          id: 'step-back-from-friend-door',
          label: '暫時不開木門，退回公共樓梯間',
        },
      ],
      checks: [],
      effects: {
        setFlags: {
          friend_apartment_iron_door_opened: true,
        },
      },
      narration: [
        '透明夾鏈袋裡不是單獨一把鑰匙，而是一只掛著兩把鑰匙的小鑰匙圈。你逐一試過後，其中一把順利插進外側紅色鐵門的鎖孔。',
        '鏽蝕鐵門伴著沉重金屬聲向外開啟，露出後方仍然緊閉的木門。兩道門之間只隔著狹窄一步；屋內尚未打開，只有樓梯間的濕氣停留在門前。',
      ],
      observation: {
        reason: '玩家使用備用鑰匙開啟外側鐵門。',
        signal: 'rational_investigation',
      },
    }
  }

  if (
    sceneId === '002_friend_apartment' &&
    hasSpareKeyring &&
    ironDoorWasOpened &&
    attemptsApartmentUnlock
  ) {
    return {
      actions: [
        {
          beliefSignal: 'rational_investigation',
          id: 'inspect-living-room-table',
          label: '先查看客廳木桌上凌亂的文件與雜物',
        },
        {
          beliefSignal: 'rational_investigation',
          id: 'survey-living-room',
          label: '環顧客廳，確認還有哪些物品值得調查',
        },
        {
          beliefSignal: 'withhold_judgment',
          id: 'step-back-to-apartment-door',
          intent: { to: '002_friend_apartment', type: 'move' },
          label: '暫時退回玄關與門口，確認退路',
        },
      ],
      checks: [],
      effects: {
        nextSceneId: '003_friend_apartment_livingroom',
        setFlags: {
          friend_apartment_wooden_door_opened: true,
        },
      },
      narration: [
        '你換上鑰匙圈上的另一把鑰匙。這一次，後方木門的鎖芯在短暫阻滯後鬆開，門板向內退開一道縫。',
        '一股被封在屋內的濕冷氣味迎面湧出。那不是單純的霉味，空氣裡帶著濃重鹹味，混合腐敗海產、積水與潮濕污泥般的腥臭。',
        '你跨過門檻，鞋底在玄關磁磚上短暫黏住，又被迫剝離。玄關往內連著客廳；熟悉的沙發、木桌與過大的電視都在昏暗光線裡安靜地等著。',
      ],
      observation: {
        reason: '玩家使用備用鑰匙開啟木門並進入屋內。',
        signal: 'rational_investigation',
      },
    }
  }

  return handleLivingRoomTablePuzzle(sceneId, actionText, state)
}

// 客廳木桌抽屜的多段式發現流程：桌面 → 抽屜 → 察覺深度異常 → 取得記憶卡。
function handleLivingRoomTablePuzzle(
  sceneId: string,
  actionText: string,
  state?: KeeperWireState,
): KeeperResponse | undefined {
  if (
    sceneId !== '003_friend_apartment_livingroom' ||
    !/木桌|桌子|抽屜/.test(actionText)
  ) {
    return undefined
  }

  const flags = state?.flags ?? {}
  const tableWasExamined = flags.living_room_table_surface_examined === true
  const drawerWasOpened = flags.living_room_table_drawer_opened === true
  const hiddenSpaceWasSuspected =
    flags.living_room_table_hidden_space_suspected === true
  const memoryCardWasFound =
    flags.hidden_memory_card_found === true ||
    state?.inventory?.includes('item_hidden_memory_card') === true
  const closesDrawer = /關上|關起|關閉|推回|闔上/.test(actionText)
  const opensDrawer = /打開|拉開|抽開/.test(actionText)
  const removesDrawer = /完全抽出|整個抽出|完全拉出|整個拉出|拆出|取出抽屜/.test(
    actionText,
  )
  const investigatesHiddenSpace =
    /後方空間|奇怪空間|隱藏空間|抽屜後|桌身深處|伸手.*後方|摸索.*後方/.test(
      actionText,
    )
  const investigatesDrawer =
    /調查抽屜|檢查抽屜|翻找抽屜|移開雜物|檢查木軌|比較.*深度|量.*深度|抽屜深處/.test(
      actionText,
    )

  if (memoryCardWasFound) {
    // 已取得記憶卡後的回訪交給模型敘事；重複發放由守門邏輯擋下。
    return undefined
  }

  if (!tableWasExamined) {
    return {
      actions: [
        {
          beliefSignal: 'rational_investigation',
          id: 'open-living-room-table-drawer',
          label: '拉開剛發現的寬大抽屜',
        },
        {
          beliefSignal: 'rational_investigation',
          id: 'inspect-table-documents',
          label: '查看桌上的信件與工作文件',
        },
        {
          beliefSignal: 'withhold_judgment',
          id: 'leave-table-for-now',
          label: '暫時不動桌子，改查客廳其他地方',
        },
      ],
      checks: [],
      effects: {
        setFlags: {
          living_room_table_surface_examined: true,
        },
      },
      narration: [
        '你移開桌面上散亂的信件、工作文件、零食與啤酒罐，沿著刮痕累累的桌緣仔細查看。這些凌亂更像長期生活留下的痕跡，不像有人匆忙翻找過。',
        '彎身檢查桌身時，你才注意到桌面下方嵌著一個寬大的木製抽屜。抽屜仍然關著，從外面看不出裡頭放了什麼。',
      ],
      observation: {
        reason: '玩家開始調查客廳木桌。',
        signal: 'rational_investigation',
      },
    }
  }

  if (hiddenSpaceWasSuspected && (investigatesHiddenSpace || removesDrawer)) {
    return {
      actions: [
        {
          beliefSignal: 'rational_investigation',
          id: 'read-memory-card-now',
          label: '拿出可用的設備，立刻嘗試讀取這張記憶卡',
        },
        {
          beliefSignal: 'withhold_judgment',
          id: 'pocket-memory-card-for-now',
          label: '先把記憶卡收好，繼續調查客廳',
        },
        {
          beliefSignal: 'rational_investigation',
          id: 'recheck-hidden-space',
          label: '再檢查一次夾層空間，確認沒有其他東西',
        },
      ],
      checks: [],
      effects: {
        addInventory: ['item_hidden_memory_card'],
        discoverClues: ['木桌抽屜後方的記憶卡'],
        setFlags: {
          hidden_memory_card_found: true,
          living_room_table_drawer_opened: true,
          living_room_table_hidden_space_suspected: true,
        },
      },
      narration: [
        '你重新把抽屜整個抽出，將手伸進桌身深處那段不該存在的空間。指尖越過木軌末端，在積灰的夾層底板上觸到一個以膠帶固定的小型硬物。',
        '撕下膠帶，那是一個透明的記憶卡盒，裡面躺著一張 microSD。卡盒外纏著一張折疊過的便條紙，字跡倉促卻仍能辨認：「我已經來不及了。裡面記載的所有事實，請傳出去。」',
        '阿宏把它藏得這麼深，顯然不打算讓隨手翻找的人發現。這張卡片此刻安靜地停在你的掌心，比屋內任何東西都更像他留下的最後訊息。',
      ],
      observation: {
        reason: '玩家依據抽屜深度與異響線索，找到藏在夾層裡的記憶卡。',
        signal: 'rational_investigation',
      },
    }
  }

  if (!drawerWasOpened && (opensDrawer || /抽屜/.test(actionText))) {
    return {
      actions: [
        {
          beliefSignal: 'rational_investigation',
          id: 'inspect-open-table-drawer',
          label: '移開雜物，仔細調查抽屜內部',
        },
        {
          beliefSignal: 'rational_investigation',
          id: 'inspect-drawer-contents',
          label: '逐一查看抽屜裡的生活雜物',
        },
        {
          beliefSignal: 'withhold_judgment',
          id: 'close-table-drawer',
          label: '先關上抽屜，改查客廳其他地方',
        },
      ],
      checks: [],
      effects: {
        setFlags: {
          living_room_table_drawer_opened: true,
        },
      },
      narration: [
        '寬大的抽屜拉開時有些卡頓，木軌摩擦出乾澀聲響。裡頭塞著指甲剪、面紙、開瓶器、打火機與幾樣隨手收進去的生活雜物。',
        '這些東西沒有特別整理，彼此疊壓在一起。單純把抽屜拉開，還看不出它與普通雜物抽屜有什麼不同。',
      ],
      observation: {
        reason: '玩家拉開木桌抽屜。',
        signal: 'rational_investigation',
      },
    }
  }

  if (drawerWasOpened && closesDrawer) {
    return {
      actions: [
        {
          beliefSignal: 'rational_investigation',
          id: 'reopen-drawer-after-noise',
          label: '重新拉開抽屜，調查聲音傳出的後方空間',
        },
        {
          beliefSignal: 'rational_investigation',
          id: 'inspect-table-back-after-noise',
          label: '從桌子外側確認抽屜後方是否留有空間',
        },
        {
          beliefSignal: 'withhold_judgment',
          id: 'leave-noisy-drawer-alone',
          label: '暫時不碰抽屜，改查客廳其他地方',
        },
      ],
      checks: [],
      effects: {
        setFlags: {
          living_room_table_drawer_noise_heard: true,
          living_room_table_drawer_opened: false,
          living_room_table_hidden_space_suspected: true,
        },
      },
      narration: [
        '你把抽屜推回桌身。就在它快要完全閉合時，木桌深處傳出一聲短促而悶住的異響，不像木軌摩擦，更像薄塑膠被抽屜後緣擠壓了一下。',
        '抽屜最後仍能關上，但那個聲音顯示它後方碰到了某樣不該存在的東西。從正面看去，桌身依舊沒有任何開口。',
      ],
      observation: {
        reason: '玩家關抽屜時聽見後方異響。',
        signal: 'rational_investigation',
      },
    }
  }

  if (drawerWasOpened && !hiddenSpaceWasSuspected && (investigatesDrawer || investigatesHiddenSpace || removesDrawer)) {
    return {
      actions: [
        {
          beliefSignal: 'rational_investigation',
          id: 'inspect-hidden-space-behind-drawer',
          label: '伸手調查抽屜後方的奇怪空間',
        },
        {
          beliefSignal: 'rational_investigation',
          id: 'remove-drawer-after-depth-check',
          label: '把抽屜整個抽出來查看後方',
        },
        {
          beliefSignal: 'withhold_judgment',
          id: 'close-drawer-after-depth-check',
          label: '先關上抽屜，聽聽是否會碰到後方物體',
        },
      ],
      checks: [],
      effects: {
        setFlags: {
          living_room_table_drawer_opened: true,
          living_room_table_hidden_space_suspected: true,
        },
      },
      narration: [
        '你把雜物移開，沿著抽屜內壁與木軌慢慢檢查。抽屜底板本身沒有夾層，但它的內部深度明顯比木桌外側量起來短了一截。',
        '從木軌末端與桌身陰影判斷，抽屜後方似乎還留著一小段正常使用時看不見的空間。裡面是否真的有東西，仍得伸手確認或把抽屜完全取出。',
      ],
      observation: {
        reason: '玩家發現抽屜深度與桌身不符。',
        signal: 'rational_investigation',
      },
    }
  }

  return undefined
}
