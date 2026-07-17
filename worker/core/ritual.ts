// 五樓終局的節奏控制：玩家抵達 007 後劇情必須急轉直下。
// 玩家有限定的自由回合數；超過後阿陽失去耐心，強制推進最後儀式。
import type { KeeperResponse, KeeperWireState } from '../../shared/keeper'

// 玩家在五樓的自由回合數（第 GRACE+1 回合觸發強制推進）。
export const ritualGraceTurns = 3

const turnFlags = ['fifth_floor_turn_1', 'fifth_floor_turn_2', 'fifth_floor_turn_3']

export type RitualPacingResult = {
  markFlags?: Record<string, boolean>
  preempt?: KeeperResponse
}

export function countRitualTurns(state?: KeeperWireState): number {
  const flags = state?.flags ?? {}

  return turnFlags.filter((flag) => flags[flag] === true).length
}

export function isRitualClimaxForced(state?: KeeperWireState): boolean {
  return state?.flags?.ritual_forced_climax === true
}

export function processRitualPacing(
  sceneId: string,
  state?: KeeperWireState,
): RitualPacingResult | undefined {
  if (sceneId !== '007_landlord_apartment' || isRitualClimaxForced(state)) {
    return undefined
  }

  const turns = countRitualTurns(state)

  if (turns < ritualGraceTurns) {
    return { markFlags: { [turnFlags[turns]]: true } }
  }

  return { preempt: buildForcedClimaxResponse() }
}

// 阿陽耐心耗盡：強制把玩家按進見證者的位置，房東開始最後儀式。
// 後續回合由模型依提醒在 1–2 回合內完成獻祭並回傳結局。
function buildForcedClimaxResponse(): KeeperResponse {
  return {
    actions: [
      {
        beliefSignal: 'none',
        id: 'struggle-against-final-hold',
        label: '用盡最後的力氣掙扎反抗',
      },
      {
        beliefSignal: 'withhold_judgment',
        id: 'shut-eyes-refuse-to-watch',
        label: '閉上眼睛，拒絕看眼前將要發生的事',
      },
      {
        beliefSignal: 'none',
        id: 'watch-what-happens-next',
        label: '睜著眼，直視接下來發生的一切',
      },
    ],
    checks: [],
    effects: {
      setFlags: {
        officer_player_restrained: true,
        ritual_forced_climax: true,
      },
    },
    narration: [
      '「夠了。」阿陽的聲音失去了先前所有的耐性。他一把扣住你的肩膀與後頸，用不容反抗的力道把你按向房間中央——正對著被綁在椅子上的阿宏。三名星之子民同時收攏，堵死你身後所有的空隙。',
      '「別再浪費主的時間。」他壓低聲音，像在陳述一件早已排定的公務：「你只需要做一件事——看著。」',
      '房東對這一切渾然不覺似地輕輕頷首，將儀式匕首舉至胸前。滿室燭火在同一瞬間輕輕一伏，布幔的陰影沿著牆面拉長。屬於這棟公寓的最後一段流程，開始了。',
    ],
    observation: {
      reason: '玩家在五樓拖延超過限度，阿陽失去耐心並強制推進儀式。',
      signal: 'none',
    },
  }
}
