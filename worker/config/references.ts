// 依場景 frontmatter 的 references 與玩家行動觸發詞，挑選要注入 prompt 的參考 MD。
import type { KeeperWireState } from '../../shared/keeper'
import {
  characters,
  endings,
  factions,
  items,
  keeperReferences,
  scenes,
  type DocDefinition,
} from '../generated/content'

type ReferenceEntry = {
  markdown: string
  title: string
}

function withTitlePrefix(
  docs: Record<string, DocDefinition>,
  prefix: string,
): Array<[string, ReferenceEntry]> {
  return Object.values(docs).map((doc) => [
    doc.id,
    { markdown: doc.markdown, title: prefix ? `${prefix}：${doc.title}` : doc.title },
  ])
}

export const referenceLibrary: Record<string, ReferenceEntry> = Object.fromEntries([
  ...withTitlePrefix(keeperReferences, ''),
  ...withTitlePrefix(characters, '角色'),
  ...withTitlePrefix(factions, '陣營'),
  ...Object.values(items).map(
    (item): [string, ReferenceEntry] => [
      item.id,
      { markdown: item.markdown, title: `道具：${item.title}` },
    ],
  ),
  ...Object.values(endings).map(
    (ending): [string, ReferenceEntry] => [
      ending.id,
      { markdown: ending.markdown, title: `結局：${ending.title}` },
    ],
  ),
])

// 所有場景固定注入的基礎參考。
const baseReferences = ['keeper_rules', 'belief_rules']

// 依玩家行動、持有物或旗標動態補充的參考。
type ReferenceTrigger = {
  flag?: string
  inventoryItem?: string
  pattern?: RegExp
  references: string[]
}

const referenceTriggers: ReferenceTrigger[] = [
  {
    pattern: /san|理智|瘋狂|恐懼|檢定|噁心|血|屍|儀式|腥味/i,
    references: ['sanity_rules'],
  },
  {
    inventoryItem: 'item_friend_apartment_spare_key',
    pattern: /鑰匙|信箱/,
    references: ['item_friend_apartment_spare_key'],
  },
  {
    inventoryItem: 'item_hidden_memory_card',
    pattern: /記憶卡|micro ?sd|照片|檔案|資料|讀取|轉接|讀卡/i,
    references: ['item_hidden_memory_card'],
  },
  {
    inventoryItem: 'item_microsd_card_reader',
    pattern: /讀卡|轉接|micro ?sd/i,
    references: ['item_microsd_card_reader'],
  },
  {
    inventoryItem: 'item_friend_laptop',
    pattern: /筆電|電腦|登入|密碼|瀏覽器|社群|搜尋/i,
    references: ['item_friend_laptop'],
  },
  {
    inventoryItem: 'item_star_spawn_wooden_idol',
    pattern: /木雕|雕像|觸手|五芒星|破壞|砸|搬動/,
    references: ['item_star_spawn_wooden_idol'],
  },
  {
    flag: 'officer_a_yang_arrived',
    pattern: /警察|警方|報警|阿陽|員警|拘捕|手銬/,
    references: ['character_officer_a_yang', 'faction_hidden_congregation'],
  },
  {
    pattern: /五樓|房東住處|獻祭|飲血|見證者/,
    references: ['demo_rules', 'faction_hidden_congregation'],
  },
  {
    pattern: /結局|逃離|離開公寓|回家|警局|交給警方|保留記憶卡|傳出去/,
    references: [
      'ending_ordinary_departure',
      'ending_uneasy_departure',
      'ending_surrendered_evidence',
      'ending_suppressed_truth',
      'ending_truth_in_hand',
    ],
  },
]

export function selectReferenceSections({
  playerAction,
  sceneId,
  state,
}: {
  playerAction: string
  sceneId: string
  state?: KeeperWireState
}): Array<[string, string]> {
  const inventory = new Set(state?.inventory ?? [])
  const flags = state?.flags ?? {}
  const sections: Array<[string, string]> = []
  const usedIds = new Set<string>()
  const addReference = (referenceId: string) => {
    const entry = referenceLibrary[referenceId]

    if (entry && !usedIds.has(referenceId)) {
      usedIds.add(referenceId)
      sections.push([entry.title, entry.markdown])
    }
  }

  for (const referenceId of baseReferences) {
    addReference(referenceId)
  }

  for (const referenceId of scenes[sceneId]?.references ?? []) {
    addReference(referenceId)
  }

  for (const trigger of referenceTriggers) {
    const matchesInventory = trigger.inventoryItem
      ? inventory.has(trigger.inventoryItem)
      : false
    const matchesFlag = trigger.flag ? flags[trigger.flag] === true : false
    const matchesPattern = trigger.pattern ? trigger.pattern.test(playerAction) : false

    if (matchesInventory || matchesFlag || matchesPattern) {
      for (const referenceId of trigger.references) {
        addReference(referenceId)
      }
    }
  }

  return sections
}
