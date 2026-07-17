import { GameReadingPage } from './pages/GameReadingPage'
import { InvestigatorSetupPage } from './pages/InvestigatorSetupPage'
import type { CSSProperties } from 'react'
import { useMemo, useState } from 'react'
import type { InvestigatorProfile } from './types/investigation'

const backgroundImages = [
  '/assets/images/bg01.png',
  '/assets/images/bg02.png',
] as const

export function App() {
  const [investigator, setInvestigator] = useState<InvestigatorProfile | null>(null)
  const backgroundImage = useMemo(
    () => backgroundImages[Math.floor(Math.random() * backgroundImages.length)],
    [],
  )
  const backgroundStyle = {
    '--site-background-image': `url(${backgroundImage})`,
    '--main-background-image': 'url(/assets/images/main-bg.png)',
  } as CSSProperties

  return (
    <div className="site-background" style={backgroundStyle}>
      {investigator ? (
        <GameReadingPage
          investigator={investigator}
          onRestart={() => setInvestigator(null)}
        />
      ) : (
        <InvestigatorSetupPage onCreateInvestigator={setInvestigator} />
      )}
    </div>
  )
}

export default App
