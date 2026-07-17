// 結局判定：原本在前端用 regex 蓋掉模型輸出，現在由 worker 統一判定，
// 標題以 scenarios/ending/*.md 的 frontmatter 為準。
import type { KeeperAction, KeeperWireState } from '../../shared/keeper'
import { endings } from '../generated/content'

const inApartmentScenes = new Set([
  '002_friend_apartment',
  '003_friend_apartment_livingroom',
  '003_friend_bedroom',
  '004_friend_kitchen',
  '005_friend_bathroom',
  '006_friend_balcony',
])

export type InferredEnding = {
  id: string
  title: string
}

// 「離開現場」語意判定；officer.ts 也用它排除「離開公寓去報警」的誤觸發。
export const leavingPattern =
  /(?:轉身離開|轉身回家|直接回家|回家|離開公寓|離開這裡|不進去|不進公寓|放棄調查|取消調查|離開現場)/

function toEnding(endingId: string): InferredEnding | undefined {
  const ending = endings[endingId]

  return ending ? { id: ending.id, title: ending.title } : undefined
}

export function inferEnding(
  sceneId: string,
  playerAction: string,
  state?: KeeperWireState,
  selectedAction?: KeeperAction,
): InferredEnding | undefined {
  if (sceneId === '000_prologue') {
    return undefined
  }

  // 阿陽登場後公寓已封鎖，不再存在成功離開的結局路線（demo-rules 第二個不可逆門檻）。
  // 離開嘗試交給模型依 officer_a_yang.md 的追逃與判定規則敘事。
  if (state?.flags?.officer_a_yang_arrived === true) {
    return undefined
  }

  const actionText = `${selectedAction?.label ?? ''}\n${playerAction}`
  const isLeaving =
    selectedAction?.intent?.type === 'leave' || leavingPattern.test(actionText)

  if (!isLeaving) {
    return undefined
  }

  if (sceneId === '001_apartment_entrance') {
    return toEnding('ending_ordinary_departure')
  }

  const inventory = state?.inventory ?? []
  const hasMemoryCard = inventory.includes('item_hidden_memory_card')

  if (hasMemoryCard && /(?:報警|警方|警察|警局|交給警方|交出)/.test(actionText)) {
    const stage = state?.belief?.stage
    const endingId =
      stage === 'operational' || stage === 'convinced'
        ? 'ending_suppressed_truth'
        : 'ending_surrendered_evidence'

    return toEnding(endingId)
  }

  if (hasMemoryCard) {
    return toEnding('ending_truth_in_hand')
  }

  if (inApartmentScenes.has(sceneId)) {
    return toEnding('ending_uneasy_departure')
  }

  return undefined
}
