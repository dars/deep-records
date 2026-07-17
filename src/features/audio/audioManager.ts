// 全站音訊管理：mood 驅動的雙軌 BGM crossfade、SFX 池、TTS ducking。
// iOS 需要在使用者手勢內解鎖播放，unlock() 由 UI 層在手勢事件中呼叫。
import { sceneMoods } from '../../generated/scene-moods'

export type BgmMood = 'rainy' | 'tense' | 'dread' | 'ritual' | 'silent'

// mood → 曲目。缺檔時自動退回 tense（現有 drone），
// 之後補上對應檔名的音檔即可自動生效，不用改程式。
const moodTracks: Record<Exclude<BgmMood, 'silent'>, string> = {
  dread: '/assets/music/bgm-dread.mp3',
  rainy: '/assets/music/bgm-rainy.mp3',
  ritual: '/assets/music/bgm-ritual.mp3',
  tense: '/assets/music/ambient-drone-quiet-unease-continuous.mp3',
}

const fallbackTrack = moodTracks.tense

const sfxTracks = {
  dice: '/assets/sfx/dice-roll.mp3',
  knock: '/assets/sfx/knock.mp3',
} as const

export type SfxName = keyof typeof sfxTracks

const bgmVolume = 0.55
const duckedVolume = 0.12
const sfxVolume = 0.85
const crossfadeMs = 2600
const fadeTickMs = 50

class AudioManager {
  private enabled = true
  private unlocked = false
  private mood: BgmMood = 'rainy'
  private active: HTMLAudioElement | null = null
  private fading: HTMLAudioElement | null = null
  private fadeTimer: number | null = null
  private ducked = false
  private sfxPool = new Map<SfxName, HTMLAudioElement>()

  private targetVolume() {
    return this.ducked ? duckedVolume : bgmVolume
  }

  private createTrack(mood: Exclude<BgmMood, 'silent'>): HTMLAudioElement {
    const element = new Audio(moodTracks[mood])
    element.loop = true
    element.preload = 'auto'
    // 缺檔時退回既有的 tense 曲目，讓 mood 機制先於素材存在。
    element.addEventListener('error', () => {
      if (!element.src.endsWith(fallbackTrack)) {
        element.src = fallbackTrack
        void element.play().catch(() => {})
      }
    })

    return element
  }

  private stopFade() {
    if (this.fadeTimer !== null) {
      window.clearInterval(this.fadeTimer)
      this.fadeTimer = null
    }

    if (this.fading) {
      this.fading.pause()
      this.fading = null
    }
  }

  private crossfadeTo(mood: Exclude<BgmMood, 'silent'>) {
    this.stopFade()

    const outgoing = this.active
    const incoming = this.createTrack(mood)
    incoming.volume = 0
    void incoming.play().catch(() => {})
    this.active = incoming
    this.fading = outgoing

    const steps = Math.max(1, Math.floor(crossfadeMs / fadeTickMs))
    let step = 0

    this.fadeTimer = window.setInterval(() => {
      step += 1
      const progress = Math.min(1, step / steps)
      incoming.volume = this.targetVolume() * progress

      if (outgoing) {
        outgoing.volume = Math.max(0, outgoing.volume * (1 - progress))
      }

      if (progress >= 1) {
        this.stopFade()
      }
    }, fadeTickMs)
  }

  private fadeOutAll() {
    this.stopFade()

    const outgoing = this.active

    if (!outgoing) {
      return
    }

    this.active = null
    const steps = Math.max(1, Math.floor(crossfadeMs / fadeTickMs))
    let step = 0

    this.fadeTimer = window.setInterval(() => {
      step += 1
      outgoing.volume = Math.max(0, this.targetVolume() * (1 - step / steps))

      if (step >= steps) {
        outgoing.pause()

        if (this.fadeTimer !== null) {
          window.clearInterval(this.fadeTimer)
          this.fadeTimer = null
        }
      }
    }, fadeTickMs)
  }

  setEnabled(enabled: boolean) {
    this.enabled = enabled

    if (!enabled) {
      this.stopFade()
      this.active?.pause()
      return
    }

    if (this.unlocked && this.mood !== 'silent') {
      if (this.active) {
        void this.active.play().catch(() => {})
      } else {
        this.crossfadeTo(this.mood)
      }
    }
  }

  // 必須在使用者手勢事件中呼叫；同時「祝福」SFX 元素供非手勢時機播放（iOS）。
  async unlock(): Promise<boolean> {
    if (!this.enabled) {
      return false
    }

    for (const [name, path] of Object.entries(sfxTracks) as Array<
      [SfxName, string]
    >) {
      if (!this.sfxPool.has(name)) {
        const element = new Audio(path)
        element.preload = 'auto'
        element.muted = true
        void element
          .play()
          .then(() => {
            element.pause()
            element.currentTime = 0
            element.muted = false
          })
          .catch(() => {
            element.muted = false
          })
        this.sfxPool.set(name, element)
      }
    }

    if (this.mood === 'silent') {
      this.unlocked = true
      return true
    }

    if (!this.active) {
      this.active = this.createTrack(this.mood as Exclude<BgmMood, 'silent'>)
      this.active.volume = this.targetVolume()
    }

    try {
      await this.active.play()
      this.unlocked = true
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

    this.crossfadeTo(mood)
  }

  // TTS 朗讀時壓低 BGM；結束後回復。
  duck(on: boolean) {
    if (this.ducked === on) {
      return
    }

    this.ducked = on

    const element = this.active

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
