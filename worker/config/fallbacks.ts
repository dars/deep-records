// LLM 回應缺少可用選項或無法解析時使用的場景備援資料。
import type { KeeperAction } from '../../shared/keeper'

// 已持有一次性道具時，需從模型輸出的 actions 中過濾掉的「再次取得」選項。
export const oneTimeInventoryActionPatterns: Record<string, RegExp[]> = {
  item_friend_apartment_spare_key: [
    /信箱.*(?:備用鑰匙|鑰匙圈|鑰匙)/,
    /(?:備用鑰匙|鑰匙圈|鑰匙).*信箱/,
    /查看阿宏提過的一樓信箱/,
    /查看.*信箱.*鑰匙/,
  ],
  item_friend_laptop: [
    /(?:取得|拿起|拿走|帶走|找到|搜出|搬走).*(?:筆電|筆記型電腦|電腦)/,
    /(?:筆電|筆記型電腦|電腦).*(?:取得|拿起|拿走|帶走|找到|搜出|搬走)/,
  ],
  item_hidden_memory_card: [
    /(?:取得|拿起|拿走|帶走|找到|搜出|抽出|摸出).*(?:記憶卡|micro ?sd)/i,
    /(?:記憶卡|micro ?sd).*(?:取得|拿起|拿走|帶走|找到|搜出|抽出|摸出)/i,
  ],
  item_microsd_card_reader: [
    /(?:取得|拿起|拿走|帶走|找到|搜出|撿起).*(?:讀卡機|轉接器|讀取設備|card reader)/i,
    /(?:讀卡機|轉接器|讀取設備|card reader).*(?:取得|拿起|拿走|帶走|找到|搜出|撿起)/i,
  ],
  item_star_spawn_wooden_idol: [
    /(?:取得|拿起|拿走|帶走|搬走|抱起|撿起).*(?:木雕|雕像|觸手造型|五芒星)/,
    /(?:木雕|雕像|觸手造型|五芒星).*(?:取得|拿起|拿走|帶走|搬走|抱起|撿起)/,
  ],
}

export const idolInspectionFallbackActions: KeeperAction[] = [
  {
    beliefSignal: 'rational_investigation',
    id: 'inspect-idol-construction',
    label: '繼續檢查木雕的材質、氣味與雕刻痕跡',
  },
  {
    beliefSignal: 'withhold_judgment',
    id: 'set-idol-aside',
    label: '暫時放下木雕，改查客廳裡的其他物品',
  },
  {
    beliefSignal: 'none',
    id: 'leave-friend-apartment',
    intent: { to: '002_friend_apartment', type: 'move' },
    label: '不再碰它，循原路離開租屋處',
  },
]

export const sceneFallbackActions: Record<string, KeeperAction[]> = {
  '001_apartment_entrance': [
    {
      beliefSignal: 'rational_investigation',
      id: 'observe-apartment-entrance',
      label: '繼續觀察公寓入口與周遭環境',
    },
    {
      beliefSignal: 'none',
      id: 'enter-apartment-building',
      intent: { to: '002_friend_apartment', type: 'move' },
      label: '走進公寓，尋找通往四樓的樓梯',
    },
  ],
  '002_friend_apartment': [
    {
      beliefSignal: 'rational_investigation',
      id: 'inspect-friend-door',
      label: '繼續檢查兩道門與門檻附近的痕跡',
    },
    {
      beliefSignal: 'withhold_judgment',
      id: 'open-inner-wooden-door',
      label: '使用另一把鑰匙打開後方木門',
    },
    {
      beliefSignal: 'none',
      id: 'step-back-from-friend-door',
      label: '退回公共樓梯間，暫時不進屋',
    },
  ],
  '003_friend_apartment_livingroom': [
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
  '003_friend_bedroom': [
    {
      beliefSignal: 'rational_investigation',
      id: 'continue-bedroom-search',
      label: '繼續查看臥室裡已經看見的物品',
    },
    {
      beliefSignal: 'withhold_judgment',
      id: 'return-to-living-room',
      intent: { to: '003_friend_apartment_livingroom', type: 'move' },
      label: '暫時離開臥室，回到客廳',
    },
  ],
  '004_friend_kitchen': [
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
  '005_friend_bathroom': [
    {
      beliefSignal: 'rational_investigation',
      id: 'continue-bathroom-search',
      label: '繼續查看浴室裡已經看見的物品',
    },
    {
      beliefSignal: 'withhold_judgment',
      id: 'return-to-living-room',
      intent: { to: '003_friend_apartment_livingroom', type: 'move' },
      label: '離開浴室，回到客廳',
    },
  ],
  '006_friend_balcony': [
    {
      beliefSignal: 'rational_investigation',
      id: 'continue-balcony-search',
      label: '繼續查看陽台與防盜鐵柵欄',
    },
    {
      beliefSignal: 'withhold_judgment',
      id: 'return-to-kitchen',
      intent: { to: '004_friend_kitchen', type: 'move' },
      label: '離開陽台，回到廚房',
    },
  ],
}

export const sceneFallbackNarration: Record<string, string[]> = {
  '001_apartment_entrance': [
    '雨水沿著遮雨棚邊緣持續滴落，公寓入口、老舊信箱與通往樓上的階梯仍在眼前。剛才的動作沒有帶來明確結果，你需要換個方式確認阿宏的狀況。',
  ],
  '002_friend_apartment': [
    '紅色鐵門、後方木門與門縫下的黑色痕跡仍在眼前。剛才沒有得到明確答案，你仍可以檢查門口、使用另一把鑰匙，或暫時退回樓梯間。',
  ],
  '003_friend_apartment_livingroom': [
    '屋內的鹹腥氣味與黏膩地面沒有改變。你停在原處重新環顧客廳，眼前仍有數個尚未仔細查看的物件與通往其他房間的入口。',
  ],
  '003_friend_bedroom': [
    '臥室依舊安靜，床鋪、書桌與積灰的架子都維持原狀。剛才沒有得到明確答案，但房內仍有其他地方可以繼續確認。',
  ],
  '004_friend_kitchen': [
    '狹小廚房裡只剩電器與管線的微弱聲響。剛才沒有出現足以判斷的結果，你仍可以改查眼前的設備、櫥櫃或返回客廳。',
  ],
  '005_friend_bathroom': [
    '浴室裡的除臭劑氣味短暫壓過外面的腥臭。眼前沒有新的變化，你可以繼續查看這裡，或回到客廳尋找其他線索。',
  ],
  '006_friend_balcony': [
    '防火巷的濕悶氣味仍隔著鐵柵欄湧來，枯死盆栽與堆放紙箱沒有變化。你可以換個角度檢查，或先退回廚房。',
  ],
}

export const genericFallbackNarration = [
  '你停在原處重新確認周遭。剛才的嘗試沒有帶來明確結果，眼前的環境仍允許你改用其他方式繼續行動。',
]
