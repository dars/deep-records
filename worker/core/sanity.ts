// SAN 判定引擎：依 sanity-rules.md 的「通過損失/未通過損失」規格擲骰。
// 模型透過 effects.sanityCheck 回報事件，server 在這裡擲 1D100 對目前 SAN、
// 計算損失並記錄 san_checked_* 旗標，確保同一事件不重複扣除。
import type { KeeperResponse, KeeperWireState } from '../../shared/keeper'

export type SanityCheckResolution = {
  delta: number
  loss: number
  passed: boolean
  roll: number
}

const specPattern = /^(\d+(?:D\d+)?)\/(\d+(?:D\d+)?)$/i
const eventFlagPattern = /^[a-z0-9_]{1,64}$/

export function rollDiceExpression(
  expression: string,
  random: () => number = Math.random,
): number | undefined {
  const match = expression.match(/^(\d+)(?:D(\d+))?$/i)

  if (!match) {
    return undefined
  }

  const count = Number(match[1])
  const sides = match[2] ? Number(match[2]) : undefined

  if (sides === undefined) {
    return count
  }

  if (count < 1 || count > 10 || sides < 2 || sides > 100) {
    return undefined
  }

  let total = 0

  for (let index = 0; index < count; index += 1) {
    total += Math.floor(random() * sides) + 1
  }

  return total
}

export function resolveSanityCheck(
  spec: string,
  currentSanity: number,
  random: () => number = Math.random,
): SanityCheckResolution | undefined {
  const match = spec.trim().match(specPattern)

  if (!match) {
    return undefined
  }

  const roll = Math.floor(random() * 100) + 1
  const passed = roll <= currentSanity
  const loss = rollDiceExpression(passed ? match[1] : match[2], random)

  if (loss === undefined) {
    return undefined
  }

  return {
    delta: loss === 0 ? 0 : -loss,
    loss,
    passed,
    roll,
  }
}

export function getCurrentSanity(state?: KeeperWireState): number {
  if (typeof state?.sanity === 'number') {
    return state.sanity
  }

  return state?.sanity?.current ?? 55
}

// 把模型回報的 effects.sanityCheck 解析成實際的 sanityDelta 與事件旗標。
// 已判定過的事件（旗標已存在）直接忽略，防止重複扣除。
export function resolveSanityEffects(
  response: KeeperResponse,
  state?: KeeperWireState,
  random: () => number = Math.random,
): KeeperResponse {
  const sanityCheck = response.effects?.sanityCheck

  if (!sanityCheck) {
    return response
  }

  const { sanityCheck: _discarded, ...effects } = response.effects ?? {}
  const eventFlag = sanityCheck.eventFlag?.trim() ?? ''

  if (
    !eventFlagPattern.test(eventFlag) ||
    state?.flags?.[eventFlag] === true
  ) {
    return { ...response, effects }
  }

  const resolution = resolveSanityCheck(
    sanityCheck.spec,
    getCurrentSanity(state),
    random,
  )

  if (!resolution) {
    return { ...response, effects }
  }

  return {
    ...response,
    effects: {
      ...effects,
      sanityDelta:
        resolution.delta !== 0 ? resolution.delta : effects.sanityDelta,
      setFlags: {
        ...effects.setFlags,
        [eventFlag]: true,
      },
    },
  }
}
