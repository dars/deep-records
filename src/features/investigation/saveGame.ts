// localStorage 存檔：每回合結束後保存，重新整理或關閉分頁後可續玩。
import type { TurnHistoryEntry } from '../../../shared/keeper'
import type {
  ActionOption,
  InvestigationState,
  InvestigatorProfile,
  KeeperCheck,
} from '../../types/investigation'

export type SavedGameUi = {
  actionOptions: ActionOption[]
  checks: KeeperCheck[]
  sceneStage: 'prologue' | 'apartmentEntrance'
  storyParagraphs: string[]
}

export type SavedGame = {
  history: TurnHistoryEntry[]
  investigationState: InvestigationState
  investigator: InvestigatorProfile
  savedAt: string
  ui: SavedGameUi
  version: 1
}

const storageKey = 'deep-records/save/v1'

export function loadSavedGame(): SavedGame | null {
  try {
    const raw = window.localStorage.getItem(storageKey)

    if (!raw) {
      return null
    }

    const parsed = JSON.parse(raw) as SavedGame

    if (
      parsed?.version !== 1 ||
      !parsed.investigationState?.currentSceneId ||
      !parsed.investigator?.name ||
      !Array.isArray(parsed.ui?.storyParagraphs)
    ) {
      return null
    }

    // 已結局的存檔沒有續玩意義。
    if (parsed.investigationState.ending) {
      return null
    }

    return parsed
  } catch {
    return null
  }
}

export function saveGame(snapshot: Omit<SavedGame, 'savedAt' | 'version'>) {
  try {
    window.localStorage.setItem(
      storageKey,
      JSON.stringify({
        ...snapshot,
        savedAt: new Date().toISOString(),
        version: 1,
      } satisfies SavedGame),
    )
  } catch {
    // localStorage 不可用（隱私模式、容量滿）時靜默略過，不影響遊戲。
  }
}

export function clearSavedGame() {
  try {
    window.localStorage.removeItem(storageKey)
  } catch {
    // 同上，靜默略過。
  }
}
