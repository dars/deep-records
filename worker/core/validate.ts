// 針對模型輸出的伺服器端守門：擋掉未知道具、非法轉場、重複取得與提前洩漏。
import type {
  InvestigationEffects,
  KeeperCheck,
  KeeperResponse,
  KeeperWireState,
} from '../../shared/keeper'
import {
  idolInspectionFallbackActions,
  oneTimeInventoryActionPatterns,
  sceneFallbackActions,
} from '../config/fallbacks'
import { endings, items, scenes } from '../generated/content'

export function validateKeeperResponse(
  response: KeeperResponse,
  sceneId: string,
  state?: KeeperWireState,
): KeeperResponse {
  const validatedEffects = validateEffects(response.effects, sceneId, state)
  const isEnding = Boolean(validatedEffects?.endingId)

  return {
    ...response,
    actions: isEnding ? [] : response.actions,
    checks: isEnding ? [] : validateChecks(response.checks),
    effects: validatedEffects,
  }
}

export function validateEffects(
  effects: InvestigationEffects | undefined,
  sceneId: string,
  state?: KeeperWireState,
): InvestigationEffects | undefined {
  if (!effects) {
    return effects
  }

  const ownedInventory = new Set(state?.inventory ?? [])
  const availableItems = new Set(scenes[sceneId]?.itemsAvailable ?? [])
  const addInventory = effects.addInventory?.filter((itemId) => {
    const item = items[itemId]

    if (!item) {
      return false
    }

    if (item.once && ownedInventory.has(itemId)) {
      return false
    }

    return availableItems.has(itemId)
  })

  const ending = effects.endingId ? endings[effects.endingId] : undefined

  return {
    ...effects,
    addInventory: addInventory && addInventory.length > 0 ? addInventory : undefined,
    endingId: ending?.id,
    endingTitle: ending ? (effects.endingTitle ?? ending.title) : undefined,
    hitPointDelta: clampNumber(effects.hitPointDelta, -5, 5),
    nextSceneId: validateNextSceneId(effects.nextSceneId, sceneId),
    sanityDelta: clampNumber(effects.sanityDelta, -10, 5),
  }
}

export function validateNextSceneId(nextSceneId: string | undefined, sceneId: string) {
  if (!nextSceneId || !scenes[nextSceneId]) {
    return undefined
  }

  if (nextSceneId === sceneId) {
    return undefined
  }

  const connectsTo = scenes[sceneId]?.connectsTo ?? []

  return connectsTo.includes(nextSceneId) ? nextSceneId : undefined
}

export function validateChecks(checks: KeeperCheck[]) {
  return checks.filter(
    (check) =>
      check.difficulty >= 1 &&
      check.difficulty <= 100 &&
      Boolean(check.attribute.trim()) &&
      Boolean(check.reason.trim()),
  )
}

function clampNumber(value: number | undefined, min: number, max: number) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return undefined
  }

  return Math.min(max, Math.max(min, value))
}

export function ensureAvailableActions(
  response: KeeperResponse,
  sceneId: string,
  playerAction: string,
): KeeperResponse {
  if (
    response.effects?.endingId ||
    response.actions.length > 0 ||
    response.checks.length > 0 ||
    sceneId === '000_prologue'
  ) {
    return response
  }

  if (
    sceneId === '003_friend_apartment_livingroom' &&
    /木雕|雕像|觸手|五芒星/.test(playerAction)
  ) {
    return {
      ...response,
      actions: idolInspectionFallbackActions,
    }
  }

  return {
    ...response,
    actions: sceneFallbackActions[sceneId] ?? [],
  }
}

export function removeAlreadyOwnedInventory(
  response: KeeperResponse,
  state?: KeeperWireState,
): KeeperResponse {
  const ownedInventory = new Set(state?.inventory ?? [])

  if (ownedInventory.size === 0) {
    return response
  }

  const nextAddInventory = response.effects?.addInventory?.filter(
    (item) => !ownedInventory.has(item),
  )
  const actions = response.actions.filter((action) =>
    isAllowedActionForOwnedInventory(action.label, ownedInventory),
  )

  return {
    ...response,
    actions,
    effects: response.effects
      ? {
          ...response.effects,
          addInventory:
            nextAddInventory && nextAddInventory.length > 0
              ? nextAddInventory
              : undefined,
        }
      : response.effects,
  }
}

function isAllowedActionForOwnedInventory(
  actionLabel: string,
  ownedInventory: Set<string>,
) {
  for (const itemId of ownedInventory) {
    const patterns = oneTimeInventoryActionPatterns[itemId]

    if (patterns?.some((pattern) => pattern.test(actionLabel))) {
      return false
    }
  }

  return true
}

// 客廳木桌抽屜的多段式發現流程與相關洩漏防護，屬於本劇本專屬的守門邏輯。
export function enforceDiscoveryConstraints(
  response: KeeperResponse,
  sceneId: string,
  playerAction: string,
  state?: KeeperWireState,
): KeeperResponse {
  const visitedBedroom = state?.visitedScenes?.includes('003_friend_bedroom') ?? false
  const knowsCardReader =
    visitedBedroom || state?.inventory?.includes('item_microsd_card_reader') === true
  let constrained = removeAlreadyOwnedInventory(response, state)

  if (!knowsCardReader) {
    constrained = {
      ...constrained,
      actions: constrained.actions.filter(
        (action) =>
          !/(?:臥室|房間).*(?:讀卡機|轉接器|讀取設備)|(?:讀卡機|轉接器|讀取設備).*(?:臥室|房間)/.test(
            action.label,
          ),
      ),
    }
  }

  const hasSpareKeyring =
    state?.inventory?.includes('item_friend_apartment_spare_key') === true
  const ironDoorWasOpened = state?.flags?.friend_apartment_iron_door_opened === true
  const rechecksMailboxForSpareKey =
    hasSpareKeyring &&
    sceneId === '001_apartment_entrance' &&
    /信箱|備用鑰匙|鑰匙圈|阿宏.*信箱|朋友.*信箱/.test(playerAction)

  if (hasSpareKeyring) {
    constrained = {
      ...constrained,
      effects: {
        ...constrained.effects,
        addInventory: constrained.effects?.addInventory?.filter(
          (item) => item !== 'item_friend_apartment_spare_key',
        ),
      },
    }
  }

  if (rechecksMailboxForSpareKey) {
    return {
      ...constrained,
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
        {
          beliefSignal: 'withhold_judgment',
          id: 'review-ahong-message-after-key-check',
          label: '重新查看阿宏最後傳來的訊息',
        },
      ],
      checks: [],
      effects: {
        ...constrained.effects,
        addInventory: constrained.effects?.addInventory?.filter(
          (item) => item !== 'item_friend_apartment_spare_key',
        ),
      },
      narration: [
        '你再次拉開阿宏對應的一樓信箱。裡面只剩被雨氣浸軟邊角的廣告傳單與幾封尚未取走的信件，沒有第二只夾鏈袋，也沒有新的鑰匙。',
        '那只掛著兩把鑰匙的備用鑰匙圈已經在你身上。信箱只能確認一件事：阿宏確實把這裡當成你進入住處的方式，而這條線索已經被你取走。',
      ],
    }
  }

  const attemptsApartmentUnlock =
    /(?:鑰匙|開鎖|開門|解鎖)/.test(playerAction) &&
    /(?:鐵門|木門|大門|住處|進屋|門)/.test(playerAction)

  if (
    sceneId === '002_friend_apartment' &&
    hasSpareKeyring &&
    !ironDoorWasOpened &&
    attemptsApartmentUnlock
  ) {
    return {
      ...constrained,
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
          ...constrained.effects?.setFlags,
          friend_apartment_iron_door_opened: true,
        },
      },
      narration: [
        '透明夾鏈袋裡不是單獨一把鑰匙，而是一只掛著兩把鑰匙的小鑰匙圈。你逐一試過後，其中一把順利插進外側紅色鐵門的鎖孔。',
        '鏽蝕鐵門伴著沉重金屬聲向外開啟，露出後方仍然緊閉的木門。兩道門之間只隔著狹窄一步；屋內尚未打開，只有樓梯間的濕氣停留在門前。',
      ],
    }
  }

  const examinesWoodenIdol =
    sceneId === '003_friend_apartment_livingroom' &&
    /木雕|雕像|觸手造型|電視櫃.*擺飾/.test(playerAction)
  const idolWasExamined =
    state?.flags?.star_spawn_idol_examined === true ||
    state?.discoveredClues?.includes('item_star_spawn_wooden_idol') === true

  if (examinesWoodenIdol && !idolWasExamined) {
    return {
      ...constrained,
      effects: {
        ...constrained.effects,
        discoverClues: Array.from(
          new Set([
            ...(constrained.effects?.discoverClues ?? []),
            'item_star_spawn_wooden_idol',
          ]),
        ),
        setFlags: {
          ...constrained.effects?.setFlags,
          star_spawn_idol_examined: true,
        },
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
      ...constrained,
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
          label: '暫時退回玄關與門口，確認退路',
        },
      ],
      checks: [],
      effects: {
        ...constrained.effects,
        nextSceneId: '003_friend_apartment_livingroom',
        setFlags: {
          ...constrained.effects?.setFlags,
          friend_apartment_wooden_door_opened: true,
        },
      },
      narration: [
        '你換上鑰匙圈上的另一把鑰匙。這一次，後方木門的鎖芯在短暫阻滯後鬆開，門板向內退開一道縫。',
        '一股被封在屋內的濕冷氣味迎面湧出。那不是單純的霉味，空氣裡帶著濃重鹹味，混合腐敗海產、積水與潮濕污泥般的腥臭。',
        '你跨過門檻，鞋底在玄關磁磚上短暫黏住，又被迫剝離。玄關往內連著客廳；熟悉的沙發、木桌與過大的電視都在昏暗光線裡安靜地等著。',
      ],
    }
  }

  if (
    sceneId !== '003_friend_apartment_livingroom' ||
    !/木桌|桌子|抽屜/.test(playerAction)
  ) {
    return constrained
  }

  const tableWasExamined = state?.flags?.living_room_table_surface_examined === true
  const drawerWasOpened = state?.flags?.living_room_table_drawer_opened === true
  const hiddenSpaceWasSuspected =
    state?.flags?.living_room_table_hidden_space_suspected === true
  const memoryCardWasFound =
    state?.flags?.hidden_memory_card_found === true ||
    state?.inventory?.includes('item_hidden_memory_card') === true
  const closesDrawer = /關上|關起|關閉|推回|闔上/.test(playerAction)
  const opensDrawer = /打開|拉開|抽開/.test(playerAction)
  const removesDrawer = /完全抽出|整個抽出|完全拉出|整個拉出|拆出|取出抽屜/.test(
    playerAction,
  )
  const investigatesHiddenSpace =
    /後方空間|奇怪空間|隱藏空間|抽屜後|桌身深處|伸手.*後方|摸索.*後方/.test(
      playerAction,
    )
  const investigatesDrawer =
    /調查抽屜|檢查抽屜|翻找抽屜|移開雜物|檢查木軌|比較.*深度|量.*深度|抽屜深處/.test(
      playerAction,
    )

  const withoutPrematureCard = (
    effects?: InvestigationEffects,
  ): InvestigationEffects => ({
    ...effects,
    addInventory: effects?.addInventory?.filter(
      (item) => item !== 'item_hidden_memory_card',
    ),
    discoverClues: effects?.discoverClues?.filter(
      (clue) => !/memory_card|記憶卡/.test(clue),
    ),
  })

  if (!tableWasExamined) {
    return {
      ...constrained,
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
        ...withoutPrematureCard(constrained.effects),
        setFlags: {
          ...constrained.effects?.setFlags,
          living_room_table_surface_examined: true,
        },
      },
      narration: [
        '你移開桌面上散亂的信件、工作文件、零食與啤酒罐，沿著刮痕累累的桌緣仔細查看。這些凌亂更像長期生活留下的痕跡，不像有人匆忙翻找過。',
        '彎身檢查桌身時，你才注意到桌面下方嵌著一個寬大的木製抽屜。抽屜仍然關著，從外面看不出裡頭放了什麼。',
      ],
    }
  }

  if (!drawerWasOpened && (opensDrawer || /抽屜/.test(playerAction))) {
    return {
      ...constrained,
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
        ...withoutPrematureCard(constrained.effects),
        setFlags: {
          ...constrained.effects?.setFlags,
          living_room_table_drawer_opened: true,
        },
      },
      narration: [
        '寬大的抽屜拉開時有些卡頓，木軌摩擦出乾澀聲響。裡頭塞著指甲剪、面紙、開瓶器、打火機與幾樣隨手收進去的生活雜物。',
        '這些東西沒有特別整理，彼此疊壓在一起。單純把抽屜拉開，還看不出它與普通雜物抽屜有什麼不同。',
      ],
    }
  }

  if (drawerWasOpened && closesDrawer && !memoryCardWasFound) {
    return {
      ...constrained,
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
        ...withoutPrematureCard(constrained.effects),
        setFlags: {
          ...constrained.effects?.setFlags,
          living_room_table_drawer_noise_heard: true,
          living_room_table_drawer_opened: false,
          living_room_table_hidden_space_suspected: true,
        },
      },
      narration: [
        '你把抽屜推回桌身。就在它快要完全閉合時，木桌深處傳出一聲短促而悶住的異響，不像木軌摩擦，更像薄塑膠被抽屜後緣擠壓了一下。',
        '抽屜最後仍能關上，但那個聲音顯示它後方碰到了某樣不該存在的東西。從正面看去，桌身依舊沒有任何開口。',
      ],
    }
  }

  if (
    drawerWasOpened &&
    !hiddenSpaceWasSuspected &&
    (investigatesDrawer || investigatesHiddenSpace || removesDrawer)
  ) {
    return {
      ...constrained,
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
        ...withoutPrematureCard(constrained.effects),
        setFlags: {
          ...constrained.effects?.setFlags,
          living_room_table_drawer_opened: true,
          living_room_table_hidden_space_suspected: true,
        },
      },
      narration: [
        '你把雜物移開，沿著抽屜內壁與木軌慢慢檢查。抽屜底板本身沒有夾層，但它的內部深度明顯比木桌外側量起來短了一截。',
        '從木軌末端與桌身陰影判斷，抽屜後方似乎還留著一小段正常使用時看不見的空間。裡面是否真的有東西，仍得伸手確認或把抽屜完全取出。',
      ],
    }
  }

  if (hiddenSpaceWasSuspected && (investigatesHiddenSpace || removesDrawer)) {
    return {
      ...constrained,
      effects: {
        ...constrained.effects,
        addInventory: Array.from(
          new Set([
            ...(constrained.effects?.addInventory ?? []),
            'item_hidden_memory_card',
          ]),
        ),
        discoverClues: Array.from(
          new Set([
            ...(constrained.effects?.discoverClues ?? []),
            '木桌抽屜後方的記憶卡',
          ]),
        ),
        setFlags: {
          ...constrained.effects?.setFlags,
          hidden_memory_card_found: true,
          living_room_table_drawer_opened: true,
          living_room_table_hidden_space_suspected: true,
        },
      },
    }
  }

  return constrained
}
