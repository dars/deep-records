// 全站音訊管理：mood 驅動的 BGM、SFX 池、TTS ducking。
// 架構：兩個在使用者手勢中解鎖的「插槽」元素輪流承載曲目（iOS 的播放授權
// 是逐元素的，已解鎖元素換 src 仍保有授權）。所有曲目播到接近結尾時
// 交叉淡接到下一首——多曲目的 mood（tense）隨機輪播、單曲目 mood 平滑自環。
// 音量控制走 Web Audio GainNode 圖（iOS 上 HTMLMediaElement.volume 唯讀，
// element.volume 只作為無 AudioContext 時的桌面備援）：
//   slot source → slotGain(交叉淡接包絡) → bgmBus(使用者音量) → duckGain(TTS 壓低) → destination
//   sfx source → sfxGain(固定音量) → destination
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
const duckRampSeconds = 0.3
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

function getAudioContextClass(): typeof AudioContext | undefined {
  return (
    window.AudioContext ??
    (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  )
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
  private ctx: AudioContext | null = null
  private bgmBus: GainNode | null = null
  private duckGain: GainNode | null = null
  private slotGains: GainNode[] = []
  // 交叉淡接包絡（0..1）；graph 與 element.volume 備援共用同一份數值。
  private slotEnv: number[] = [0, 0]

  private targetVolume() {
    return this.ducked ? this.baseVolume * duckRatio : this.baseVolume
  }

  // 建立 Web Audio 圖。必須在手勢中首次呼叫（resume 需要手勢授權）。
  private ensureGraph() {
    if (this.ctx) {
      void this.ctx.resume().catch(() => {})
      return
    }

    const ContextClass = getAudioContextClass()

    if (!ContextClass) {
      return
    }

    try {
      this.ctx = new ContextClass()
    } catch {
      this.ctx = null
      return
    }

    this.duckGain = this.ctx.createGain()
    this.duckGain.gain.value = 1
    this.duckGain.connect(this.ctx.destination)
    this.bgmBus = this.ctx.createGain()
    this.bgmBus.gain.value = this.baseVolume
    this.bgmBus.connect(this.duckGain)
    void this.ctx.resume().catch(() => {})

    // iOS 會在背景暫停 AudioContext；回到前景時恢復。
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && this.enabled && this.ctx) {
        void this.ctx.resume().catch(() => {})
      }
    })
  }

  private connectBgmElement(element: HTMLAudioElement, slotIndex: number) {
    if (!this.ctx || !this.bgmBus) {
      return
    }

    try {
      const source = this.ctx.createMediaElementSource(element)
      const gain = this.ctx.createGain()
      gain.gain.value = this.slotEnv[slotIndex]
      source.connect(gain)
      gain.connect(this.bgmBus)
      this.slotGains[slotIndex] = gain
      element.volume = 1
    } catch {
      // createMediaElementSource 失敗時退回 element.volume 備援。
    }
  }

  private connectSfxElement(element: HTMLAudioElement) {
    if (!this.ctx) {
      return
    }

    try {
      const source = this.ctx.createMediaElementSource(element)
      const gain = this.ctx.createGain()
      gain.gain.value = sfxVolume
      source.connect(gain)
      gain.connect(this.ctx.destination)
      element.volume = 1
    } catch {
      // 備援：playSfx 會直接設定 element.volume。
    }
  }

  private applySlotEnv(index: number) {
    const gain = this.slotGains[index]

    if (gain) {
      gain.gain.value = this.slotEnv[index]
      return
    }

    const element = this.slots[index]

    if (element) {
      element.volume = Math.min(1, this.slotEnv[index] * this.targetVolume())
    }
  }

  private setSlotEnv(index: number, env: number) {
    this.slotEnv[index] = Math.min(1, Math.max(0, env))
    this.applySlotEnv(index)
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

    if (this.bgmBus) {
      this.bgmBus.gain.value = this.baseVolume
      return
    }

    if (this.fadeTimer === null) {
      this.applySlotEnv(this.activeIndex)
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

  // 無聲祝福：muted（＋無 graph 時 volume 0），play() 後同步 pause，避免 iOS 漏音。
  private blessSilently(element: HTMLAudioElement, url: string) {
    element.src = url
    element.muted = true

    if (!this.ctx) {
      element.volume = 0
    }

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

    const outgoingIndex = this.activeIndex
    const incomingIndex = 1 - this.activeIndex
    const incoming = this.slots[incomingIndex]

    incoming.src = url
    incoming.currentTime = 0
    incoming.muted = false
    this.setSlotEnv(incomingIndex, 0)
    void incoming.play().catch(() => {})
    this.activeIndex = incomingIndex
    this.currentUrl = url
    this.rotationArmed = true

    const steps = Math.max(1, Math.floor(crossfadeMs / fadeTickMs))
    const outgoingStart = this.slotEnv[outgoingIndex]
    let step = 0

    this.fadeTimer = window.setInterval(() => {
      step += 1
      const progress = Math.min(1, step / steps)
      this.setSlotEnv(incomingIndex, progress)
      this.setSlotEnv(outgoingIndex, outgoingStart * (1 - progress))

      if (progress >= 1) {
        this.slots[outgoingIndex]?.pause()
        this.stopFade()
      }
    }, fadeTickMs)
  }

  private fadeOutAll() {
    this.stopFade()

    const outgoingIndex = this.activeIndex
    const outgoing = this.slots[outgoingIndex]

    if (!outgoing || outgoing.paused) {
      return
    }

    this.rotationArmed = false
    const steps = Math.max(1, Math.floor(crossfadeMs / fadeTickMs))
    const outgoingStart = this.slotEnv[outgoingIndex]
    let step = 0

    this.fadeTimer = window.setInterval(() => {
      step += 1
      this.setSlotEnv(outgoingIndex, outgoingStart * (1 - step / steps))

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

    if (this.ctx) {
      void this.ctx.resume().catch(() => {})
    }

    if (this.unlocked && this.mood !== 'silent') {
      const active = this.slots[this.activeIndex]

      if (active?.src) {
        this.setSlotEnv(this.activeIndex, 1)
        void active.play().catch(() => {})
      } else {
        this.crossfadeTo(this.pickTrack(this.mood))
      }
    }
  }

  // 必須在使用者手勢事件中呼叫；建立音訊圖並祝福兩個 BGM 插槽與 SFX 元素。
  async unlock(): Promise<boolean> {
    if (!this.enabled) {
      return false
    }

    this.ensureGraph()

    for (const [name, path] of Object.entries(sfxTracks) as Array<
      [SfxName, string]
    >) {
      if (!this.sfxPool.has(name)) {
        const element = new Audio()
        element.preload = 'auto'
        this.sfxPool.set(name, element)
        this.connectSfxElement(element)
        this.blessSilently(element, path)
      }
    }

    if (this.slots.length === 0) {
      this.slots = [this.createSlot(), this.createSlot()]
      this.connectBgmElement(this.slots[0], 0)
      this.connectBgmElement(this.slots[1], 1)
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
      this.setSlotEnv(this.activeIndex, 1)
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

  // TTS 朗讀時壓低 BGM；結束後回復。graph 模式走 duckGain 匯流排，
  // 與交叉淡接互不干擾；備援模式沿用 element.volume 漸變。
  duck(on: boolean) {
    if (this.ducked === on) {
      return
    }

    this.ducked = on

    if (this.ctx && this.duckGain) {
      const gain = this.duckGain.gain
      const now = this.ctx.currentTime
      const target = on ? duckRatio : 1
      gain.cancelScheduledValues(now)
      gain.setValueAtTime(gain.value, now)
      gain.linearRampToValueAtTime(target, now + duckRampSeconds)
      return
    }

    const element = this.slots[this.activeIndex]

    if (!element || this.fadeTimer !== null) {
      return
    }

    const target = Math.min(1, this.slotEnv[this.activeIndex] * this.targetVolume())
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

    if (this.ctx) {
      void this.ctx.resume().catch(() => {})
    }

    const pooled = this.sfxPool.get(name)
    const element = pooled ?? new Audio(sfxTracks[name])

    element.currentTime = 0

    // graph 模式下 SFX 音量由 sfxGain 固定；備援模式直接設 element.volume。
    if (!this.ctx || !pooled) {
      element.volume = sfxVolume
    }

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
