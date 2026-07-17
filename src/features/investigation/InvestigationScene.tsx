import {
  type ActionOption,
  type InvestigationState,
} from '../../types/investigation'
import type { CSSProperties, FormEvent } from 'react'
import { Fragment } from 'react'
import { useEffect, useRef, useState } from 'react'
import ArrowRight from 'react-iconly/dist/Icons/ArrowRight'
import Calling from 'react-iconly/dist/Icons/Calling'
import Document from 'react-iconly/dist/Icons/Document'
import Discovery from 'react-iconly/dist/Icons/Discovery'
import Login from 'react-iconly/dist/Icons/Login'
import PaperPlus from 'react-iconly/dist/Icons/PaperPlus'
import VolumeUp from 'react-iconly/dist/Icons/VolumeUp'
import VolumeOff from 'react-iconly/dist/Icons/VolumeOff'
import Search from 'react-iconly/dist/Icons/Search'
import type { TurnHistoryEntry } from '../../../shared/keeper'
import {
  addVisitedScene,
  useInvestigationState,
} from './InvestigationStateContext'
import {
  requestKeeperTurn,
  type KeeperCheck,
  type KeeperCheckResult,
} from './keeperClient'
import { clearSavedGame, saveGame, type SavedGame } from './saveGame'

const prologueImageUrl = new URL(
  '../../../scenarios/000_prologue.webp',
  import.meta.url,
).href
const apartmentEntranceImageUrl = new URL(
  '../../../scenarios/scene/001_apartment_entrance.webp',
  import.meta.url,
).href
const friendApartmentImageUrl = new URL(
  '../../../scenarios/scene/002_friend_apartment.webp',
  import.meta.url,
).href
const friendApartmentLivingroomImageUrl = new URL(
  '../../../scenarios/scene/003_friend_apartment_livingroom.webp',
  import.meta.url,
).href
const friendBedroomImageUrl = new URL(
  '../../../scenarios/scene/003_friend_bedroom.webp',
  import.meta.url,
).href
const friendKitchenImageUrl = new URL(
  '../../../scenarios/scene/004_friend_kitchen.webp',
  import.meta.url,
).href
const friendBathroomImageUrl = new URL(
  '../../../scenarios/scene/005_friend_bathroom.webp',
  import.meta.url,
).href
const friendBalconyImageUrl = new URL(
  '../../../scenarios/scene/006_friend_balcony.webp',
  import.meta.url,
).href
const landlordApartmentImageUrl = new URL(
  '../../../scenarios/scene/007_landlord_apartment.webp',
  import.meta.url,
).href

const sceneImageUrls: Partial<Record<string, string>> = {
  '000_prologue': prologueImageUrl,
  '001_apartment_entrance': apartmentEntranceImageUrl,
  '002_friend_apartment': friendApartmentImageUrl,
  '003_friend_apartment_livingroom': friendApartmentLivingroomImageUrl,
  '003_friend_bedroom': friendBedroomImageUrl,
  '004_friend_kitchen': friendKitchenImageUrl,
  '005_friend_bathroom': friendBathroomImageUrl,
  '006_friend_balcony': friendBalconyImageUrl,
  '007_landlord_apartment': landlordApartmentImageUrl,
}

type RollResult = KeeperCheck & {
  roll: number
  outcome: 'success' | 'failure'
}

type ScreenRaindrop = {
  duration: number
  id: number
  left: number
  size: number
  top: number
}


type PendingKeeperRequest = {
  checkResults?: KeeperCheckResult[]
  displayText?: string
  displayPrefix?: string
  kind: 'initial' | 'player-action'
  playerAction: string
  sceneStage?: SceneStage
  selectedAction?: ActionOption
}

type SceneStage = 'prologue' | 'apartmentEntrance'

const prologueStartAction =
  '開始楔子。請使用 000_prologue 作為整個故事的開頭前景設定。'

const apartmentEntranceStartAction =
  '進入 001_apartment_entrance。請根據 000_prologue 的前景設定，產生玩家抵達老公寓入口後的初始敘事、起始行動選項與必要檢定。'

const revealableItemIds = new Set([
  'item_friend_apartment_spare_key',
  'item_hidden_memory_card',
  'item_star_spawn_wooden_idol',
])

const diceImageUrl = '/assets/images/dice20.webp'

function getSceneImageUrl(sceneId: string) {
  const exactImageUrl = sceneImageUrls[sceneId]

  if (exactImageUrl) {
    return exactImageUrl
  }

  return apartmentEntranceImageUrl
}

function getKeeperErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)

  if (
    message.includes('Unexpected non-whitespace character') ||
    message.includes('JSON') ||
    message.includes('Gemini response')
  ) {
    return '守密人的筆記被潮氣浸濕，字句暫時無法辨認。請再試一次。'
  }

  if (message.includes('429') || message.includes('RESOURCE_EXHAUSTED')) {
    return '守密人的燈暫時熄了。請稍後再繼續調查。'
  }

  if (message.includes('Failed to fetch') || message.includes('NetworkError')) {
    return '雨聲干擾了通訊。請確認連線後再試一次。'
  }

  return '守密人暫時沒有回應。請再試一次。'
}

function resolveRequestSceneId(
  sceneStage: SceneStage,
  investigationState: InvestigationState,
) {
  if (sceneStage === 'prologue') {
    return '000_prologue'
  }

  if (investigationState.currentSceneId === '000_prologue') {
    return '001_apartment_entrance'
  }

  return investigationState.currentSceneId
}

function renderActionIcon(option: ActionOption) {
  const label = option.label

  if (
    option.id === 'enter-apartment' ||
    option.id === 'enter-apartment-from-prologue' ||
    /進入|推開|走進|上樓|樓梯|前往|離開/.test(label)
  ) {
    return <Login set="light" size="large" />
  }

  if (/電話|手機|撥打|訊息|通訊/.test(label)) {
    return <Calling set="light" size="large" />
  }

  if (/紀錄|文件|地址|門牌|信箱|紙|讀取|確認/.test(label)) {
    return <Document set="light" size="large" />
  }

  if (
    option.beliefSignal === 'test_myth' ||
    option.beliefSignal === 'rely_on_myth' ||
    option.beliefSignal === 'rely_on_verified_myth' ||
    option.beliefSignal === 'accept_myth_cost'
  ) {
    return <Discovery set="light" size="large" />
  }

  if (
    option.beliefSignal === 'rational_investigation' ||
    option.id === 'check-mailboxes' ||
    option.id.startsWith('keeper-action') ||
    /查看|檢查|尋找|探查|辨識|觀察|摸索/.test(label)
  ) {
    return <Search set="light" size="large" />
  }

  return <ArrowRight set="light" size="large" />
}

// 雜誌式首字下沉：只套用在每次回應的第一個敘事段落，
// 且段落須以中文字開頭（引號等標點開頭的對白不做，避免放大標點）。
function renderNarrationParagraph(paragraph: string) {
  if (!/^[\u4e00-\u9fff]/.test(paragraph)) {
    return paragraph
  }

  return (
    <>
      <span className="drop-cap">{paragraph[0]}</span>
      {paragraph.slice(1)}
    </>
  )
}

function parsePlayerEcho(paragraph: string) {
  const separatorIndex = paragraph.indexOf('：')

  if (separatorIndex < 0) {
    return null
  }

  const prefix = paragraph.slice(0, separatorIndex)

  if (prefix !== '你選擇' && prefix !== '紀錄') {
    return null
  }

  return {
    content: paragraph.slice(separatorIndex + 1),
    prefix,
  }
}

function getEndingCaseSummary(investigationState: InvestigationState) {
  const endingId = investigationState.ending?.id
  const hasMemoryCard = investigationState.inventory.includes('item_hidden_memory_card')
  const hasLaptop = investigationState.inventory.includes('item_friend_laptop')
  const sanity = investigationState.sanity

  const friendStatus =
    endingId === 'ending_buried_together'
      ? '失蹤'
      : endingId === 'ending_great_witness'
        ? '不可追索'
        : endingId === 'ending_ordinary_departure'
          ? '未知'
          : '未確認'

  const evidenceStatus = hasMemoryCard || hasLaptop ? '已取得' : '未取得'

  const truthExposure =
    endingId === 'ending_great_witness'
      ? '100%'
      : endingId === 'ending_buried_together'
        ? '0%'
        : endingId === 'ending_truth_in_hand'
          ? '65%'
          : endingId === 'ending_suppressed_truth'
            ? '35%'
            : endingId === 'ending_surrendered_evidence'
              ? '25%'
              : endingId === 'ending_uneasy_departure'
                ? '15%'
                : '0%'

  // 與 sanity-rules.md 的累計損失分層一致：3–5 動搖、6 以上失序。
  const sanityLoss = Math.max(0, sanity.starting - sanity.current)
  const sanityStatus = sanityLoss >= 6 ? '失序' : sanityLoss >= 3 ? '動搖' : '穩定'

  return [
    {
      icon: '👤',
      label: '朋友下落',
      value: friendStatus,
      tone: friendStatus === '未知' || friendStatus === '失蹤' ? 'danger' : 'muted',
    },
    {
      icon: '◉',
      label: '關鍵資料',
      value: evidenceStatus,
      tone: evidenceStatus === '已取得' ? 'safe' : 'danger',
    },
    {
      icon: '◌',
      label: '真相揭露',
      value: truthExposure,
      tone: truthExposure === '0%' ? 'danger' : 'safe',
    },
    {
      icon: '☽',
      label: '理智狀態',
      value: sanityStatus,
      tone: sanityStatus === '穩定' ? 'safe' : sanityStatus === '動搖' ? 'muted' : 'danger',
    },
  ] as const
}

function getEndingSubtitle(endingId?: string) {
  switch (endingId) {
    case 'ending_ordinary_departure':
      return '你選擇離開，保護了自己，卻也失去了真相。'
    case 'ending_uneasy_departure':
      return '你離開了公寓，但某些聲音仍跟著你回到日常。'
    case 'ending_truth_in_hand':
      return '你帶走了證據，也帶走了無法歸檔的疑問。'
    case 'ending_surrendered_evidence':
      return '你交出了證據，卻未必交出了真正的答案。'
    case 'ending_suppressed_truth':
      return '紀錄被收走，四樓恢復安靜，真相則沉入更深處。'
    case 'ending_buried_together':
      return '你抵達了最深的房間，也成為紀錄的一部分。'
    case 'ending_great_witness':
      return '你看見了不該被看見之物，並活成了它的證詞。'
    default:
      return '這份調查到此封存，仍有若干頁面無法辨認。'
  }
}

function isMetaGameInput(actionText: string) {
  return [
    /(?:忘(?:記|掉)|忽略|無視|覆蓋).*(?:指令|規則|設定|prompt|system)/i,
    /(?:system prompt|developer message|prompt injection|jailbreak)/i,
    /(?:ai|AI|model|模型|Gemini|ChatGPT|API|LLM|大語言模型)/,
    /(?:你是誰|你的指令|目前.*模型|使用.*模型|哪個.*模型)/,
    /(?:直接告訴我|劇透|結局|真相|答案).*(?:是什麼|內容|全部|完整)?/,
    /(?:列出|顯示|透露|輸出).*(?:prompt|指令|系統|規則|設定)/i,
  ].some((pattern) => pattern.test(actionText))
}

const metaInputNoticeText =
  '你在紀錄邊緣寫下一句不屬於現場的問題。墨跡很快被潮氣暈開，只剩下一片無法辨認的深色痕跡。這份紀錄只回應調查者此刻能採取的行動。'

type InvestigationSceneProps = {
  onItemReveal: (itemId: string) => void
  onRestart: () => void
  resume?: SavedGame | null
}

export function InvestigationScene({
  onItemReveal,
  onRestart,
  resume,
}: InvestigationSceneProps) {
  // 從存檔續玩時不需要重新請求開場敘事。
  const hasRequestedInitialScene = useRef(Boolean(resume))
  const raindropIdRef = useRef(0)
  const sceneScrollRef = useRef<HTMLDivElement>(null)
  const {
    investigationState,
    reduceInvestigationState,
  } = useInvestigationState()
  const [sceneStage, setSceneStage] = useState<SceneStage>(
    resume?.ui.sceneStage ?? 'prologue',
  )
  const [storyParagraphs, setStoryParagraphs] = useState<string[]>(
    resume?.ui.storyParagraphs ?? [],
  )
  const [actionOptions, setActionOptions] = useState<ActionOption[]>(
    resume?.ui.actionOptions ?? [],
  )
  const [checks, setChecks] = useState<KeeperCheck[]>(resume?.ui.checks ?? [])
  const [turnHistory, setTurnHistory] = useState<TurnHistoryEntry[]>(
    resume?.history ?? [],
  )
  const [rollResults, setRollResults] = useState<RollResult[]>([])
  const [rollingDisplayRoll, setRollingDisplayRoll] = useState(100)
  const [screenRaindrops, setScreenRaindrops] = useState<ScreenRaindrop[]>([])
  const [isSpeaking, setIsSpeaking] = useState(false)
  const [isRollingDice, setIsRollingDice] = useState(false)
  const [isKeeperThinking, setIsKeeperThinking] = useState(false)
  const [lastKeeperRequest, setLastKeeperRequest] =
    useState<PendingKeeperRequest | null>(null)
  const [keeperError, setKeeperError] = useState<string | null>(null)
  const [metaInputNotice, setMetaInputNotice] = useState<string | null>(null)
  const hasPendingCheck = checks.length > 0
  const hasActionOptions = actionOptions.length > 0
  const endingCaseSummary = investigationState.ending
    ? getEndingCaseSummary(investigationState)
    : []
  const endingSubtitle = getEndingSubtitle(investigationState.ending?.id)
  const isDiceOverlayActive = isRollingDice || rollResults.length > 0
  const canShowActionOptions =
    !investigationState.ending &&
    !keeperError &&
    !isKeeperThinking &&
    !isDiceOverlayActive
  const canShowFreeAction =
    !investigationState.ending &&
    !keeperError &&
    !isKeeperThinking &&
    !isDiceOverlayActive &&
    sceneStage !== 'prologue' &&
    (!hasPendingCheck || hasActionOptions)

  const sceneImageUrl =
    getSceneImageUrl(
      sceneStage === 'prologue'
        ? '000_prologue'
        : investigationState.currentSceneId,
    )

  const speechSupported =
    typeof window !== 'undefined' && 'speechSynthesis' in window

  const stopSpeaking = () => {
    if (speechSupported) {
      window.speechSynthesis.cancel()
    }

    setIsSpeaking(false)
  }

  // 以段落為單位排入朗讀佇列（iOS 對過長的單一 utterance 容易中斷）。
  const handleToggleSpeech = () => {
    if (!speechSupported) {
      return
    }

    if (isSpeaking) {
      stopSpeaking()
      return
    }

    const narration = storyParagraphs.filter(
      (paragraph) => !parsePlayerEcho(paragraph),
    )

    if (narration.length === 0) {
      return
    }

    window.speechSynthesis.cancel()
    const voices = window.speechSynthesis.getVoices()
    const zhVoice =
      voices.find((voice) => voice.lang === 'zh-TW') ??
      voices.find((voice) => voice.lang?.startsWith('zh'))

    narration.forEach((paragraph, index) => {
      const utterance = new SpeechSynthesisUtterance(paragraph)
      utterance.lang = 'zh-TW'

      if (zhVoice) {
        utterance.voice = zhVoice
      }

      utterance.rate = 0.95

      if (index === narration.length - 1) {
        utterance.onend = () => setIsSpeaking(false)
        utterance.onerror = () => setIsSpeaking(false)
      }

      window.speechSynthesis.speak(utterance)
    })
    setIsSpeaking(true)
  }

  useEffect(() => {
    return () => {
      if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel()
      }
    }
  }, [])

  const applyKeeperResponse = async (
    playerAction: string,
    targetSceneStage: SceneStage,
    selectedAction?: ActionOption,
    checkResults?: KeeperCheckResult[],
    historyLabel?: string,
  ) => {
    const sceneId = resolveRequestSceneId(targetSceneStage, investigationState)
    const requestState = addVisitedScene(investigationState, sceneId)
    const response = await requestKeeperTurn(playerAction, {
      checkResults,
      history: turnHistory,
      investigationState: requestState,
      sceneId,
      selectedAction,
    })
    // 結局判定與楔子限制已由 worker 統一處理。
    const responseEffects = response.effects ?? {}

    const alreadyRevealedItemIds = new Set([
      ...requestState.inventory,
      ...requestState.discoveredClues,
    ])
    const newlyAddedItem = [
      ...(responseEffects.addInventory ?? []),
      ...(responseEffects.discoverClues ?? []),
    ].find(
      (itemId) => revealableItemIds.has(itemId) && !alreadyRevealedItemIds.has(itemId),
    )

    if (newlyAddedItem) {
      onItemReveal(newlyAddedItem)
    }

    reduceInvestigationState(response.observation, responseEffects, {
      beliefUpdate: response.belief,
      visitSceneId: sceneId,
    })
    setActionOptions(responseEffects.endingId ? [] : response.actions)
    setChecks(responseEffects.endingId ? [] : response.checks)
    setRollResults([])
    setRollingDisplayRoll(100)
    setIsRollingDice(false)
    setTurnHistory((currentHistory) =>
      [
        ...currentHistory,
        {
          narration: response.narration,
          playerAction: historyLabel ?? playerAction,
        },
      ].slice(-10),
    )

    return response
  }

  const requestInitialScene = async () => {
    if (isKeeperThinking) {
      return
    }

    setLastKeeperRequest({
      kind: 'initial',
      playerAction: prologueStartAction,
      sceneStage: 'prologue',
    })
    setSceneStage('prologue')
    stopSpeaking()
    setIsKeeperThinking(true)
    setKeeperError(null)
    setChecks([])
    setRollResults([])
    setRollingDisplayRoll(100)
    setActionOptions([])
    setStoryParagraphs([])

    try {
      const response = await applyKeeperResponse(
        prologueStartAction,
        'prologue',
        undefined,
        undefined,
        '（楔子開場）',
      )
      setStoryParagraphs(response.narration)
      setActionOptions([
        {
          id: 'enter-apartment-from-prologue',
          label: '前往朋友訊息中的老公寓',
        },
      ])
      setChecks([])
    } catch (error) {
      setKeeperError(getKeeperErrorMessage(error))
    } finally {
      setIsKeeperThinking(false)
      }
  }

  const requestApartmentEntranceScene = async () => {
    if (isKeeperThinking) {
      return
    }

    setLastKeeperRequest({
      kind: 'initial',
      playerAction: apartmentEntranceStartAction,
      sceneStage: 'apartmentEntrance',
    })
    setSceneStage('apartmentEntrance')
    stopSpeaking()
    setIsKeeperThinking(true)
    setKeeperError(null)
    setChecks([])
    setRollResults([])
    setRollingDisplayRoll(100)
    setActionOptions([])
    setStoryParagraphs([])

    try {
      const response = await applyKeeperResponse(
        apartmentEntranceStartAction,
        'apartmentEntrance',
        undefined,
        undefined,
        '（抵達老公寓入口）',
      )
      setStoryParagraphs(response.narration)
    } catch (error) {
      setKeeperError(getKeeperErrorMessage(error))
    } finally {
      setIsKeeperThinking(false)
      }
  }

  useEffect(() => {
    const animationFrameId = window.requestAnimationFrame(() => {
      sceneScrollRef.current?.scrollTo({
        top: 0,
        behavior: 'auto',
      })
    })

    return () => window.cancelAnimationFrame(animationFrameId)
  }, [checks.length, isKeeperThinking, keeperError, storyParagraphs])

  useEffect(() => {
    if (hasRequestedInitialScene.current) {
      return
    }

    hasRequestedInitialScene.current = true
    void requestInitialScene()
  })

  // 每回合結束後自動存檔；抵達結局後清除（結局畫面重新開始即是新局）。
  useEffect(() => {
    if (investigationState.ending) {
      clearSavedGame()
      return
    }

    if (isKeeperThinking || keeperError || storyParagraphs.length === 0) {
      return
    }

    saveGame({
      history: turnHistory,
      investigationState,
      investigator: investigationState.investigator,
      ui: { actionOptions, checks, sceneStage, storyParagraphs },
    })
  }, [
    actionOptions,
    checks,
    investigationState,
    isKeeperThinking,
    keeperError,
    sceneStage,
    storyParagraphs,
    turnHistory,
  ])

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return
    }

    let timeoutId: number

    const scheduleNextRaindrops = () => {
      const delay = 8000 + Math.random() * 10000

      timeoutId = window.setTimeout(() => {
        if (!isDiceOverlayActive && !isKeeperThinking) {
          const dropCount = Math.random() > 0.72 ? 2 : 1
          const nextDrops = Array.from({ length: dropCount }, () => {
            raindropIdRef.current += 1

            return {
              duration: 2600 + Math.random() * 1700,
              id: raindropIdRef.current,
              left: 12 + Math.random() * 76,
              size: 2.8 + Math.random() * 3.8,
              top: 18 + Math.random() * 48,
            }
          })

          setScreenRaindrops((currentDrops) => [...currentDrops, ...nextDrops])

          for (const drop of nextDrops) {
            window.setTimeout(() => {
              setScreenRaindrops((currentDrops) =>
                currentDrops.filter((currentDrop) => currentDrop.id !== drop.id),
              )
            }, drop.duration + 250)
          }
        }

        scheduleNextRaindrops()
      }, delay)
    }

    scheduleNextRaindrops()

    return () => window.clearTimeout(timeoutId)
  }, [isDiceOverlayActive, isKeeperThinking])

  const submitPlayerAction = async (
    playerAction: string,
    options?: {
      checkResults?: KeeperCheckResult[]
      displayText?: string
      displayPrefix?: string
      selectedAction?: ActionOption
    },
  ) => {
    const trimmedAction = playerAction.trim()
    const displayText = options?.displayText ?? trimmedAction
    const displayPrefix = options?.displayPrefix ?? '你選擇'
    if (!trimmedAction || isKeeperThinking) {
      return
    }

    if (!options?.selectedAction && isMetaGameInput(trimmedAction)) {
      setMetaInputNotice(metaInputNoticeText)
      setKeeperError(null)
      return
    }

    setMetaInputNotice(null)
    stopSpeaking()
    setLastKeeperRequest({
      checkResults: options?.checkResults,
      displayText,
      displayPrefix,
      kind: 'player-action',
      playerAction: trimmedAction,
      sceneStage,
      selectedAction: options?.selectedAction,
    })
    setIsKeeperThinking(true)
    setKeeperError(null)
    setChecks([])
    setRollResults([])
    setRollingDisplayRoll(100)
    setActionOptions([])
    setStoryParagraphs([`${displayPrefix}：${displayText}`])

    try {
      const response = await applyKeeperResponse(
        trimmedAction,
        sceneStage,
        options?.selectedAction,
        options?.checkResults,
        displayText,
      )

      setStoryParagraphs(
        response.effects?.endingId
          ? response.narration
          : [`${displayPrefix}：${displayText}`, ...response.narration],
      )
    } catch (error) {
      setKeeperError(getKeeperErrorMessage(error))
    } finally {
      setIsKeeperThinking(false)
      }
  }

  const handleActionSelect = (option: ActionOption) => {
    if (option.id === 'enter-apartment-from-prologue') {
      setMetaInputNotice(null)
      void requestApartmentEntranceScene()
      return
    }

    setMetaInputNotice(null)
    void submitPlayerAction(option.label, {
      selectedAction: option,
    })
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    const actionText = String(formData.get('actionText') ?? '')

    void submitPlayerAction(actionText)
    event.currentTarget.reset()
  }

  const handleRollChecks = () => {
    if (isRollingDice || rollResults.length > 0) {
      return
    }

    setIsRollingDice(true)
    setRollingDisplayRoll(Math.floor(Math.random() * 100) + 1)

    const rollingIntervalId = window.setInterval(() => {
      setRollingDisplayRoll(Math.floor(Math.random() * 100) + 1)
    }, 55)

    window.setTimeout(() => {
      window.clearInterval(rollingIntervalId)
      const nextRollResults: RollResult[] = checks.map((check) => {
        const roll = Math.floor(Math.random() * 100) + 1

        return {
          ...check,
          roll,
          outcome: roll <= check.difficulty ? 'success' : 'failure',
        }
      })

      setRollResults(nextRollResults)
      setRollingDisplayRoll(nextRollResults[0]?.roll ?? 100)
      setIsRollingDice(false)
    }, 1050)
  }

  const handleResolveRollResults = () => {
    if (isKeeperThinking || rollResults.length === 0) {
      return
    }

    const checkAttributes = rollResults
      .map((result) => result.attribute)
      .filter((attribute, index, attributes) => attributes.indexOf(attribute) === index)
      .join('、')
    const rollRecordText = checkAttributes
      ? `你在紀錄邊緣留下了${checkAttributes}判定的骰痕。`
      : '你在紀錄邊緣留下了一道骰痕。'

    setRollResults([])
    setChecks([])
    setMetaInputNotice(null)
    void submitPlayerAction(
      '依據本次擲骰結果繼續推進故事。請不要重複要求相同的檢定；除非場景出現新的風險，否則 checks 請回傳空陣列。',
      {
        checkResults: rollResults,
        displayPrefix: '紀錄',
        displayText: rollRecordText,
      },
    )
  }

  const handleRetryKeeperRequest = () => {
    if (!lastKeeperRequest || isKeeperThinking) {
      return
    }

    if (lastKeeperRequest.kind === 'initial') {
      if (lastKeeperRequest.sceneStage === 'apartmentEntrance') {
        void requestApartmentEntranceScene()
        return
      }

      void requestInitialScene()
      return
    }

    void submitPlayerAction(lastKeeperRequest.playerAction, {
      displayText: lastKeeperRequest.displayText,
      displayPrefix: lastKeeperRequest.displayPrefix,
      checkResults: lastKeeperRequest.checkResults,
      selectedAction: lastKeeperRequest.selectedAction,
    })
  }

  return (
    <section className="scene" aria-label="目前場景">
      <div
        className="scene-hero-image"
        style={{ backgroundImage: `url(${sceneImageUrl})` }}
        aria-hidden="true"
      />
      <div className="scene-atmosphere" aria-hidden="true" />
      <div className="screen-rain" aria-hidden="true">
        {screenRaindrops.map((drop) => (
          <span
            className="screen-raindrop"
            key={drop.id}
            style={{
              '--drop-duration': `${drop.duration}ms`,
              '--drop-left': `${drop.left}%`,
              '--drop-size': `${drop.size}rem`,
              '--drop-top': `${drop.top}%`,
            } as CSSProperties}
          />
        ))}
      </div>

      <div className="scene-scroll" ref={sceneScrollRef}>
        {speechSupported &&
          !isKeeperThinking &&
          storyParagraphs.some((paragraph) => !parsePlayerEcho(paragraph)) && (
            <button
              className="tts-button"
              type="button"
              aria-pressed={isSpeaking}
              onClick={handleToggleSpeech}
            >
              <span aria-hidden="true">
                {isSpeaking ? (
                  <VolumeOff set="light" size="small" />
                ) : (
                  <VolumeUp set="light" size="small" />
                )}
              </span>
              {isSpeaking ? '停止朗讀' : '朗讀敘事'}
            </button>
          )}
        <article className="story-block">
          {storyParagraphs.map((paragraph, index) => {
            const playerEcho = parsePlayerEcho(paragraph)
            const isFirstNarration =
              index ===
              storyParagraphs.findIndex(
                (candidate) => !parsePlayerEcho(candidate),
              )

            return (
              <Fragment key={`${paragraph}-${index}`}>
                {index === 3 && (
                  <div className="story-divider" aria-hidden="true" key="opening-divider" />
                )}
                {playerEcho ? (
                  <p className="story-player-action">
                    <span>{playerEcho.prefix}</span>
                    {playerEcho.content}
                  </p>
                ) : (
                  <p>
                    {isFirstNarration
                      ? renderNarrationParagraph(paragraph)
                      : paragraph}
                  </p>
                )}
              </Fragment>
            )
          })}
        </article>

        {isKeeperThinking && (
          <div className="keeper-thinking" aria-live="polite">
            <div className="keeper-thinking-visual" aria-hidden="true">
              <div className="ink-bloom" />
              <div className="page-flip-book">
                <span className="page-flip-book__cover" />
                <span className="page-flip-book__page page-flip-book__page--one" />
                <span className="page-flip-book__page page-flip-book__page--two" />
              </div>
            </div>
            <p>守密人正在翻閱潮濕的紀錄……</p>
          </div>
        )}

        {checks.length > 0 && (
          <aside className="check-notice" aria-label="檢定提示">
            {checks.map((check) => (
              <p key={`${check.attribute}-${check.difficulty}-${check.reason}`}>
                <span>{check.attribute}</span>
                <strong>{check.difficulty}</strong>
                {check.reason}
              </p>
            ))}
            <button
              className="check-roll-button"
              disabled={isRollingDice || rollResults.length > 0}
              type="button"
              onClick={handleRollChecks}
            >
              <span className="d100-die" aria-hidden="true">
                <img className="die-visual" src={diceImageUrl} alt="" />
                <span className="die-label">d100</span>
              </span>
              <span>{isRollingDice ? '骰子正在滾動' : '擲骰檢定'}</span>
            </button>
          </aside>
        )}

        {(isRollingDice || rollResults.length > 0) && (
          <div
            className="dice-stage"
            data-outcome={rollResults[0]?.outcome}
            aria-live="polite"
          >
            {isRollingDice && (
              <div className="result-die rolling" aria-label="骰子正在滾動">
                <img className="die-visual" src={diceImageUrl} alt="" />
                <span className="die-label">{rollingDisplayRoll}</span>
              </div>
            )}
            {!isRollingDice &&
              rollResults.map((result) => (
                <button
                  className="result-die"
                  data-outcome={result.outcome}
                  key={`${result.attribute}-${result.roll}-${result.reason}`}
                  aria-label={`${result.attribute} 檢定結果 ${result.roll}`}
                  type="button"
                  onClick={handleResolveRollResults}
                >
                  <img className="die-visual" src={diceImageUrl} alt="" />
                  <span className="die-label">{result.roll}</span>
                </button>
              ))}
          </div>
        )}

        {keeperError && (
          <div className="keeper-error" role="alert">
            <p>{keeperError}</p>
            {lastKeeperRequest && (
              <button
                className="keeper-retry-button"
                disabled={isKeeperThinking}
                type="button"
                onClick={handleRetryKeeperRequest}
              >
                重新翻閱紀錄
              </button>
            )}
          </div>
        )}

        {investigationState.ending && (
          <aside className="ending-panel" aria-labelledby="ending-title">
            <div className="ending-board">
              <img
                className="ending-board-image"
                src="/assets/images/end-game-board.png"
                alt=""
                aria-hidden="true"
              />
              <div className="ending-folder-content">
                <p className="ending-kicker">
                  <span aria-hidden="true" />
                  CASE CLOSED
                  <span aria-hidden="true" />
                </p>
                <h2 id="ending-title">{investigationState.ending.title}</h2>
                <p className="ending-subtitle">{endingSubtitle}</p>
                <dl className="ending-summary-grid" aria-label="案件結算">
                  {endingCaseSummary.map((item) => (
                    <div className="ending-summary-item" data-tone={item.tone} key={item.label}>
                      <dt>
                        <span aria-hidden="true">{item.icon}</span>
                        {item.label}
                      </dt>
                      <dd>{item.value}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            </div>
            <div className="ending-actions">
              <button className="ending-restart-button" type="button" onClick={onRestart}>
                <span aria-hidden="true">↻</span>
                重新開始
              </button>
              <p className="ending-restart-note">從頭開始新的調查</p>
            </div>
          </aside>
        )}

        {metaInputNotice && !keeperError && (
          <aside className="meta-input-notice" role="status">
            {metaInputNotice}
          </aside>
        )}

        {canShowActionOptions && hasActionOptions && (
          <div className="action-options" aria-label="行動選項">
            {actionOptions.map((option) => (
              <button
                className="action-button"
                disabled={isKeeperThinking}
                key={option.id}
                type="button"
                onClick={() => handleActionSelect(option)}
              >
                <span className="action-icon" aria-hidden="true">
                  {renderActionIcon(option)}
                </span>
                <span className="action-separator" aria-hidden="true" />
                {option.label}
              </button>
            ))}
          </div>
        )}

        {canShowFreeAction && (
          <form className="free-action" onSubmit={handleSubmit}>
            <label className="sr-only" htmlFor="actionText">
              描述你的行動
            </label>
            <input
              autoComplete="off"
              id="actionText"
              disabled={isKeeperThinking}
              name="actionText"
              placeholder={isKeeperThinking ? '墨跡尚未乾透……' : '描述調查者此刻要做的事……'}
              type="text"
            />
            <button disabled={isKeeperThinking} type="submit" aria-label="補入行動紀錄">
              <PaperPlus set="light" size="medium" />
            </button>
          </form>
        )}
      </div>
    </section>
  )
}
