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
  // 匿名遊玩事件記錄：同一局續玩沿用同一 id 與回合序。
  sessionId?: string
  turnCount?: number
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

    // 舊存檔沒有遊戲時鐘：以回合數推估補值。
    if (typeof parsed.investigationState.clockMinutes !== 'number') {
      parsed.investigationState.clockMinutes = 77 + (parsed.turnCount ?? 0) * 4
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

// ── 玩家檔案：重玩時帶入上一輪的名字與職業 ──────────────────
export type PlayerProfile = {
  name: string
  occupationId: string
}

const profileKey = 'deep-records/profile/v1'

export function loadPlayerProfile(): PlayerProfile | null {
  try {
    const raw = window.localStorage.getItem(profileKey)

    if (!raw) {
      return null
    }

    const parsed = JSON.parse(raw) as PlayerProfile

    return typeof parsed?.name === 'string' && typeof parsed?.occupationId === 'string'
      ? parsed
      : null
  } catch {
    return null
  }
}

export function savePlayerProfile(profile: PlayerProfile) {
  try {
    window.localStorage.setItem(profileKey, JSON.stringify(profile))
  } catch {
    // 靜默略過
  }
}

// ── 結局圖鑑：跨輪保存已見證的結局 ─────────────────────────
export type UnlockedEnding = {
  id: string
  title: string
}

const endingsKey = 'deep-records/endings/v1'

export function loadUnlockedEndings(): UnlockedEnding[] {
  try {
    const raw = window.localStorage.getItem(endingsKey)

    if (!raw) {
      return []
    }

    const parsed = JSON.parse(raw) as UnlockedEnding[]

    return Array.isArray(parsed)
      ? parsed.filter(
          (entry) =>
            typeof entry?.id === 'string' && typeof entry?.title === 'string',
        )
      : []
  } catch {
    return []
  }
}

export function unlockEnding(ending: UnlockedEnding) {
  try {
    const unlocked = loadUnlockedEndings()

    if (unlocked.some((entry) => entry.id === ending.id)) {
      return
    }

    window.localStorage.setItem(
      endingsKey,
      JSON.stringify([...unlocked, ending]),
    )
  } catch {
    // 靜默略過
  }
}
