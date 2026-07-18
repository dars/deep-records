import { useEffect, useState } from 'react'
import { audioManager } from '../features/audio/audioManager'
import Category from 'react-iconly/dist/Icons/Category'
import Document from 'react-iconly/dist/Icons/Document'
import VolumeOff from 'react-iconly/dist/Icons/VolumeOff'
import VolumeUp from 'react-iconly/dist/Icons/VolumeUp'
import { playerRecord, recordTabs, type RecordTab } from '../data/playerRecord'
import { useInvestigationState } from '../features/investigation/InvestigationStateContext'
import type { InvestigationState } from '../types/investigation'

export type ItemRevealRecord = {
  id: string
  imageUrl: string
  subtitle: string
  title: string
}

type MobileGameLayoutProps = {
  children: (helpers: { showItemReveal: (itemId: string) => void }) => React.ReactNode
  title: string
}

const friendApartmentSpareKeyImageUrl = new URL(
  '../../scenarios/item/friend_apartment_spare_key.webp',
  import.meta.url,
).href
const hiddenMemoryCardImageUrl = new URL(
  '../../scenarios/item/hidden_memory_card.webp',
  import.meta.url,
).href
const starSpawnWoodenIdolImageUrl = new URL(
  '../../scenarios/item/star_spawn_wooden_idol.webp',
  import.meta.url,
).href
const wardingStarMarkImageUrl = new URL(
  '../../scenarios/item/warding_star_mark.webp',
  import.meta.url,
).href

const clueRecords: Record<string, { body: string; title: string }> = {
  item_friend_apartment_spare_key: {
    title: '朋友的備用鑰匙',
    body: '你在朋友住處對應的一樓信箱裡，找到一把以透明夾鏈袋包著的銅色備用鑰匙。',
  },
  item_star_spawn_wooden_idol: {
    title: '電視櫃上的觸手木雕',
    body: '一尊約五十公分高的深色木雕，扭曲的觸手造型看不出具體代表什麼；靠近時還能聞到潮濕海水與腐敗有機物混合的氣味。',
  },
  item_deep_sea_gold_brooch: {
    title: '房東領口的深海黃金',
    body: '一枚綠金色澤、波浪與觸鬚交纏的小型金飾。不同年代的照片裡，房東衣領上都是同一枚；表面永遠帶著像剛從水裡撈起的濕潤光澤。',
  },
  item_warding_star_mark: {
    title: '放射狀的守護刻痕',
    body: '阿宏床頭板背面刻著的放射狀符號，中央一道豎痕像閉起的眼睛。書桌紙堆裡留有他反覆描摹的手稿；所有查得到的零散說法都只說同一件事——它能「保護」。',
  },
  老舊信箱: {
    title: '老舊信箱',
    body: '朋友住處對應的信箱沒有上鎖，裡面塞著廣告傳單與尚未取走的信件。',
  },
  淡淡的腥味: {
    title: '淡淡的腥味',
    body: '入口樓梯間的潮濕氣味底下，似乎混著很淡的腥味。再次確認時，味道反而變得難以辨認。',
  },
  嚴重腐朽的紅色鐵門: {
    title: '嚴重腐朽的紅色鐵門',
    body: '四樓朋友住處外的紅色鐵門腐蝕得不合常理，狀況比你記憶中一年前的樣子嚴重許多。',
  },
  門縫下的黑色乾涸痕跡: {
    title: '門縫下的黑色乾涸痕跡',
    body: '黑色痕跡從門內側穿過門縫向外延伸，表面已乾涸，單憑顏色無法判斷原本是什麼。',
  },
}

const itemLabels: Record<string, string> = {
  item_friend_apartment_spare_key: '朋友公寓備用鑰匙圈',
  item_friend_laptop: '朋友的筆記型電腦',
  item_hidden_memory_card: '隱藏的記憶卡',
  item_microsd_card_reader: 'microSD 讀卡機',
  item_star_spawn_wooden_idol: '觸手造型木雕',
  item_warding_star_mark: '放射狀的守護刻痕',
}

const itemRevealRecords: Record<string, ItemRevealRecord> = {
  item_friend_apartment_spare_key: {
    id: 'item_friend_apartment_spare_key',
    imageUrl: friendApartmentSpareKeyImageUrl,
    subtitle: '取得物品',
    title: itemLabels.item_friend_apartment_spare_key,
  },
  item_hidden_memory_card: {
    id: 'item_hidden_memory_card',
    imageUrl: hiddenMemoryCardImageUrl,
    subtitle: '發現關鍵證物',
    title: itemLabels.item_hidden_memory_card,
  },
  item_star_spawn_wooden_idol: {
    id: 'item_star_spawn_wooden_idol',
    imageUrl: starSpawnWoodenIdolImageUrl,
    subtitle: '發現異常物件',
    title: itemLabels.item_star_spawn_wooden_idol,
  },
  item_warding_star_mark: {
    id: 'item_warding_star_mark',
    imageUrl: wardingStarMarkImageUrl,
    subtitle: '發現神秘符號',
    title: itemLabels.item_warding_star_mark,
  },
}

const sceneLogLabels: Record<string, string> = {
  '000_prologue': '收到朋友深夜傳來的訊息。',
  '001_apartment_entrance': '抵達老公寓入口。',
  '002_friend_apartment': '來到四樓朋友租屋處門外。',
  '003_friend_apartment_livingroom': '進入朋友租屋處的客廳。',
  '003_friend_bedroom': '進入朋友的臥房。',
  '004_friend_kitchen': '進入朋友的廚房。',
  '005_friend_bathroom': '進入朋友的廁所。',
  '006_friend_balcony': '抵達朋友租屋處的小陽台。',
  '007_landlord_apartment': '抵達五樓房東住處。',
}

function getClueRecord(clueId: string) {
  return (
    clueRecords[clueId] ?? {
      body: '這條線索已被記入調查紀錄，細節仍待後續交叉比對。',
      title: clueId,
    }
  )
}

function getItemLabel(itemId: string) {
  return itemLabels[itemId] ?? itemId
}

function getInventoryItem(itemId: string) {
  return {
    id: itemId,
    isInspectable: Boolean(itemRevealRecords[itemId]),
    label: getItemLabel(itemId),
  }
}

function getBeliefStageLabel(stage: InvestigationState['belief']['stage']) {
  switch (stage) {
    case 'hypothesis':
      return '你開始把異常現象視為可檢驗的假說。'
    case 'operational':
      return '你已經開始依據異常規則行動。'
    case 'convinced':
      return '某些原本不該成立的規則，正在成為你的現實。'
    case 'skeptical':
    default:
      return '你仍傾向用現實經驗解釋目前遭遇。'
  }
}

function buildInvestigationLogs(investigationState: InvestigationState) {
  const sceneLogs = investigationState.visitedScenes.map(
    (sceneId) => sceneLogLabels[sceneId] ?? `抵達 ${sceneId}。`,
  )
  const beliefLog = getBeliefStageLabel(investigationState.belief.stage)

  return [...sceneLogs, beliefLog]
}

export function MobileGameLayout({ children, title }: MobileGameLayoutProps) {
  const { investigationState } = useInvestigationState()
  const { investigator } = investigationState
  const [isCharacterOpen, setIsCharacterOpen] = useState(false)
  const [isCharacterClosing, setIsCharacterClosing] = useState(false)
  const [activeRecordTab, setActiveRecordTab] = useState<RecordTab>('character')
  const [itemReveal, setItemReveal] = useState<ItemRevealRecord | null>(null)
  const [isMusicEnabled, setIsMusicEnabled] = useState(true)
  const [hasMusicStarted, setHasMusicStarted] = useState(false)
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const [bgmVolume, setBgmVolume] = useState(() => audioManager.getBgmVolume())
  const currentHitPoints =
    investigationState.hitPoints?.current ?? investigator.hitPoints
  const maxHitPoints = investigationState.hitPoints?.max ?? investigator.hitPoints
  const dynamicSummary = [
    ['職業', investigator.occupationTitle],
    ['信用評級', String(investigator.creditRating)],
    [
      '理智',
      `${investigationState.sanity.current} / ${investigationState.sanity.starting}`,
    ],
    [
      '生命',
      `${currentHitPoints} / ${maxHitPoints}`,
    ],
  ]
  const discoveredClues =
    investigationState.discoveredClues.length > 0
      ? investigationState.discoveredClues.map(getClueRecord)
      : []
  const inventoryItems = investigationState.inventory.map(getInventoryItem)
  const investigationLogs = buildInvestigationLogs(investigationState)

  // BGM 與 SFX 統一由 audioManager 管理；iOS 需在手勢內解鎖。
  useEffect(() => {
    audioManager.setEnabled(isMusicEnabled)

    if (!isMusicEnabled) {
      setHasMusicStarted(false)
      return
    }

    let cancelled = false
    const attemptUnlock = () => {
      void audioManager.unlock().then((started) => {
        if (!cancelled) {
          setHasMusicStarted(started)
        }
      })
    }

    attemptUnlock()
    window.addEventListener('pointerdown', attemptUnlock, { once: true })
    window.addEventListener('keydown', attemptUnlock, { once: true })

    return () => {
      cancelled = true
      window.removeEventListener('pointerdown', attemptUnlock)
      window.removeEventListener('keydown', attemptUnlock)
    }
  }, [isMusicEnabled])

  const toggleBackgroundMusic = () => {
    setIsMusicEnabled((current) => !current)
  }

  const showItemReveal = (itemId: string) => {
    const record = itemRevealRecords[itemId]

    if (!record) {
      return
    }

    setItemReveal(record)
  }

  const closeItemReveal = () => {
    setItemReveal(null)
  }

  const openCharacterSheet = () => {
    setIsCharacterClosing(false)
    setIsCharacterOpen(true)
  }

  const closeCharacterSheet = () => {
    setIsCharacterClosing(true)
    window.setTimeout(() => {
      setIsCharacterOpen(false)
      setIsCharacterClosing(false)
    }, 280)
  }

  return (
    <main className="app-shell" aria-labelledby="page-title">
      <div className="reading-frame">
        <header className="page-header">
          <button
            className="icon-button menu-button"
            type="button"
            aria-label="開啟選單"
            aria-expanded={isMenuOpen}
            onClick={() => setIsMenuOpen(true)}
          >
            <Category set="light" size="large" />
          </button>
          <h1 id="page-title">{title}</h1>
          <div className="header-actions">
            <button
              className="icon-button music-button"
              type="button"
              aria-label={isMusicEnabled ? '關閉背景音樂' : '開啟背景音樂'}
              aria-pressed={isMusicEnabled}
              data-active={isMusicEnabled && hasMusicStarted}
              onClick={toggleBackgroundMusic}
            >
              {isMusicEnabled ? (
                <VolumeUp set="light" size="large" />
              ) : (
                <VolumeOff set="light" size="large" />
              )}
            </button>
            <button
              className="icon-button record-button"
              type="button"
              aria-expanded={isCharacterOpen}
              aria-haspopup="dialog"
              aria-label="開啟角色數值"
              onClick={openCharacterSheet}
            >
              <Document set="light" size="large" />
            </button>
          </div>
          <div className="title-rule" aria-hidden="true">
            <span />
          </div>
          <p className="scene-meta">7月15日　深夜 01:17　☁</p>
        </header>
        {children({ showItemReveal })}
        {isMenuOpen && (
          <div
            className="menu-overlay"
            role="dialog"
            aria-modal="true"
            aria-labelledby="menu-title"
          >
            <button
              className="character-backdrop"
              type="button"
              aria-label="關閉選單"
              onClick={() => setIsMenuOpen(false)}
            />
            <section className="menu-panel">
              <header className="menu-panel-header">
                <div>
                  <p className="menu-kicker">DEEP RECORDS</p>
                  <h2 id="menu-title">調查設定</h2>
                </div>
                <button
                  className="character-close"
                  type="button"
                  aria-label="關閉選單"
                  onClick={() => setIsMenuOpen(false)}
                >
                  ×
                </button>
              </header>

              <label className="menu-volume">
                <span>背景音樂音量</span>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={bgmVolume}
                  onChange={(event) => {
                    const value = Number(event.target.value)
                    setBgmVolume(value)
                    audioManager.setBgmVolume(value)
                  }}
                />
                <small>{Math.round(bgmVolume * 100)}%</small>
              </label>

              <footer className="menu-panel-footer">
                <p>版本 v{__APP_VERSION__}</p>
                <p className="menu-studio">code4soul</p>
              </footer>
            </section>
          </div>
        )}
        {itemReveal && (
          <button
            className="item-reveal-overlay"
            type="button"
            aria-label={`關閉${itemReveal.title}物品檢視`}
            onClick={closeItemReveal}
          >
            <span className="item-reveal-card">
              <span className="item-reveal-image-wrap" aria-hidden="true">
                <img src={itemReveal.imageUrl} alt="" />
              </span>
              <span className="item-reveal-copy">
                <span>{itemReveal.subtitle}</span>
                <strong>{itemReveal.title}</strong>
              </span>
              <small>點擊任意處收起</small>
            </span>
          </button>
        )}
        {isCharacterOpen && (
          <div
            className="character-overlay"
            data-closing={isCharacterClosing}
            role="dialog"
            aria-modal="true"
            aria-labelledby="character-title"
          >
            <button
              className="character-backdrop"
              type="button"
              aria-label="關閉角色數值"
              onClick={closeCharacterSheet}
            />
            <section className="character-panel">
              <nav className="record-tabs" aria-label="紀錄分類">
                {recordTabs.map((tab) => (
                  <button
                    key={tab.id}
                    className="record-tab"
                    data-active={activeRecordTab === tab.id}
                    type="button"
                    onClick={() => setActiveRecordTab(tab.id)}
                  >
                    {tab.label}
                  </button>
                ))}
              </nav>
              <div className="character-content">
                <header className="character-panel-header">
                  <div>
                    <p className="character-kicker">{playerRecord.fileId}</p>
                    <h2 id="character-title">{investigator.name}</h2>
                  </div>
                  <button
                    className="character-close"
                    type="button"
                    aria-label="關閉角色數值"
                    onClick={closeCharacterSheet}
                  >
                    ×
                  </button>
                </header>
                {activeRecordTab === 'character' && (
                  <>
                    <p className="character-note">
                      職業標籤：{investigator.occupationTitle}
                      。以下資料為目前調查紀錄中可確認的狀態。
                    </p>

                    <dl className="character-summary">
                      {dynamicSummary.map(([label, value]) => (
                        <div key={label}>
                          <dt>{label}</dt>
                          <dd>{value}</dd>
                        </div>
                      ))}
                    </dl>

                    <section className="character-section" aria-labelledby="attributes-title">
                      <h3 id="attributes-title">屬性</h3>
                      <dl className="stat-grid">
                        {investigator.attributes.map(([label, value]) => (
                          <div key={label}>
                            <dt>{label}</dt>
                            <dd>{value}</dd>
                          </div>
                        ))}
                      </dl>
                    </section>

                    <section className="character-section" aria-labelledby="skills-title">
                      <h3 id="skills-title">職業技能</h3>
                      <dl className="skill-list">
                        {investigator.skills.map(([label, value]) => (
                          <div key={label}>
                            <dt>{label}</dt>
                            <dd>{value}</dd>
                          </div>
                        ))}
                      </dl>
                    </section>
                  </>
                )}

                {activeRecordTab === 'clues' && (
                  <section className="character-section" aria-labelledby="clues-title">
                    <h3 id="clues-title">已記錄線索</h3>
                    {discoveredClues.length > 0 ? (
                      <div className="record-card-list">
                        {discoveredClues.map((clue) => (
                          <article className="record-card" key={clue.title}>
                            <h4>{clue.title}</h4>
                            <p>{clue.body}</p>
                          </article>
                        ))}
                      </div>
                    ) : (
                      <p className="record-empty">目前尚未留下可確認的線索。</p>
                    )}
                  </section>
                )}

                {activeRecordTab === 'items' && (
                  <section className="character-section" aria-labelledby="items-title">
                    <h3 id="items-title">攜帶物</h3>
                    <ul className="gear-list">
                      {inventoryItems.map((item) => (
                        <li key={item.id}>
                          {item.isInspectable ? (
                            <button type="button" onClick={() => showItemReveal(item.id)}>
                              {item.label}
                            </button>
                          ) : (
                            item.label
                          )}
                        </li>
                      ))}
                    </ul>
                  </section>
                )}

                {activeRecordTab === 'logs' && (
                  <section className="character-section" aria-labelledby="logs-title">
                    <h3 id="logs-title">調查紀錄</h3>
                    <ol className="record-log">
                      {investigationLogs.map((log) => (
                        <li key={log}>{log}</li>
                      ))}
                    </ol>
                  </section>
                )}
              </div>
            </section>
          </div>
        )}
      </div>
    </main>
  )
}
