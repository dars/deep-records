// 對 client 傳入的請求做白名單清洗：state 完全由 client 控制，
// 這裡負責阻止透過 state/history 欄位進行 prompt injection 或撐爆 prompt。
import {
  normalizeActionIntent,
  normalizeBeliefSignal,
  type BeliefStage,
  type KeeperAction,
  type KeeperCheckResult,
  type KeeperRequestBody,
  type KeeperWireState,
  type TurnHistoryEntry,
} from '../../shared/keeper'

const beliefStages: BeliefStage[] = ['skeptical', 'hypothesis', 'operational', 'convinced']
const flagKeyPattern = /^[a-z0-9_]{1,64}$/i

function cleanText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') {
    return undefined
  }

  const cleaned = value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/\r\n?/g, '\n')
    .trim()

  if (!cleaned) {
    return undefined
  }

  return cleaned.slice(0, maxLength)
}

// 會被拼進 prompt 的單行欄位：額外壓平換行，避免拆散 prompt 結構。
function cleanInlineText(value: unknown, maxLength: number): string | undefined {
  return cleanText(value, maxLength)?.replace(/\n+/g, ' ')
}

function cleanInlineTextList(
  value: unknown,
  maxItems: number,
  maxLength: number,
): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined
  }

  const items = value
    .map((item) => cleanInlineText(item, maxLength))
    .filter((item): item is string => Boolean(item))
    .slice(0, maxItems)

  return items.length > 0 ? items : undefined
}

function sanitizeFlags(value: unknown): Record<string, boolean> | undefined {
  if (!value || typeof value !== 'object') {
    return undefined
  }

  const entries = Object.entries(value)
    .filter(
      (entry): entry is [string, boolean] =>
        flagKeyPattern.test(entry[0]) && typeof entry[1] === 'boolean',
    )
    .slice(0, 64)

  return entries.length > 0 ? Object.fromEntries(entries) : undefined
}

function clampNumber(value: unknown, min: number, max: number): number | undefined {
  const numeric = Number(value)

  if (!Number.isFinite(numeric)) {
    return undefined
  }

  return Math.min(max, Math.max(min, Math.round(numeric)))
}

function sanitizeState(value: unknown): KeeperWireState | undefined {
  if (!value || typeof value !== 'object') {
    return undefined
  }

  const state = value as KeeperWireState
  const belief =
    state.belief && typeof state.belief === 'object'
      ? {
          stage: beliefStages.includes(state.belief.stage as BeliefStage)
            ? state.belief.stage
            : undefined,
          testedMythRules: cleanInlineTextList(state.belief.testedMythRules, 16, 80),
          verifiedMythRules: cleanInlineTextList(state.belief.verifiedMythRules, 16, 80),
        }
      : undefined
  const sanity =
    typeof state.sanity === 'number'
      ? clampNumber(state.sanity, 0, 99)
      : state.sanity && typeof state.sanity === 'object'
        ? {
            current: clampNumber(state.sanity.current, 0, 99),
            lostToday: clampNumber(state.sanity.lostToday, 0, 99),
            starting: clampNumber(state.sanity.starting, 0, 99),
          }
        : undefined
  const hitPoints =
    state.hitPoints && typeof state.hitPoints === 'object'
      ? {
          current: clampNumber(state.hitPoints.current, 0, 99),
          max: clampNumber(state.hitPoints.max, 1, 99),
        }
      : undefined

  return {
    belief,
    currentSceneId: cleanInlineText(state.currentSceneId, 64),
    discoveredClues: cleanInlineTextList(state.discoveredClues, 40, 100),
    flags: sanitizeFlags(state.flags),
    hitPoints,
    inventory: cleanInlineTextList(state.inventory, 40, 100),
    sanity,
    visitedScenes: cleanInlineTextList(state.visitedScenes, 20, 64),
  }
}

function sanitizeCharacter(value: unknown): KeeperRequestBody['character'] {
  if (!value || typeof value !== 'object') {
    return undefined
  }

  const character = value as { attributes?: unknown; occupation?: unknown }
  const attributes =
    character.attributes && typeof character.attributes === 'object'
      ? Object.fromEntries(
          Object.entries(character.attributes)
            .map(([label, attributeValue]) => [
              cleanInlineText(label, 20),
              clampNumber(attributeValue, 0, 100),
            ])
            .filter(
              (entry): entry is [string, number] =>
                Boolean(entry[0]) && typeof entry[1] === 'number',
            )
            .slice(0, 12),
        )
      : undefined

  return {
    attributes,
    occupation: cleanInlineText(character.occupation, 64),
  }
}

function sanitizeSelectedAction(value: unknown): KeeperAction | undefined {
  if (!value || typeof value !== 'object') {
    return undefined
  }

  const action = value as Partial<KeeperAction>
  const label = cleanInlineText(action.label, 200)

  if (!label) {
    return undefined
  }

  const intent = normalizeActionIntent(action.intent)

  return {
    beliefSignal: normalizeBeliefSignal(action.beliefSignal),
    id: cleanInlineText(action.id, 80) ?? 'selected-action',
    intent:
      intent?.type === 'move'
        ? { to: cleanInlineText(intent.to, 64) ?? '', type: 'move' }
        : intent,
    label,
    mythRuleId: cleanInlineText(action.mythRuleId, 80),
  }
}

function sanitizeCheckResults(value: unknown): KeeperCheckResult[] | undefined {
  if (!Array.isArray(value)) {
    return undefined
  }

  const results = value.flatMap((item): KeeperCheckResult[] => {
    if (!item || typeof item !== 'object') {
      return []
    }

    const result = item as Partial<KeeperCheckResult>
    const attribute = cleanInlineText(result.attribute, 30)
    const reason = cleanInlineText(result.reason, 200)
    const difficulty = clampNumber(result.difficulty, 1, 100)
    const roll = clampNumber(result.roll, 1, 100)

    if (!attribute || !reason || difficulty === undefined || roll === undefined) {
      return []
    }

    return [
      {
        attribute,
        difficulty,
        outcome: result.outcome === 'success' ? 'success' : 'failure',
        reason,
        roll,
      },
    ]
  })

  return results.length > 0 ? results.slice(0, 6) : undefined
}

function sanitizeHistory(value: unknown): TurnHistoryEntry[] | undefined {
  if (!Array.isArray(value)) {
    return undefined
  }

  const entries = value
    .slice(-8)
    .flatMap((item): TurnHistoryEntry[] => {
      if (!item || typeof item !== 'object') {
        return []
      }

      const entry = item as Partial<TurnHistoryEntry>
      const playerAction = cleanInlineText(entry.playerAction, 400)
      const narration = (Array.isArray(entry.narration) ? entry.narration : [])
        .map((paragraph) => cleanText(paragraph, 400))
        .filter((paragraph): paragraph is string => Boolean(paragraph))
        .slice(0, 5)

      if (!playerAction && narration.length === 0) {
        return []
      }

      return [{ narration, playerAction: playerAction ?? '（未紀錄）' }]
    })

  return entries.length > 0 ? entries : undefined
}

export function sanitizeKeeperRequest(value: unknown): KeeperRequestBody {
  if (!value || typeof value !== 'object') {
    return {}
  }

  const body = value as KeeperRequestBody

  return {
    character: sanitizeCharacter(body.character),
    checkResults: sanitizeCheckResults(body.checkResults),
    history: sanitizeHistory(body.history),
    playerAction: cleanText(body.playerAction, 500),
    sceneId: cleanInlineText(body.sceneId, 64),
    selectedAction: sanitizeSelectedAction(body.selectedAction),
    state: sanitizeState(body.state),
  }
}
