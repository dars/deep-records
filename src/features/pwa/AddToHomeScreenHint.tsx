import { useEffect, useState } from 'react'

// 加入主畫面提示：Android/Chrome 走 beforeinstallprompt 原生安裝，
// iOS Safari 沒有安裝 API，改顯示分享選單教學。
// 已安裝（standalone）或使用者關閉過就不再出現。

const dismissKey = 'deep-records/a2hs-dismissed'

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as { standalone?: boolean }).standalone === true
  )
}

function isIos(): boolean {
  const ua = window.navigator.userAgent
  return /iphone|ipad|ipod/i.test(ua) || (/macintosh/i.test(ua) && 'ontouchend' in document)
}

export function AddToHomeScreenHint() {
  const [dismissed, setDismissed] = useState(() => {
    try {
      return window.localStorage.getItem(dismissKey) === '1'
    } catch {
      return false
    }
  })
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(
    null,
  )
  const [installed, setInstalled] = useState(() => isStandalone())

  useEffect(() => {
    const onPrompt = (event: Event) => {
      event.preventDefault()
      setInstallEvent(event as BeforeInstallPromptEvent)
    }
    const onInstalled = () => setInstalled(true)

    window.addEventListener('beforeinstallprompt', onPrompt)
    window.addEventListener('appinstalled', onInstalled)

    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])

  if (dismissed || installed) {
    return null
  }

  const showIosHint = isIos()

  // Android 尚未收到安裝事件、又不是 iOS：瀏覽器不支援或已安裝過，不打擾。
  if (!showIosHint && !installEvent) {
    return null
  }

  const dismiss = () => {
    setDismissed(true)

    try {
      window.localStorage.setItem(dismissKey, '1')
    } catch {
      // 靜默略過
    }
  }

  const install = async () => {
    if (!installEvent) {
      return
    }

    await installEvent.prompt()
    const choice = await installEvent.userChoice

    if (choice.outcome === 'accepted') {
      setInstalled(true)
    }

    setInstallEvent(null)
  }

  return (
    <div className="a2hs-hint" role="note">
      <div className="a2hs-text">
        <p className="a2hs-title">將紀錄收進口袋</p>
        {showIosHint ? (
          <p>
            以 Safari 的分享選單
            <span aria-hidden="true" className="a2hs-glyph">
              {' '}
              ⎋{' '}
            </span>
            選擇「加入主畫面」，即可全螢幕開啟這份調查紀錄。
          </p>
        ) : (
          <p>加入主畫面後可全螢幕開啟這份調查紀錄。</p>
        )}
      </div>
      <div className="a2hs-actions">
        {!showIosHint && installEvent ? (
          <button className="a2hs-install" type="button" onClick={install}>
            加入主畫面
          </button>
        ) : null}
        <button
          aria-label="關閉提示"
          className="a2hs-dismiss"
          type="button"
          onClick={dismiss}
        >
          ×
        </button>
      </div>
    </div>
  )
}
