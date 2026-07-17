import { GameReadingPage } from './pages/GameReadingPage'
import { InvestigatorSetupPage } from './pages/InvestigatorSetupPage'
import { LandingPage } from './pages/LandingPage'
import type { CSSProperties } from 'react'
import { useMemo, useState } from 'react'
import {
  clearSavedGame,
  loadSavedGame,
  savePlayerProfile,
  type SavedGame,
} from './features/investigation/saveGame'
import type { InvestigatorProfile } from './types/investigation'

const backgroundImages = [
  '/assets/images/bg01.png',
  '/assets/images/bg02.png',
] as const

type GameSession = {
  investigator: InvestigatorProfile
  resume: SavedGame | null
  skipPrologue: boolean
}

export function App() {
  const [hasAcceptedWarning, setHasAcceptedWarning] = useState(false)
  const [savedGame, setSavedGame] = useState<SavedGame | null>(loadSavedGame)
  const [session, setSession] = useState<GameSession | null>(null)
  const backgroundImage = useMemo(
    () => backgroundImages[Math.floor(Math.random() * backgroundImages.length)],
    [],
  )
  const backgroundStyle = {
    '--site-background-image': `url(${backgroundImage})`,
    '--main-background-image': 'url(/assets/images/main-bg.png)',
  } as CSSProperties

  const handleCreateInvestigator = (
    investigator: InvestigatorProfile,
    skipPrologue: boolean,
  ) => {
    // 建立新調查者代表放棄舊存檔；並記住這一輪的身分供重玩帶入。
    clearSavedGame()
    setSavedGame(null)
    savePlayerProfile({
      name: investigator.name,
      occupationId: investigator.occupationId,
    })
    setSession({ investigator, resume: null, skipPrologue })
  }

  const handleContinueSavedGame = () => {
    if (savedGame) {
      setSession({
        investigator: savedGame.investigator,
        resume: savedGame,
        skipPrologue: false,
      })
    }
  }

  const handleRestart = () => {
    clearSavedGame()
    setSavedGame(null)
    setSession(null)
  }

  return (
    <div className="site-background" style={backgroundStyle}>
      {!hasAcceptedWarning ? (
        <LandingPage onEnter={() => setHasAcceptedWarning(true)} />
      ) : session ? (
        <GameReadingPage
          investigator={session.investigator}
          onRestart={handleRestart}
          resume={session.resume}
          skipPrologue={session.skipPrologue}
        />
      ) : (
        <InvestigatorSetupPage
          onContinueSavedGame={savedGame ? handleContinueSavedGame : undefined}
          onCreateInvestigator={handleCreateInvestigator}
          savedGame={savedGame}
        />
      )}
    </div>
  )
}

export default App
