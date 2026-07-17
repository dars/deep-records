import { GameReadingPage } from './pages/GameReadingPage'
import { InvestigatorSetupPage } from './pages/InvestigatorSetupPage'
import type { CSSProperties } from 'react'
import { useMemo, useState } from 'react'
import {
  clearSavedGame,
  loadSavedGame,
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
}

export function App() {
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

  const handleCreateInvestigator = (investigator: InvestigatorProfile) => {
    // 建立新調查者代表放棄舊存檔。
    clearSavedGame()
    setSavedGame(null)
    setSession({ investigator, resume: null })
  }

  const handleContinueSavedGame = () => {
    if (savedGame) {
      setSession({ investigator: savedGame.investigator, resume: savedGame })
    }
  }

  const handleRestart = () => {
    clearSavedGame()
    setSavedGame(null)
    setSession(null)
  }

  return (
    <div className="site-background" style={backgroundStyle}>
      {session ? (
        <GameReadingPage
          investigator={session.investigator}
          onRestart={handleRestart}
          resume={session.resume}
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
