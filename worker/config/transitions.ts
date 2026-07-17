// 確定性場景轉場表：玩家明確表達移動意圖時，不經過 LLM 直接回應。
// 每條規則的 to 都必須存在於 from 場景 frontmatter 的 connects_to（由測試驗證）。
import type { KeeperAction, KeeperWireState } from '../../shared/keeper'

export type TransitionContext = {
  hasItem: (itemId: string) => boolean
  state?: KeeperWireState
}

export type TransitionResult = {
  actions: KeeperAction[]
  narration: string[]
  reason: string
}

export type TransitionRule = {
  // 此旗標為 true 時停用該規則（例如阿陽登場後，下樓的固定敘事會與公寓封鎖矛盾，
  // 改交給模型依 officer_a_yang.md 敘事）。
  blockedByFlag?: string
  build: (context: TransitionContext) => TransitionResult
  from: string
  pattern: RegExp
  requiresFlag?: string
  to: string
}

export function isNegatedMovement(actionText: string) {
  return /不(?:想|要|打算)?(?:去|進|進入|前往|走向|回到|返回|上樓)|暫時不|先不/.test(
    actionText,
  )
}

export const transitionRules: TransitionRule[] = [
  {
    from: '001_apartment_entrance',
    to: '002_friend_apartment',
    pattern:
      /(?:上樓|四樓|朋友(?:的)?住處|阿宏(?:的)?住處|租屋處|朝四樓|往上走|沿著.*樓梯.*上|前往四樓|重新上樓)/,
    build: ({ hasItem }) => {
      const hasSpareKeyring = hasItem('item_friend_apartment_spare_key')
      const keyReminder = hasSpareKeyring
        ? '備用鑰匙圈在口袋裡隨著步伐輕輕碰撞，兩把鑰匙發出短促而乾澀的金屬聲。'
        : '你尚未確認備用鑰匙是否在身上；這個念頭在每一層樓轉角都短暫浮起，又被樓梯間的濕冷壓回去。'

      return {
        actions: [
          {
            beliefSignal: 'rational_investigation',
            id: 'inspect-fourth-floor-door',
            label: '檢查四樓阿宏住處的紅色鐵門與門縫痕跡',
          },
          hasSpareKeyring
            ? {
                beliefSignal: 'none',
                id: 'unlock-fourth-floor-iron-door',
                label: '拿出備用鑰匙圈，嘗試打開外側紅色鐵門',
              }
            : {
                beliefSignal: 'withhold_judgment',
                id: 'return-downstairs-for-spare-key',
                intent: { to: '001_apartment_entrance', type: 'move' },
                label: '先回一樓確認阿宏提過的備用鑰匙',
              },
          {
            beliefSignal: 'withhold_judgment',
            id: 'listen-at-fourth-floor-door',
            label: '靠近門口，先聽屋內是否有任何聲響',
          },
        ],
        narration: [
          `你離開一樓信箱與入口的昏暗光線，沿著狹窄樓梯往上走。牆面濕氣讓扶手摸起來冰冷，腳步聲在樓梯井裡一層層往上疊開。${keyReminder}`,
          '四樓比一樓更安靜。你在熟悉的門牌前停下，眼前是那扇嚴重腐蝕的紅色鐵門；門縫下方有一段黑色乾涸痕跡，像是曾經從屋內緩慢滲出。',
        ],
        reason: '玩家從一樓明確前往四樓朋友住處。',
      }
    },
  },
  {
    blockedByFlag: 'officer_a_yang_arrived',
    from: '002_friend_apartment',
    to: '001_apartment_entrance',
    pattern: /(?:下樓|回到一樓|返回一樓|回樓下|離開公寓|回到入口|返回入口|公寓門口)/,
    build: () => ({
      actions: [
        {
          beliefSignal: 'rational_investigation',
          id: 'inspect-entrance-after-return',
          label: '重新確認一樓入口、信箱與樓梯間的狀況',
        },
        {
          beliefSignal: 'none',
          id: 'return-to-fourth-floor-from-entrance',
          intent: { to: '002_friend_apartment', type: 'move' },
          label: '沿著樓梯回到四樓阿宏住處門口',
        },
      ],
      narration: [
        '你暫時離開四樓門口，沿著狹窄樓梯往下走。樓梯間的濕氣一路貼著牆面，腳步聲被雨夜壓得很低。',
        '回到一樓時，入口、信箱與昏黃燈管仍維持原狀。外頭的雨聲隔著鐵門傳進來，像是在提醒你離開與回頭都還沒有被完全禁止。',
      ],
      reason: '玩家從四樓門口返回一樓入口。',
    }),
  },
  {
    from: '002_friend_apartment',
    to: '003_friend_apartment_livingroom',
    pattern: /(?:進屋|進入屋內|跨過門檻|踏入玄關|進入玄關|走進客廳|進入客廳|客廳)/,
    requiresFlag: 'friend_apartment_wooden_door_opened',
    build: () => ({
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
      narration: [
        '你跨過門檻，鞋底在玄關磁磚上短暫黏住，又被迫剝離。屋內的鹹腥味比門口更清楚，像被封在牆面與家具之間太久。',
        '玄關往內連著客廳。昏暗光線裡，沙發、木桌與電視櫃形成一個熟悉卻不安的生活輪廓，所有東西都像在等待你靠近確認。',
      ],
      reason: '玩家從四樓門口進入朋友租屋處客廳。',
    }),
  },
  {
    from: '003_friend_apartment_livingroom',
    to: '002_friend_apartment',
    pattern:
      /(?:退回門口|回到門口|返回門口|回玄關|返回玄關|退出屋內|退出租屋處|回到四樓|回樓梯間|公共樓梯間)/,
    build: () => ({
      actions: [
        {
          beliefSignal: 'rational_investigation',
          id: 'inspect-friend-door-after-exit',
          label: '回頭檢查兩道門與門檻附近的痕跡',
        },
        {
          beliefSignal: 'none',
          id: 'return-to-living-room',
          intent: { to: '003_friend_apartment_livingroom', type: 'move' },
          label: '重新踏進玄關，回到客廳',
        },
        {
          beliefSignal: 'withhold_judgment',
          id: 'go-downstairs-from-fourth-floor',
          intent: { to: '001_apartment_entrance', type: 'move' },
          label: '沿樓梯下樓，暫時離開四樓門口',
        },
      ],
      narration: [
        '你從客廳退回玄關，重新站到四樓門口與兩道門之間。屋內的鹹腥氣味仍從門後緩慢滲出，沒有因你的後退而消失。',
        '紅色鐵門、後方木門與門縫下的黑色乾涸痕跡再次回到眼前。這裡像是屋內與樓梯間之間的一道潮濕分界。',
      ],
      reason: '玩家從客廳退回四樓門口。',
    }),
  },
  {
    from: '003_friend_apartment_livingroom',
    to: '003_friend_bedroom',
    pattern: /(?:臥房|臥室|房間|睡房|寢室)/,
    build: () => ({
      actions: [
        {
          beliefSignal: 'rational_investigation',
          id: 'inspect-bedroom-desk',
          label: '查看臥室書桌與桌面物品',
        },
        {
          beliefSignal: 'rational_investigation',
          id: 'inspect-bedroom-bed',
          label: '檢查床鋪與周遭是否有使用痕跡',
        },
        {
          beliefSignal: 'withhold_judgment',
          id: 'return-to-living-room',
          intent: { to: '003_friend_apartment_livingroom', type: 'move' },
          label: '暫時離開臥室，回到客廳',
        },
      ],
      narration: [
        '你離開客廳，走進朋友的臥房。房間裡的空氣比客廳更悶，像是門窗已經很久沒有真正打開過。',
        '單人床、書桌與積灰的架子映入眼中。桌面散著紙張，闔上的筆記型電腦安靜地放在其中，像某段中斷的生活還停在原處。',
      ],
      reason: '玩家從客廳進入朋友臥室。',
    }),
  },
  {
    from: '003_friend_apartment_livingroom',
    to: '004_friend_kitchen',
    pattern: /廚房/,
    build: () => ({
      actions: [
        {
          beliefSignal: 'rational_investigation',
          id: 'inspect-kitchen-counter',
          label: '檢查流理台、瓦斯爐與櫥櫃',
        },
        {
          beliefSignal: 'rational_investigation',
          id: 'inspect-kitchen-fridge',
          label: '查看冰箱與周遭是否有異常痕跡',
        },
        {
          beliefSignal: 'withhold_judgment',
          id: 'return-to-living-room',
          intent: { to: '003_friend_apartment_livingroom', type: 'move' },
          label: '暫時離開廚房，回到客廳',
        },
      ],
      narration: [
        '你從客廳轉進廚房。狹小空間裡的設備排列得很緊，流理台、瓦斯爐與冰箱都帶著老公寓常見的使用痕跡。',
        '這裡沒有明顯飯菜味，反而顯得太安靜。牆角與管線附近的陰影被潮氣壓得發暗，讓人很難判斷哪些只是污痕。',
      ],
      reason: '玩家從客廳進入廚房。',
    }),
  },
  {
    from: '003_friend_apartment_livingroom',
    to: '005_friend_bathroom',
    pattern: /(?:浴室|廁所|洗手間|衛浴)/,
    build: () => ({
      actions: [
        {
          beliefSignal: 'rational_investigation',
          id: 'inspect-bathroom-sink',
          label: '查看洗手台、鏡面與排水口',
        },
        {
          beliefSignal: 'rational_investigation',
          id: 'inspect-bathroom-laundry',
          label: '檢查洗衣機與晾掛衣物附近',
        },
        {
          beliefSignal: 'withhold_judgment',
          id: 'return-to-living-room',
          intent: { to: '003_friend_apartment_livingroom', type: 'move' },
          label: '離開浴室，回到客廳',
        },
      ],
      narration: [
        '你推開浴室門，除臭劑與潮濕磁磚的氣味先一步湧出。乾濕分離的隔門、洗手台與馬桶都在狹窄空間裡顯得格外接近。',
        '浴巾晾在一旁，洗衣機塞在角落。這裡看起來仍像日常生活的一部分，卻安靜得缺少人剛離開後該有的餘溫。',
      ],
      reason: '玩家從客廳進入浴室。',
    }),
  },
  {
    from: '004_friend_kitchen',
    to: '006_friend_balcony',
    pattern: /(?:陽台|小陽台|後陽台)/,
    build: () => ({
      actions: [
        {
          beliefSignal: 'rational_investigation',
          id: 'inspect-balcony-bars',
          label: '檢查陽台外側鐵架與防盜網',
        },
        {
          beliefSignal: 'rational_investigation',
          id: 'inspect-balcony-boxes',
          label: '查看陽台上堆放的紙箱與雜物',
        },
        {
          beliefSignal: 'withhold_judgment',
          id: 'return-to-kitchen',
          intent: { to: '004_friend_kitchen', type: 'move' },
          label: '離開陽台，回到廚房',
        },
      ],
      narration: [
        '你穿過廚房角落的紗門，進入狹長的小陽台。外頭防火巷的濕悶氣味隔著鐵架湧來，讓空氣變得更沉。',
        '老式防盜鐵柵欄完整包覆在外側，窗花與補焊痕跡在昏暗裡交錯。堆放的紙箱與雜物安靜地貼著牆邊。',
      ],
      reason: '玩家從廚房進入小陽台。',
    }),
  },
  {
    from: '003_friend_bedroom',
    to: '003_friend_apartment_livingroom',
    pattern: /(?:回客廳|返回客廳|回到客廳|(?:逃|衝|跑|躲|退)(?:向|回|到|進)客廳|離開(?:臥房|臥室|房間))/,
    build: buildReturnToLivingRoom,
  },
  {
    from: '004_friend_kitchen',
    to: '003_friend_apartment_livingroom',
    pattern: /(?:回客廳|返回客廳|回到客廳|(?:逃|衝|跑|躲|退)(?:向|回|到|進)客廳|離開廚房)/,
    build: buildReturnToLivingRoom,
  },
  {
    from: '005_friend_bathroom',
    to: '003_friend_apartment_livingroom',
    pattern: /(?:回客廳|返回客廳|回到客廳|(?:逃|衝|跑|躲|退)(?:向|回|到|進)客廳|離開(?:浴室|廁所|洗手間))/,
    build: buildReturnToLivingRoom,
  },
  {
    from: '006_friend_balcony',
    to: '004_friend_kitchen',
    pattern: /(?:回廚房|返回廚房|回到廚房|(?:逃|衝|跑|躲|退)(?:向|回|到|進)廚房|離開(?:陽台|小陽台|後陽台))/,
    build: () => ({
      actions: [
        {
          beliefSignal: 'rational_investigation',
          id: 'continue-kitchen-search',
          label: '繼續查看廚房裡已經看見的物品',
        },
        {
          beliefSignal: 'withhold_judgment',
          id: 'return-to-living-room',
          intent: { to: '003_friend_apartment_livingroom', type: 'move' },
          label: '暫時離開廚房，回到客廳',
        },
      ],
      narration: [
        '你從小陽台退回廚房，紗門在身後輕輕晃動。防火巷的濕悶氣味被隔回外側，但仍有一點殘留在鼻腔裡。',
        '廚房重新變得狹窄而安靜，流理台與櫥櫃貼著牆面排列，像還藏著一些尚未被確認的細節。',
      ],
      reason: '玩家從小陽台返回廚房。',
    }),
  },
]

function buildReturnToLivingRoom(): TransitionResult {
  return {
    actions: [
      {
        beliefSignal: 'rational_investigation',
        id: 'continue-living-room-search',
        label: '繼續調查客廳裡已經看見的物品',
      },
      {
        beliefSignal: 'withhold_judgment',
        id: 'survey-apartment-layout',
        label: '先環顧租屋處，確認還有哪些空間尚未查看',
      },
      {
        beliefSignal: 'none',
        id: 'leave-friend-apartment',
        intent: { to: '002_friend_apartment', type: 'move' },
        label: '循原路退出租屋處',
      },
    ],
    narration: [
      '你離開剛才所在的空間，回到客廳。屋內那股鹹腥與潮濕交疊的氣味重新包圍過來，像客廳才是整間住處的中心。',
      '沙發、木桌與電視櫃仍在原處。昏暗光線讓每件日常物品都顯得比記憶中更沉，也更難判斷是否曾被人動過。',
    ],
    reason: '玩家返回朋友租屋處客廳。',
  }
}
