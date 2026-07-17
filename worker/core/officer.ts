// 警員阿陽的登場觸發（officer_a_yang.md「觸發到場」與 demo-rules.md 第二個不可逆門檻）。
// 登場是 server 端確定性事件：設下 officer_a_yang_arrived 旗標後，
// references 觸發器會在之後每一回合把阿陽的設定檔注入 prompt，模型不會再「忘記」他。
import type {
  KeeperAction,
  KeeperResponse,
  KeeperWireState,
} from '../../shared/keeper'
import { leavingPattern } from './ending'

const fourthFloorScenes = new Set([
  '002_friend_apartment',
  '003_friend_apartment_livingroom',
  '003_friend_bedroom',
  '004_friend_kitchen',
  '005_friend_bathroom',
  '006_friend_balcony',
])

const callsPolicePattern = /報警|打給警|打電話.*警|撥打?\s*110|打\s*110|叫警察|通知警方|請警方/

// 「三次實質調查」的近似：以確定性流程會設下的里程碑推導，
// 不需要另外維護計數器欄位。
export function countSignificantInvestigations(state?: KeeperWireState): number {
  const flags = state?.flags ?? {}
  const visited = new Set(state?.visitedScenes ?? [])
  const milestones = [
    flags.star_spawn_idol_examined === true,
    flags.hidden_memory_card_found === true,
    flags.memory_card_initial_files_opened === true,
    visited.has('003_friend_bedroom'),
    visited.has('006_friend_balcony'),
  ]

  return milestones.filter(Boolean).length
}

export function hasOfficerArrived(state?: KeeperWireState): boolean {
  return state?.flags?.officer_a_yang_arrived === true
}

// 阿陽已與玩家正面接觸（開門或持鑰匙進屋）：
// 此後房間移動、逃跑與對峙一律交給模型敘事，罐頭轉場文字會忽略他的存在。
export function isOfficerPresent(state?: KeeperWireState): boolean {
  return (
    state?.flags?.officer_door_opened === true ||
    state?.flags?.officer_entered_with_key === true
  )
}

export function isPlayerRestrained(state?: KeeperWireState): boolean {
  return state?.flags?.officer_player_restrained === true
}

export function handleOfficerArrival(
  sceneId: string,
  playerAction: string,
  selectedAction?: KeeperAction,
  state?: KeeperWireState,
): KeeperResponse | undefined {
  if (hasOfficerArrived(state) || !fourthFloorScenes.has(sceneId)) {
    return undefined
  }

  const actionText = `${selectedAction?.label ?? ''}\n${playerAction}`
  const intent = selectedAction?.intent
  // 「離開公寓去報警」屬於離開結局路線（交給結局判定），不觸發到場。
  const isLeaving =
    intent?.type === 'leave' || leavingPattern.test(actionText)
  const callsPolice =
    intent?.type === 'call_police' ||
    (callsPolicePattern.test(actionText) && !isLeaving)
  const arrivalDue = countSignificantInvestigations(state) >= 3

  if (!callsPolice && !arrivalDue) {
    return undefined
  }

  const isInStairwell = sceneId === '002_friend_apartment'
  const narration = callsPolice
    ? buildCalledArrivalNarration(isInStairwell)
    : buildScheduledArrivalNarration(isInStairwell)

  return {
    actions: isInStairwell ? stairwellArrivalActions : doorKnockActions,
    checks: [],
    effects: {
      setFlags: {
        officer_a_yang_arrived: true,
        // 樓梯間登場沒有門相隔，視為直接正面接觸（門外流程不適用）。
        ...(isInStairwell ? { officer_door_opened: true } : {}),
        ...(callsPolice ? { officer_called_by_player: true } : {}),
      },
    },
    narration,
    observation: {
      reason: callsPolice
        ? '玩家主動報警，由地方警員阿陽到場回應。'
        : '玩家完成足夠的實質調查，房東安排阿陽到場。',
      signal: callsPolice ? 'rational_investigation' : 'none',
    },
  }
}

const doorKnockActions: KeeperAction[] = [
  {
    beliefSignal: 'withhold_judgment',
    id: 'answer-door-to-officer',
    label: '整理好身上的物品，走向門口應對',
  },
  {
    beliefSignal: 'rational_investigation',
    id: 'question-officer-through-door',
    label: '隔著鐵門，先確認對方的身分與來意',
  },
  {
    beliefSignal: 'withhold_judgment',
    id: 'stay-quiet-behind-door',
    label: '保持安靜，先不回應敲門聲',
  },
]

const stairwellArrivalActions: KeeperAction[] = [
  {
    beliefSignal: 'withhold_judgment',
    id: 'explain-self-to-officer',
    label: '主動向員警說明自己是屋主朋友，受託前來查看',
  },
  {
    beliefSignal: 'rational_investigation',
    id: 'observe-officer-equipment',
    label: '先觀察他的制服、裝備與名牌是否正常',
  },
  {
    beliefSignal: 'withhold_judgment',
    id: 'wait-for-officer-to-speak',
    label: '不動聲色，等他先開口',
  },
]

function buildScheduledArrivalNarration(isInStairwell: boolean): string[] {
  if (isInStairwell) {
    return [
      '你還站在四樓門外的樓梯間，樓下卻傳來規律的腳步聲，一階一階往上，混著無線電短促的雜訊與金屬裝備輕碰的聲響。',
      '一名身穿制服的員警在轉角出現，體格精壯，肩上的對講機還亮著。他在看見你的瞬間放慢腳步，語氣平穩地開口：「你好，我們接到鄰居反映，說四樓一直傳出怪聲。請問你是住戶嗎？」',
    ]
  }

  return [
    '你正打算繼續手上的動作，公共樓梯間卻傳來腳步聲，一階一階、不疾不徐地往四樓靠近，其間夾著無線電短促的雜訊。',
    '腳步聲在門外停下。幾秒的靜默後，鐵門被敲了三下，力道規律而克制。門外傳來一個平穩的男聲：「警察。我們接到鄰居反映，四樓一直傳出怪聲，麻煩開個門，配合確認一下狀況。」',
  ]
}

function buildCalledArrivalNarration(isInStairwell: boolean): string[] {
  const arrival = isInStairwell
    ? '掛斷後不到幾分鐘，樓梯間就響起上樓的腳步聲。一名體格精壯的制服員警在轉角出現，朝你點了點頭：「是你報的案吧？我是轄區的，姓楊。說說看，什麼狀況？」'
    : '掛斷後不到幾分鐘，公共樓梯間就響起腳步聲，接著鐵門被敲了三下。門外是個平穩的男聲：「警察，剛才是這裡報的案吧？麻煩開個門。」'

  return [
    '電話接通，值班人員以制式的語氣記下你的位置與描述，要你留在原地等候。通話結束後，雨聲重新填滿屋內的安靜。',
    `${arrival}這個時間、這種雨勢，他來得快得有些反常——但也許只是巡邏路線剛好經過。`,
  ]
}

// ── 阿陽門外流程狀態機 ──────────────────────────────────────────
// 登場（敲門）後玩家不開門的推進：
//   第 1 次不理 → 記錄 officer_wait_one（模型正常敘事，門外壓力持續）
//   第 2 次不理 → 搶佔回合：加重語氣警告（officer_knock_escalated）
//   第 3 次不理 → 搶佔回合：拿房東給的鑰匙開門進入（officer_entered_with_key）
// 玩家開門則記錄 officer_door_opened，之後交給模型依角色檔演問話。

const insideApartmentScenes = new Set([
  '003_friend_apartment_livingroom',
  '003_friend_bedroom',
  '004_friend_kitchen',
  '005_friend_bathroom',
  '006_friend_balcony',
])

export type OfficerDoorPhaseResult = {
  markFlags?: Record<string, boolean>
  preempt?: KeeperResponse
}

export function processOfficerDoorPhase(
  sceneId: string,
  playerAction: string,
  selectedAction?: KeeperAction,
  state?: KeeperWireState,
): OfficerDoorPhaseResult | undefined {
  const flags = state?.flags ?? {}

  if (
    flags.officer_a_yang_arrived !== true ||
    flags.officer_door_opened === true ||
    flags.officer_entered_with_key === true ||
    !insideApartmentScenes.has(sceneId)
  ) {
    return undefined
  }

  const actionText = `${selectedAction?.label ?? ''}\n${playerAction}`
  const refusesToOpen =
    /不(?:開門|應門|回應|理|出聲)|先不|保持安靜|保持沉默|假裝沒|不予理會/.test(
      actionText,
    )
  const opensDoor =
    !refusesToOpen &&
    (selectedAction?.id === 'answer-door-to-officer' ||
      selectedAction?.id === 'open-door-after-warning' ||
      /開門|應門|打開(?:鐵|木|大)?門|讓他進|請他進|迎接|去開/.test(actionText))

  if (opensDoor) {
    // 交給模型演開門後的問話；旗標讓狀態機停下、提醒模型他已在場。
    return { markFlags: { officer_door_opened: true } }
  }

  if (flags.officer_wait_one !== true) {
    return { markFlags: { officer_wait_one: true } }
  }

  if (flags.officer_knock_escalated !== true) {
    return { preempt: buildEscalationResponse() }
  }

  return { preempt: buildKeyEntryResponse() }
}

function buildEscalationResponse(): KeeperResponse {
  return {
    actions: [
      {
        beliefSignal: 'withhold_judgment',
        id: 'open-door-after-warning',
        label: '不再拖延，走向門口開門配合',
      },
      {
        beliefSignal: 'rational_investigation',
        id: 'demand-officer-credentials',
        label: '隔著門要求他出示證件與報案編號',
      },
      {
        beliefSignal: 'withhold_judgment',
        id: 'keep-silent-behind-door',
        label: '繼續保持安靜，不做任何回應',
      },
    ],
    checks: [],
    effects: {
      setFlags: {
        officer_knock_escalated: true,
      },
    },
    narration: [
      '敲門聲再度響起，這次沉重得多，一下一下敲在鐵門上，震得門框微微作響。門外的聲音也變了：先前那種近似替你著想的平穩語氣消失了。',
      '「我知道裡面有人。」他隔著門說，每個字都咬得很清楚：「你再不開門，就構成妨礙公務。我們接獲報案，有權確認屋內狀況——最後一次，請你開門配合。」',
    ],
    observation: {
      reason: '玩家持續不回應，阿陽依進門流程升級為公權力警告。',
      signal: 'none',
    },
  }
}

function buildKeyEntryResponse(): KeeperResponse {
  return {
    actions: [
      {
        beliefSignal: 'withhold_judgment',
        id: 'comply-with-officer-questions',
        label: '暫時配合他的問話，觀察他想知道什麼',
      },
      {
        beliefSignal: 'rational_investigation',
        id: 'question-officer-about-key',
        label: '質問他為什麼會有這間住處的鑰匙',
      },
      {
        beliefSignal: 'withhold_judgment',
        id: 'watch-officer-silently',
        label: '保持距離不說話，緊盯他的每個動作',
      },
    ],
    checks: [],
    effects: {
      setFlags: {
        officer_door_opened: true,
        officer_entered_with_key: true,
      },
    },
    narration: [
      '門外安靜了幾秒，接著傳來對講機壓低的短促交談聲。然後是金屬摩擦聲——鑰匙插進了外側鐵門的鎖孔。沉重的鐵門被推開，木門的鎖芯跟著轉動。',
      '身穿制服的警員跨進玄關，體格幾乎佔滿門框。他的手按在腰間裝備上，語氣平穩卻不容置疑：「房東是屋主，已經同意我們進來確認。我勸你不要再做任何多餘的動作——配合一點，這也是保護你。」',
      '他的視線快速掃過屋內，在你、你手邊的物品與四周的擺設之間停留。門口的退路，此刻就站著他。',
    ],
    observation: {
      reason: '玩家始終不開門，阿陽使用房東提供的備用鑰匙強制進入並要求配合。',
      signal: 'none',
    },
  }
}
