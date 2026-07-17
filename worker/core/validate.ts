// 針對模型輸出的伺服器端守門：擋掉未知道具、非法轉場、重複取得與提前洩漏。
// 劇本的確定性流程（門鎖、抽屜謎題）在 core/deterministic.ts，於模型呼叫前處理。
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

// 模型輸出的洩漏防護：不得提前給出玩家還不該知道的道具與線索。
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

  const examinesWoodenIdol =
    sceneId === '003_friend_apartment_livingroom' &&
    /木雕|雕像|觸手造型|電視櫃.*擺飾/.test(playerAction)
  const idolWasExamined =
    state?.flags?.star_spawn_idol_examined === true ||
    state?.discoveredClues?.includes('item_star_spawn_wooden_idol') === true

  if (examinesWoodenIdol && !idolWasExamined) {
    constrained = {
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

  // 記憶卡只能經由抽屜謎題（deterministic 流程）取得：
  // 玩家尚未推理出隱藏空間前，模型不得自行發放記憶卡或相關線索。
  const hiddenSpaceWasSuspected =
    state?.flags?.living_room_table_hidden_space_suspected === true

  if (sceneId === '003_friend_apartment_livingroom' && !hiddenSpaceWasSuspected) {
    constrained = {
      ...constrained,
      effects: {
        ...constrained.effects,
        addInventory: constrained.effects?.addInventory?.filter(
          (item) => item !== 'item_hidden_memory_card',
        ),
        discoverClues: constrained.effects?.discoverClues?.filter(
          (clue) => !/memory_card|記憶卡/.test(clue),
        ),
      },
    }
  }

  return constrained
}
