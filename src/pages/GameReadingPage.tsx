import { InvestigationScene } from '../features/investigation/InvestigationScene'
import { InvestigationStateProvider } from '../features/investigation/InvestigationStateContext'
import type { SavedGame } from '../features/investigation/saveGame'
import { MobileGameLayout } from '../layouts/MobileGameLayout'
import type { InvestigatorProfile } from '../types/investigation'

type GameReadingPageProps = {
  investigator: InvestigatorProfile
  onRestart: () => void
  resume?: SavedGame | null
}

export function GameReadingPage({
  investigator,
  onRestart,
  resume,
}: GameReadingPageProps) {
  return (
    <InvestigationStateProvider
      initialState={resume?.investigationState}
      investigator={investigator}
    >
      <MobileGameLayout title="調查紀錄 #001">
        {({ showItemReveal }) => (
          <InvestigationScene
            onItemReveal={showItemReveal}
            onRestart={onRestart}
            resume={resume}
          />
        )}
      </MobileGameLayout>
    </InvestigationStateProvider>
  )
}
