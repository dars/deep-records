// 警員阿陽的登場觸發（officer_a_yang.md「觸發到場」與 demo-rules.md 第二個不可逆門檻）。
// 登場是 server 端確定性事件：設下 officer_a_yang_arrived 旗標後，
// references 觸發器會在之後每一回合把阿陽的設定檔注入 prompt，模型不會再「忘記」他。
import type {
  KeeperAction,
  KeeperResponse,
  KeeperWireState,
} from '../../shared/keeper'
import { leavingPattern } from './ending'
import { isWireStateDisordered } from './sanity'

const fourthFloorScenes = new Set([
  '002_friend_apartment',
  '003_friend_apartment_livingroom',
  '003_friend_bedroom',
  '004_friend_kitchen',
  '005_friend_bathroom',
  '006_friend_balcony',
])

// 記憶卡的「首次閱讀」與「與阿陽討論」判斷（與 deterministic.ts 的讀卡流程一致）。
const memoryCardPattern = /記憶卡|micro ?sd|讀卡機|card reader/i
const readingPattern = /讀取|查看|打開|瀏覽|連接|接上|插入|檔案|資料|照片|影片/i
const discussWithOfficerPattern =
  /阿陽|警員|警察|員警|遞給|交給|給他|讓他|他看|他讀|一起看|問他|討論|說明|解釋|展示|秀給/

// 對阿陽（或在場信徒）動手的偵測：BGM 緊張切換與後續敘事依據。
export const attackOfficerPattern =
  /攻擊|揮拳|出拳|打(?:他|向|倒)|毆|撲向|襲擊|動手|勒住|掐|砸向|踢(?:他|向)|奪(?:槍|械)|反擊/

const callsPolicePattern = /報警|打給警|打電話.*警|撥打?\s*110|打\s*110|叫警察|通知警方|請警方/

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

// 登場完全按時間表走，不論調查深度——「鄰居反映怪聲」本來就與玩家做了
// 什麼無關，他照自己的時間表出現。回合數只在時鐘缺值時當退回判斷，
// 同時也是漂流玩家的節奏保證與模型呼叫的成本上限。
export const scheduledArrivalTurn = 12
// 時間觸發：阿陽的例行到場時刻（02:00）；儀式死線前的押送下令時刻（02:45，
// 凌晨三時滿潮前房東必須完成準備）。時鐘缺值時退回回合數判斷。
export const officerArrivalClockMinutes = 2 * 60
export const ritualDeadlineClockMinutes = 2 * 60 + 45

function clockOf(state?: KeeperWireState): number | undefined {
  return typeof state?.clockMinutes === 'number' ? state.clockMinutes : undefined
}

export function handleOfficerArrival(
  sceneId: string,
  playerAction: string,
  selectedAction?: KeeperAction,
  state?: KeeperWireState,
  turnIndex?: number,
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
  const clock = clockOf(state)
  const arrivalDue =
    clock !== undefined
      ? clock >= officerArrivalClockMinutes
      : (turnIndex ?? 0) >= scheduledArrivalTurn

  if (!callsPolice && !arrivalDue) {
    return undefined
  }

  // 首讀豁免：玩家第一次調查記憶卡內容的回合不打斷（避免按下讀卡
  // 卻被敲門搶佔的割裂感）；讀過之後（重複調查）不在此限。
  const isFirstCardReading =
    !callsPolice &&
    state?.flags?.memory_card_initial_files_opened !== true &&
    memoryCardPattern.test(actionText) &&
    readingPattern.test(actionText)

  if (isFirstCardReading) {
    return undefined
  }

  const isInStairwell = sceneId === '002_friend_apartment'
  // 玩家已把入口的門破壞（例如消防隊員撞門）：門不再能阻擋任何人，
  // 阿陽到場時直接長驅直入，門外敲門／等待狀態機不適用。
  const doorBroken = state?.flags?.friend_apartment_door_broken === true
  const disordered = isWireStateDisordered(state)
  const narration = callsPolice
    ? buildCalledArrivalNarration(isInStairwell, disordered, doorBroken)
    : buildScheduledArrivalNarration(isInStairwell, disordered, doorBroken)

  return {
    actions: isInStairwell || doorBroken ? stairwellArrivalActions : doorKnockActions,
    checks: [],
    effects: {
      setFlags: {
        officer_a_yang_arrived: true,
        // 樓梯間登場沒有門相隔，或門已被破壞，視為直接正面接觸（門外流程不適用）。
        ...(isInStairwell || doorBroken ? { officer_door_opened: true } : {}),
        ...(callsPolice ? { officer_called_by_player: true } : {}),
      },
    },
    narration,
    observation: {
      reason: callsPolice
        ? '玩家主動報警，由地方警員阿陽到場回應。'
        : '時間到了阿陽的例行到場時刻，房東按排程安排他到場。',
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

function buildScheduledArrivalNarration(
  isInStairwell: boolean,
  disordered: boolean,
  doorBroken = false,
): string[] {
  if (doorBroken) {
    return disordered
      ? [
          '樓下傳來上樓的聲音，一階一階，卻在轉角前多停了半拍——像是先隔著那道破損的門洞確認了什麼，才繼續往上走。',
          '玄關那扇被撞壞、斜倒在地的門什麼都擋不住了。腳步聲直接穿過門洞，制服的輪廓出現在破損的門框裡，視線毫不猶豫地落在你身上。「你好，我們接到鄰居反映……」那句話標準得像背出來的，可是他連看都沒看那扇壞掉的門一眼，彷彿它從一開始就不存在。',
        ]
      : [
          '公共樓梯間傳來上樓的腳步聲，一階一階、不疾不徐，混著無線電短促的雜訊。玄關那扇被撞壞、斜倒在地的門完全擋不住視線與聲音。',
          '腳步聲直接穿過破損的門框，一名體格精壯的制服員警出現在門洞前，視線一掃便直接落在你身上——沒有敲門，也沒有停頓。「你好，我們接到鄰居反映，說這裡一直傳出怪聲。」他的目光在斷裂的門板上停了一瞬，隨即若無其事地移回你臉上。',
        ]
  }

  if (disordered) {
    return isInStairwell
      ? [
          '樓下傳來上樓的聲音。你數著——但數不準：有時是兩隻腳的節奏，有時你發誓聽見第三下著地，濕的、軟的，像有什麼東西跟在那腳步的影子裡一起上來。',
          '轉角出現的輪廓穿著制服。是個警察——應該是。可是燈光掃過他肩膀的瞬間，你看見那套制服底下的形狀動了一下，像是布料下面還有一層東西沒對齊。他開口了，聲音平穩得完美：「你好，我們接到鄰居反映……」完美得像是背出來的。',
        ]
      : [
          '腳步聲上樓了。一階、一階——不疾不徐，規律得不像活人。你聽見無線電的雜訊，但在雜訊的底下，你發誓還有別的：一種濕潤的、拖曳的、貼著牆的聲音，跟腳步同步。',
          '然後門被敲了三下。不是拳頭敲鐵門的聲音——你聽出來了，那更沉、更悶，像某種濕重的東西拍在門板上。門外傳來平穩的男聲，自稱警察，字句標準得像照著稿念。門外的東西會說話。而且它知道該說什麼。',
        ]
  }

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

function buildCalledArrivalNarration(
  isInStairwell: boolean,
  disordered: boolean,
  doorBroken = false,
): string[] {
  if (disordered) {
    return [
      '電話接通了。值班人員的聲音在雜訊裡忽遠忽近，你說著地址，卻越說越不確定自己報的數字對不對——電話那頭安靜得太徹底，像整個機房只有那一個聲音，而它只是在等你說完。',
      doorBroken
        ? '掛斷後快得反常，樓梯間就響起腳步聲。玄關那扇被撞壞、斜倒在地的門什麼都擋不住——制服的輪廓直接穿過破損的門洞出現在你面前，說是你報的案。可是你報案才過了幾分鐘？他連看都沒看那扇壞掉的門一眼。'
        : isInStairwell
          ? '掛斷後快得反常，樓梯間就響起腳步聲。制服的輪廓在轉角出現，朝你點頭，說是你報的案。可是你報案才過了幾分鐘？雨這麼大。他身上一滴水都沒有。'
          : '掛斷後快得反常，門就被敲了三下。那個自稱警察的聲音說：剛才是這裡報的案吧。你盯著門，突然想不起來——你剛才報案的時候，說過門牌號碼嗎？',
    ]
  }

  const arrival = doorBroken
    ? '掛斷後不到幾分鐘，樓梯間就響起上樓的腳步聲。玄關那扇被撞壞、斜倒在地的門完全擋不住視線——一名體格精壯的制服員警直接從破損的門洞走進來，視線落在你身上：「是你報的案吧？我是轄區的，姓楊。說說看，什麼狀況？」他的目光在斷裂的門板上停了一瞬，沒多問，逕自收回視線。'
    : isInStairwell
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
  // 玩家走向大門與阿陽互動時，場景必須跟著切到客廳（大門所在地）。
  forceSceneId?: string
}

const livingroomSceneId = '003_friend_apartment_livingroom'

const engagesAtDoorActionIds = new Set([
  'answer-door-to-officer',
  'open-door-after-warning',
  'question-officer-through-door',
  'demand-officer-credentials',
])

const engagesAtDoorPattern =
  /隔著(?:鐵|木|大)?門|走[向到]門|到門(?:口|邊|前)|門口|大門|應門|開門|去開|質問|確認.*(?:身分|來意)|要求.*證件|(?:警|警察|員警|阿陽).*(?:對話|說話|交談|回應|回話)/

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
  // 玩家這回合的姿態：是否躲藏。以最後一次門外回合的姿態決定進門變體。
  const isHidingNow = hidingPattern.test(actionText)
  const opensDoor =
    !refusesToOpen &&
    (selectedAction?.id === 'answer-door-to-officer' ||
      selectedAction?.id === 'open-door-after-warning' ||
      /開門|應門|打開(?:鐵|木|大)?門|讓他進|請他進|迎接|去開/.test(actionText))
  // 大門在客廳：玩家從其他房間走向門口與阿陽互動時，場景必須切到客廳。
  const engagesAtDoor =
    !refusesToOpen &&
    (opensDoor ||
      (selectedAction ? engagesAtDoorActionIds.has(selectedAction.id) : false) ||
      engagesAtDoorPattern.test(actionText))
  const forceSceneId =
    engagesAtDoor && sceneId !== livingroomSceneId ? livingroomSceneId : undefined

  if (opensDoor) {
    // 交給模型演開門後的問話；旗標讓狀態機停下、提醒模型他已在場。
    return {
      forceSceneId,
      markFlags: { officer_door_opened: true, player_hiding: false },
    }
  }

  if (flags.officer_wait_one !== true) {
    return {
      forceSceneId,
      markFlags: { officer_wait_one: true, player_hiding: isHidingNow },
    }
  }

  if (flags.officer_knock_escalated !== true) {
    return {
      forceSceneId,
      markFlags: { player_hiding: isHidingNow },
      preempt: buildEscalationResponse(isWireStateDisordered(state)),
    }
  }

  // 進門時刻：玩家若躲著（上一回合姿態或本回合動作），阿陽的進場
  // 只能被「聽見」——玩家不知道他的狀況，進入躲藏狀態機。
  if (flags.player_hiding === true || isHidingNow) {
    return { markFlags: { player_hiding: true }, preempt: buildHiddenKeyEntryResponse() }
  }

  return { forceSceneId, preempt: buildKeyEntryResponse(isWireStateDisordered(state)) }
}

// 只匹配「藏自己」：藏起／藏到常指藏物品（例如把記憶卡藏起來），不算躲藏。
// ── 見證者熟成度與押送節奏 ──────────────────────────────────────
// 信徒要的是「成熟的見證者」：押送時機由熟成度決定，而非固定回合數。
// 不熟時阿陽以控場問話養成（見 buildEscortReminder）；硬上限到了
// 房東等不及，不熟也押（接「非理想見證者 → buried_together」線）。

export function computeWitnessReadiness(state?: KeeperWireState): number {
  const flags = state?.flags ?? {}
  const clues = new Set(state?.discoveredClues ?? [])
  const sanity = state?.sanity
  const lostToday =
    typeof sanity === 'object' && sanity !== null ? (sanity.lostToday ?? 0) : 0
  const stage = state?.belief?.stage ?? 'skeptical'

  let score = 0

  // 核心神話暴露：沒讀過記憶卡的見證者沒有意義。
  if (flags.memory_card_initial_files_opened === true) {
    score += 2
  }

  // 理智上的衝擊（累計損失分層：動搖 ≥3）。
  if (lostToday >= 3) {
    score += 2
  } else if (lostToday >= 1) {
    score += 1
  }

  // 信念已離開懷疑階段。
  if (stage !== 'skeptical') {
    score += 1
  }

  // 關鍵神話物件的接觸深度（上限 2）。
  let clueScore = 0

  if (
    flags.star_spawn_idol_examined === true ||
    clues.has('item_star_spawn_wooden_idol')
  ) {
    clueScore += 1
  }

  if (clues.has('item_deep_sea_gold_brooch')) {
    clueScore += 1
  }

  if (clues.has('item_warding_star_mark')) {
    clueScore += 1
  }

  return score + Math.min(2, clueScore)
}

export const witnessRipeThreshold = 4

const stayTurnFlags = [
  'officer_stay_turn_1',
  'officer_stay_turn_2',
  'officer_stay_turn_3',
  'officer_stay_turn_4',
  'officer_stay_turn_5',
]

export type EscortPacingResult = {
  markFlags?: Record<string, boolean>
  preempt?: KeeperResponse
}

export function processEscortPacing(
  sceneId: string,
  playerAction: string,
  selectedAction?: KeeperAction,
  state?: KeeperWireState,
): EscortPacingResult | undefined {
  const flags = state?.flags ?? {}

  if (
    !isOfficerPresent(state) ||
    sceneId === '007_landlord_apartment' ||
    !fourthFloorScenes.has(sceneId)
  ) {
    return undefined
  }

  // 躲藏狀態機優先；被制服時交給模型的拘束流程。
  if (
    (flags.player_hiding === true && flags.officer_found_hiding_player !== true) ||
    flags.officer_player_restrained === true
  ) {
    return undefined
  }

  // 已召喚：本回合不論玩家做什麼都押送上樓。
  if (flags.officer_escort_summons === true) {
    const actionText = `${selectedAction?.label ?? ''}\n${playerAction}`
    const resists = /抗拒|反抗|掙脫|推開|拒絕|不上去|不跟|逃|甩開|掙扎/.test(actionText)
    const ripe = computeWitnessReadiness(state) >= witnessRipeThreshold

    return {
      preempt: buildEscortResponse(ripe, resists, isWireStateDisordered(state)),
    }
  }

  const stayCount = stayTurnFlags.filter((flag) => flags[flag] === true).length
  const ripe = computeWitnessReadiness(state) >= witnessRipeThreshold

  // 玩家正與阿陽討論記憶卡時不觸發召喚（避免劇情割裂）；
  // 該回合仍計入在場回合，且討論本身通常在累積信念與熟成度。
  const actionTextForSummons = `${selectedAction?.label ?? ''}\n${playerAction}`
  const isDiscussingCard =
    memoryCardPattern.test(actionTextForSummons) &&
    discussWithOfficerPattern.test(actionTextForSummons)

  // 夠熟且問話已有最短鋪陳、在場硬上限到，或儀式死線逼近
  //（凌晨三時的滿潮不等人）→ 召喚。
  const clock = clockOf(state)
  const deadlineReached =
    clock !== undefined && clock >= ritualDeadlineClockMinutes && stayCount >= 2

  if (
    !isDiscussingCard &&
    ((ripe && stayCount >= 2) || stayCount >= stayTurnFlags.length || deadlineReached)
  ) {
    return { preempt: buildSummonsResponse(ripe, isWireStateDisordered(state)) }
  }

  return {
    markFlags: {
      ...(stayCount < stayTurnFlags.length
        ? { [stayTurnFlags[stayCount]]: true }
        : {}),
    },
  }
}

function buildSummonsResponse(ripe: boolean, disordered = false): KeeperResponse {
  return {
    actions: [
      {
        beliefSignal: 'withhold_judgment',
        id: 'comply-and-go-upstairs',
        label: '不再抵抗，跟著他往樓上走',
      },
      {
        beliefSignal: 'rational_investigation',
        id: 'question-before-upstairs',
        label: '質問樓上有誰、為什麼要上去',
      },
      {
        beliefSignal: 'withhold_judgment',
        id: 'resist-going-upstairs',
        label: '抗拒，表明自己哪裡都不去',
      },
    ],
    checks: [],
    effects: {
      setFlags: { officer_escort_summons: true },
      timeCostMinutes: 2,
    },
    narration: disordered
      ? [
          '對講機響了。但從那個小小的黑盒子裡漏出來的不是雜訊——是水聲。很深的水。然後一個沙啞的聲音穿過水面說了三個字：「帶上來。」你看著阿陽把對講機收好，動作恭敬得不像對待機器。',
          '他轉過身。那張臉還是那張臉，可是你突然明白了一件事，明白得渾身發冷：從他進門到現在，你一次都沒有看見他眨眼。「樓上有人想見你。」殼裡的聲音說，「你朋友也在上面。」',
        ]
      : [
      '阿陽腰間的對講機忽然響了一聲。他側過身，把音量壓到最低——但這一次你還是聽見了。那不是勤務頻道的制式對答，是一個沙啞的、上了年紀的聲音，只說了三個字：「帶上來。」',
      ripe
        ? '阿陽收起對講機，回頭看你的眼神變了——不再是查案警員打量證人的眼神，而是某種近乎鄭重的注視。「樓上有人想見你。」他說，語氣平穩，「你朋友也在上面。你不是一直想知道發生了什麼事嗎——答案在五樓。」'
        : '阿陽收起對講機，臉上那層公事化的耐性像退潮一樣消失了。「時間到了。」他說，朝樓梯的方向偏了偏頭，「樓上有人要見你。你朋友也在上面。走吧——這不是商量。」',
        ],
    observation: {
      reason: '房東透過對講機下令，阿陽開始執行押送。',
      signal: 'none',
    },
  }
}

function buildEscortResponse(
  ripe: boolean,
  resists: boolean,
  disordered = false,
): KeeperResponse {
  const arrivalNarration = disordered
    ? '五樓的門在樓梯盡頭打開了——從內側，在你們抵達之前就開始動。門縫裡湧出來的燭光是活的，它舔過樓梯的階面朝你漫過來。客廳中央阿宏被綁在椅子上，房東站在他身旁——可是你看見的不只是房東：燭光裡他的輪廓在滲，領口那點綠金色的光濕潤地睜著，像一顆貼在喉嚨上的眼睛，而它正在看你。'
    : '五樓的門在樓梯盡頭——那扇你以為永遠鎖著的深色鐵門，此刻正從內側被緩緩拉開。濃重的燭光、鹽與海腥的氣味從門縫裡湧出來。客廳中央，阿宏被綁在椅子上，房東站在他身旁，領口的金飾在燭光下泛著濕潤的綠金色。'
  const restrainedFlags: Record<string, boolean> = resists
    ? { officer_player_restrained: true }
    : {}

  return {
    actions: [
      {
        beliefSignal: 'rational_investigation',
        id: 'assess-fifth-floor-scene',
        label: '強迫自己冷靜，快速掃視現場的人與物',
      },
      {
        beliefSignal: 'none',
        id: 'call-out-to-a-hong',
        label: '呼喊阿宏的名字，確認他的狀態',
      },
      {
        beliefSignal: 'rational_investigation',
        id: 'confront-landlord-upstairs',
        label: '質問房東這一切到底是什麼',
      },
    ],
    checks: [],
    effects: {
      nextSceneId: '007_landlord_apartment',
      timeCostMinutes: 4,
      sanityCheck: resists
        ? { eventFlag: 'san_checked_fifth_floor_capture', spec: '0/1' }
        : { eventFlag: 'san_checked_fifth_floor_ritual_room', spec: '0/1' },
      setFlags: restrainedFlags,
    },
    narration: resists
      ? [
          disordered
            ? '你轉身想跑，但走廊在你眼前變長了。阿陽的手扣住你手腕的瞬間，你清楚地感覺到那隻手的溫度不對——太涼，而且沒有脈搏，或者脈搏慢得不屬於人。「何必呢。」殼裡的聲音在你耳邊說。你被推上樓梯，每一階都在腳下發出濕軟的聲音，像踩在某種還活著的東西上。'
            : '你往後退，但退路早就不存在了。阿陽的動作快得不像他的體格該有的速度——手腕被扣住、反剪，你的臉頰貼上冰冷的牆面。「何必呢。」他在你耳邊說，語氣甚至稱得上惋惜。你被半拖半押地推上樓梯，每一階都在腳下發出濕木的悶響。',
          arrivalNarration,
        ]
      : ripe
        ? [
            disordered
              ? '它沒有碰你。它只是側過身，讓出樓梯的方向——你的腳自己動了，一階一階往上，你在意識的角落看著自己走，攔不住。樓梯間的燈一層比一層暗，暗得不像缺電，像光被什麼喝掉了。背後那個穿制服的形狀跟在半步之後，你聽見它的呼吸——如果那是呼吸。'
              : '阿陽沒有碰你。他只是側過身，讓出通往樓梯的方向——那個動作不像押送，像迎接。你走在前面，他跟在半步之後，樓梯間的燈一層比一層暗，濕氣一層比一層重。',
            arrivalNarration,
          ]
        : [
            disordered
              ? '一隻手落在你的肩膀上。隔著布料你都能感覺到那隻手的重量在變化——一下重、一下輕，像它還沒決定好要用多少力氣才像一隻人的手。「走吧。」你的雙腳自己開始移動。你在很遠的地方看著自己被推向樓梯口。'
              : '阿陽的手落在你的肩膀上，不重，但你清楚地知道那隻手不會再放開。「走吧。」他推著你往樓梯口去，步伐平穩得像例行公事。你想再說什麼，他只是搖頭：「上面等太久了。」',
            arrivalNarration,
          ],
    observation: {
      reason: resists
        ? '玩家抗拒押送，被阿陽制伏後強制帶往五樓。'
        : '玩家被阿陽帶往五樓儀式現場。',
      signal: 'none',
    },
  }
}

const hidingPattern = /躲|藏身|把自己藏|蜷縮|蜷進|鑽進|鑽到/

const hiddenPhaseActions: KeeperAction[] = [
  {
    beliefSignal: 'withhold_judgment',
    id: 'reveal-from-hiding',
    label: '深呼吸，主動從藏身處現身',
  },
  {
    beliefSignal: 'withhold_judgment',
    id: 'stay-hidden',
    label: '屏住呼吸，繼續躲著不動',
  },
]

// ── 躲藏狀態機 ──────────────────────────────────────────────
// 阿陽持鑰匙進門時玩家躲著：玩家看不見他，只能聽。
// 躲藏期間不得調查（任何其他動作都會被擋下），選項只有現身／繼續躲。
// 繼續躲第 1 次：他在屋裡移動、對講機低語（房東在報位置的暗示）。
// 繼續躲第 2 次：他不搜索，筆直走向藏身處——四樓一直被監視著。
export function processOfficerHiddenPhase(
  playerAction: string,
  selectedAction?: KeeperAction,
  state?: KeeperWireState,
): KeeperResponse | undefined {
  const flags = state?.flags ?? {}

  if (
    flags.officer_entered_with_key !== true ||
    flags.player_hiding !== true ||
    flags.officer_found_hiding_player === true
  ) {
    return undefined
  }

  const actionText = `${selectedAction?.label ?? ''}\n${playerAction}`
  const reveals =
    selectedAction?.id === 'reveal-from-hiding' ||
    /現身|走出|站出|出去面對|自首|投降|承認.*在/.test(actionText)
  const staysHidden =
    selectedAction?.id === 'stay-hidden' ||
    /繼續躲|屏住|不出聲|躲著|保持躲|繼續藏|一動不動/.test(actionText)

  if (reveals) {
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
        nextSceneId: livingroomSceneId,
        setFlags: { player_hiding: false },
      },
      narration: [
        '你撥開遮蔽物，從藏身的位置走出去。屋裡的腳步聲停了。',
        '他站在客廳中央，看見你出現時沒有任何驚訝——沒有戒備、沒有意外，像是早就知道你在哪裡，只是在等你自己想通。「這樣就對了。」他點點頭，語氣近乎溫和：「配合一點，對大家都好。」',
      ],
      observation: {
        reason: '玩家主動從藏身處現身面對阿陽。',
        signal: 'withhold_judgment',
      },
    }
  }

  if (staysHidden && flags.officer_hidden_wait_one !== true) {
    return {
      actions: hiddenPhaseActions,
      checks: [],
      effects: {
        setFlags: { officer_hidden_wait_one: true },
        timeCostMinutes: 5,
      },
      narration: [
        '你屏住呼吸。腳步聲在屋裡緩慢移動，停頓，再移動——不像在搜索，更像在逐一確認什麼。',
        '然後你聽見對講機的雜訊，和一段壓得極低的交談。內容聽不清，只有最後一個字被清楚地說出來：「……好。」',
      ],
      observation: {
        reason: '玩家持續躲藏；阿陽透過對講機接收指示。',
        signal: 'withhold_judgment',
      },
    }
  }

  if (staysHidden) {
    return {
      actions: [
        {
          beliefSignal: 'withhold_judgment',
          id: 'comply-after-being-found',
          label: '在光圈裡緩緩站起來，照他說的做',
        },
        {
          beliefSignal: 'rational_investigation',
          id: 'ask-how-he-knew',
          label: '質問他為什麼能直接找到你藏身的位置',
        },
        {
          beliefSignal: 'withhold_judgment',
          id: 'stay-silent-after-found',
          label: '不回話，觀察他接下來要做什麼',
        },
      ],
      checks: [],
      effects: {
        sanityCheck: {
          eventFlag: 'san_checked_found_while_hiding',
          spec: '0/1',
        },
        setFlags: {
          officer_found_hiding_player: true,
          player_hiding: false,
        },
      },
      narration: [
        '腳步聲重新響起。這一次沒有停頓，沒有試探——它穿過屋子，轉了一個彎，筆直地朝你藏身的位置走來，彷彿有人在他耳邊報出了確切的座標。',
        '遮蔽物被拉開。手電筒的光落在你臉上，光圈後面是那張平穩得近乎溫和的臉。「別這樣嘛。」他說，語氣像在勸一個鬧脾氣的孩子：「出來吧。配合一點，這也是保護你。」',
      ],
      observation: {
        reason: '玩家躲藏被阿陽精準找到；他事先知道位置。',
        signal: 'withhold_judgment',
      },
    }
  }

  // 躲藏中嘗試任何其他行動：擋下，不消耗躲藏進度。
  return {
    actions: hiddenPhaseActions,
    checks: [],
    narration: [
      '你壓下行動的念頭。此刻任何多餘的動作——翻找、移動、碰觸任何東西——發出的每一點聲響都可能立刻暴露你的位置。',
      '腳步聲還在屋裡移動。現在你只有兩個選擇：繼續躲著，或者自己走出去。',
    ],
    observation: {
      reason: '玩家躲藏期間嘗試其他行動，被處境限制。',
      signal: 'none',
    },
  }
}

function buildHiddenKeyEntryResponse(): KeeperResponse {
  return {
    actions: hiddenPhaseActions,
    checks: [],
    effects: {
      setFlags: {
        officer_door_opened: true,
        officer_entered_with_key: true,
      },
    },
    narration: [
      '門外的敲擊聲停了。幾秒的靜默後，你聽見對講機壓低的短促交談，接著是金屬摩擦——鑰匙插進了外側鐵門的鎖孔。',
      '沉重的鐵門被推開，木門的鎖芯跟著轉動。腳步聲跨進玄關，沉穩、不疾不徐，皮靴底踩在地板上的聲音一路傳到你藏身的位置。你看不見他。你只知道：他已經在屋裡了。',
      '「我進來了。」平穩的男聲響起，不大，卻清楚得像是說給整層樓聽的。「房東是屋主，已經同意我們進來確認。裡面的人，我建議你自己出來。」',
    ],
    observation: {
      reason: '玩家躲藏時，阿陽使用房東提供的鑰匙進入；玩家僅能聽見動靜。',
      signal: 'none',
    },
  }
}

function buildEscalationResponse(disordered = false): KeeperResponse {
  if (disordered) {
    return {
      actions: [
        {
          beliefSignal: 'withhold_judgment',
          id: 'open-door-after-warning',
          label: '走向門口，把門打開——不管外面站著的是什麼',
        },
        {
          beliefSignal: 'rational_investigation',
          id: 'demand-officer-credentials',
          label: '隔著門大喊，要「它」證明自己是人',
        },
        {
          beliefSignal: 'withhold_judgment',
          id: 'keep-silent-behind-door',
          label: '摀住耳朵蹲下來，等那個聲音自己停止',
        },
      ],
      checks: [],
      effects: {
        setFlags: {
          officer_knock_escalated: true,
        },
      },
      narration: [
        '敲擊聲又開始了，這次重得讓整面門在框裡震動——一下，一下，每一下之間的間隔精準得像節拍器。人的手不會這樣敲門。人的手敲不出這種濕悶的迴音。',
        '「我知道裡面有人。」那個聲音說。字句還是警察的字句——妨礙公務、依法確認——可是你聽出來了，那些詞只是殼。殼的裡面有別的東西在推著它們出來，一個字一個字，像從很深的水底浮上來的氣泡。',
      ],
      observation: {
        reason: '玩家持續不回應，阿陽依進門流程升級為公權力警告（玩家以瘋狂濾鏡感知）。',
        signal: 'none',
      },
    }
  }

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

function buildKeyEntryResponse(disordered = false): KeeperResponse {
  if (disordered) {
    return {
      actions: [
        {
          beliefSignal: 'withhold_judgment',
          id: 'comply-with-officer-questions',
          label: '盯著那張太過平穩的臉，順著「它」的問題回答',
        },
        {
          beliefSignal: 'rational_investigation',
          id: 'question-officer-about-key',
          label: '質問它——為什麼那把鑰匙會認得這扇門',
        },
        {
          beliefSignal: 'withhold_judgment',
          id: 'watch-officer-silently',
          label: '退到牆邊，數它呼吸的間隔',
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
        '金屬摩擦聲。鑰匙插進鎖孔——但你聽見的不是開鎖，是某種東西「認出」了這扇門：鎖芯轉動的聲音溫順得像在回應主人。鐵門開了，木門跟著開了，門從來就沒有真正擋過它。',
        '制服的輪廓跨進玄關，占滿門框。燈光下那張臉平穩、近乎溫和，可是你看見影子——投在牆上的影子比他慢了半拍才動，肩膀的位置多了一個不該有的彎折。「配合一點，」殼裡的聲音說，「這也是保護你。」影子先笑了。',
      ],
      observation: {
        reason: '玩家始終不開門，阿陽持鑰匙強制進入（玩家以瘋狂濾鏡感知）。',
        signal: 'none',
      },
    }
  }

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
