import { InvestigationScene } from '../features/investigation/InvestigationScene'
import { InvestigationStateProvider } from '../features/investigation/InvestigationStateContext'
import { MobileGameLayout } from '../layouts/MobileGameLayout'
import type { InvestigatorProfile } from '../types/investigation'

type GameReadingPageProps = {
  investigator: InvestigatorProfile
  onRestart: () => void
}

export function GameReadingPage({ investigator, onRestart }: GameReadingPageProps) {
  return (
    <InvestigationStateProvider investigator={investigator}>
      <MobileGameLayout title="調查紀錄 #001">
        {({ showItemReveal }) => (
          <InvestigationScene onItemReveal={showItemReveal} onRestart={onRestart} />
        )}
      </MobileGameLayout>
    </InvestigationStateProvider>
  )
}
