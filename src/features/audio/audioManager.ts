// 全站音訊管理：mood 驅動的 BGM、SFX 池、TTS ducking。
// 架構：兩個在使用者手勢中解鎖的「插槽」元素輪流承載曲目（iOS 的播放授權
// 是逐元素的，已解鎖元素換 src 仍保有授權）。所有曲目播到接近結尾時
// 交叉淡接到下一首——多曲目的 mood（tense）隨機輪播、單曲目 mood 平滑自環。
import { sceneMoods } from '../../generated/scene-moods'

export type BgmMood = 'rainy' | 'tense' | 'dread' | 'ritual' | 'silent'

// mood → 曲目清單；多首時隨機輪播（不連續重複同一首）。
const moodTracks: Record<Exclude<BgmMood, 'silent'>, string[]> = {
  dread: ['/assets/music/bgm-dread.mp3'],
  rainy: ['/assets/music/bgm-rainy.mp3'],
  ritual: ['/assets/music/bgm-ritual.mp3'],
  tense: [
    '/assets/music/bgm-tense-1.mp3',
    '/assets/music/bgm-tense-2.mp3',
    '/assets/music/bgm-tense-3.mp3',
    '/assets/music/bgm-tense-4.mp3',
  ],
}

const fallbackTrack = '/assets/music/ambient-drone-quiet-unease-continuous.mp3'

const sfxTracks = {
  dice: '/assets/sfx/dice-roll.mp3',
  knock: '/assets/sfx/knock.mp3',
} as const

export type SfxName = keyof typeof sfxTracks

const defaultBgmVolume = 0.55
const duckRatio = 0.22
const sfxVolume = 0.85
const crossfadeMs = 2600
const fadeTickMs = 50
const volumeStorageKey = 'deep-records/bgm-volume'

function loadStoredVolume(): number {
  try {
    const raw = window.localStorage.getItem(volumeStorageKey)
    const value = raw === null ? NaN : Number(raw)

    return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : defaultBgmVolume
  } catch {
    return defaultBgmVolume
  }
}

class AudioManager {
  private enabled = true
  private unlocked = false
  private mood: BgmMood = 'rainy'
  private slots: HTMLAudioElement[] = []
  private activeIndex = 0
  private currentUrl = ''
  private rotationArmed = false
  private fadeTimer: number | null = null
  private ducked = false
  private sfxPool = new Map<SfxName, HTMLAudioElement>()
  private baseVolume = loadStoredVolume()

  private targetVolume() {
    return this.ducked ? this.baseVolume * duckRatio : this.baseVolume
  }

  getBgmVolume(): number {
    return this.baseVolume
  }

  setBgmVolume(volume: number) {
    this.baseVolume = Math.min(1, Math.max(0, volume))

    try {
      window.localStorage.setItem(volumeStorageKey, String(this.baseVolume))
    } catch {
      // 靜默略過
    }

    const active = this.slots[this.activeIndex]

    if (active && this.fadeTimer === null) {
      active.volume = this.targetVolume()
    }
  }

  private createSlot(): HTMLAudioElement {
    const element = new Audio()
    element.preload = 'auto'
    // 曲目載入失敗時退回既有的 drone。
    element.addEventListener('error', () => {
      if (element.src && !element.src.endsWith(fallbackTrack)) {
        element.src = fallbackTrack
        void element.play().catch(() => {})
      }
    })
    // 接近結尾時交叉淡接到下一首（同 mood 內輪播／自環）。
    element.addEventListener('timeupdate', () => {
      if (
        element !== this.slots[this.activeIndex] ||
        !this.rotationArmed ||
        !Number.isFinite(element.duration) ||
        element.duration <= 0
      ) {
        return
      }

      const remaining = element.duration - element.currentTime

      if (remaining <= crossfadeMs / 1000 + 0.2) {
        this.rotationArmed = false
        this.advanceWithinMood()
      }
    })
    // 背景分頁 timeupdate 可能被節流：ended 作為保底。
    element.addEventListener('ended', () => {
      if (element === this.slots[this.activeIndex] && this.mood !== 'silent') {
        this.advanceWithinMood()
      }
    })

    return element
  }

  // 無聲祝福：volume 0 + muted，play() 後同步 pause，避免 iOS 漏音。
  private blessSilently(element: HTMLAudioElement, url: string) {
    element.src = url
    element.volume = 0
    element.muted = true
    const playAttempt = element.play()
    element.pause()
    void playAttempt
      .catch(() => {})
      .finally(() => {
        element.currentTime = 0
        element.muted = false
      })
  }

  private pickTrack(mood: Exclude<BgmMood, 'silent'>, excludeUrl?: string): string {
    const tracks = moodTracks[mood]

    if (tracks.length === 1) {
      return tracks[0]
    }

    const candidates = tracks.filter((track) => track !== excludeUrl)
    const pool = candidates.length > 0 ? candidates : tracks

    return pool[Math.floor(Math.random() * pool.length)]
  }

  private advanceWithinMood() {
    if (this.mood === 'silent' || !this.enabled || !this.unlocked) {
      return
    }

    this.crossfadeTo(this.pickTrack(this.mood, this.currentUrl))
  }

  private stopFade() {
    if (this.fadeTimer !== null) {
      window.clearInterval(this.fadeTimer)
      this.fadeTimer = null
    }
  }

  private crossfadeTo(url: string) {
    if (this.slots.length < 2) {
      return
    }

    this.stopFade()

    const outgoing = this.slots[this.activeIndex]
    const incomingIndex = 1 - this.activeIndex
    const incoming = this.slots[incomingIndex]

    incoming.src = url
    incoming.currentTime = 0
    incoming.volume = 0
    incoming.muted = false
    void incoming.play().catch(() => {})
    this.activeIndex = incomingIndex
    this.currentUrl = url
    this.rotationArmed = true

    const steps = Math.max(1, Math.floor(crossfadeMs / fadeTickMs))
    const outgoingStart = outgoing.volume
    let step = 0

    this.fadeTimer = window.setInterval(() => {
      step += 1
      const progress = Math.min(1, step / steps)
      incoming.volume = this.targetVolume() * progress
      outgoing.volume = Math.max(0, outgoingStart * (1 - progress))

      if (progress >= 1) {
        outgoing.pause()
        this.stopFade()
      }
    }, fadeTickMs)
  }

  private fadeOutAll() {
    this.stopFade()

    const outgoing = this.slots[this.activeIndex]

    if (!outgoing || outgoing.paused) {
      return
    }

    this.rotationArmed = false
    const steps = Math.max(1, Math.floor(crossfadeMs / fadeTickMs))
    const outgoingStart = outgoing.volume
    let step = 0

    this.fadeTimer = window.setInterval(() => {
      step += 1
      outgoing.volume = Math.max(0, outgoingStart * (1 - step / steps))

      if (step >= steps) {
        outgoing.pause()
        this.stopFade()
      }
    }, fadeTickMs)
  }

  setEnabled(enabled: boolean) {
    this.enabled = enabled

    if (!enabled) {
      this.stopFade()

      for (const slot of this.slots) {
        slot.pause()
      }

      return
    }

    if (this.unlocked && this.mood !== 'silent') {
      const active = this.slots[this.activeIndex]

      if (active?.src) {
        active.volume = this.targetVolume()
        void active.play().catch(() => {})
      } else {
        this.crossfadeTo(this.pickTrack(this.mood))
      }
    }
  }

  // 必須在使用者手勢事件中呼叫；祝福兩個 BGM 插槽與 SFX 元素。
  async unlock(): Promise<boolean> {
    if (!this.enabled) {
      return false
    }

    for (const [name, path] of Object.entries(sfxTracks) as Array<
      [SfxName, string]
    >) {
      if (!this.sfxPool.has(name)) {
        const element = new Audio()
        element.preload = 'auto'
        this.sfxPool.set(name, element)
        this.blessSilently(element, path)
      }
    }

    if (this.slots.length === 0) {
      this.slots = [this.createSlot(), this.createSlot()]
      // 備用插槽先以 fallback 曲目祝福，取得播放授權。
      this.blessSilently(this.slots[1], fallbackTrack)
    }

    if (this.mood === 'silent') {
      this.unlocked = true
      return true
    }

    const active = this.slots[this.activeIndex]

    if (!active.src) {
      this.currentUrl = this.pickTrack(this.mood)
      active.src = this.currentUrl
      active.volume = this.targetVolume()
    }

    try {
      await active.play()
      this.unlocked = true
      this.rotationArmed = true
      return true
    } catch {
      return false
    }
  }

  setMood(mood: BgmMood) {
    if (mood === this.mood) {
      return
    }

    this.mood = mood

    if (!this.unlocked || !this.enabled) {
      return
    }

    if (mood === 'silent') {
      this.fadeOutAll()
      return
    }

    this.crossfadeTo(this.pickTrack(mood))
  }

  // TTS 朗讀時壓低 BGM；結束後回復。
  duck(on: boolean) {
    if (this.ducked === on) {
      return
    }

    this.ducked = on

    const element = this.slots[this.activeIndex]

    if (!element || this.fadeTimer !== null) {
      return
    }

    const target = this.targetVolume()
    const start = element.volume
    const steps = 8
    let step = 0
    const timer = window.setInterval(() => {
      step += 1
      element.volume = start + (target - start) * (step / steps)

      if (step >= steps) {
        window.clearInterval(timer)
      }
    }, 40)
  }

  playSfx(name: SfxName) {
    if (!this.enabled) {
      return
    }

    const pooled = this.sfxPool.get(name)
    const element = pooled ?? new Audio(sfxTracks[name])

    element.currentTime = 0
    element.volume = sfxVolume
    void element.play().catch(() => {})
  }
}

export const audioManager = new AudioManager()

// 由遊戲狀態推導 BGM mood：旗標覆寫優先於場景 frontmatter。
export function resolveBgmMood(state: {
  currentSceneId: string
  ending?: unknown
  flags: Record<string, boolean>
}): BgmMood {
  if (state.ending) {
    return 'silent'
  }

  if (
    state.currentSceneId === '007_landlord_apartment' ||
    state.flags.ritual_forced_climax === true
  ) {
    return 'ritual'
  }

  if (state.flags.officer_a_yang_arrived === true) {
    return 'dread'
  }

  const mood = sceneMoods[state.currentSceneId]

  return mood === 'rainy' || mood === 'tense' || mood === 'dread' || mood === 'ritual'
    ? mood
    : 'tense'
}
