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

  if (isNegatedMovement(actionText)) {
    return undefined
  }

  const inventory = new Set(state?.inventory ?? [])
  const flags = state?.flags ?? {}
  const rule = transitionRules.find(
    (candidate) =>
      candidate.from === sceneId &&
      candidate.pattern.test(actionText) &&
      (!candidate.requiresFlag || flags[candidate.requiresFlag] === true),
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
              label: '先走進公寓，沿樓梯前往四樓',
            },
            {
              beliefSignal: 'withhold_judgment',
              id: 'leave-after-unanswered-call',
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
