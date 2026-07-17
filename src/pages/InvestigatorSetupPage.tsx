import type { FormEvent } from 'react'
import { useMemo, useState } from 'react'
import {
  createInvestigatorProfile,
  defaultOccupationOption,
  occupationOptions,
} from '../data/occupations'
import type { InvestigatorProfile } from '../types/investigation'

type InvestigatorSetupPageProps = {
  onCreateInvestigator: (investigator: InvestigatorProfile) => void
}

export function InvestigatorSetupPage({
  onCreateInvestigator,
}: InvestigatorSetupPageProps) {
  const [name, setName] = useState('')
  const [occupationId, setOccupationId] = useState(defaultOccupationOption?.id ?? '')
  const selectedOccupation = useMemo(
    () =>
      occupationOptions.find((occupation) => occupation.id === occupationId) ??
      defaultOccupationOption,
    [occupationId],
  )
  const previewInvestigator = selectedOccupation
    ? createInvestigatorProfile(name || '未命名調查者', selectedOccupation)
    : null
  const canStart = name.trim().length > 0 && Boolean(selectedOccupation)

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (!canStart || !selectedOccupation) {
      return
    }

    onCreateInvestigator(createInvestigatorProfile(name, selectedOccupation))
  }

  return (
    <main className="app-shell setup-shell" aria-labelledby="setup-title">
      <section className="setup-card">
        <p className="setup-kicker">INVESTIGATOR FILE / 001</p>
        <h1 id="setup-title">建立調查者</h1>
        <p className="setup-copy">
          雨夜的紀錄還沒有名字。先留下調查者的身分，再打開那則朋友傳來的訊息。
        </p>

        <form className="setup-form" onSubmit={handleSubmit}>
          <label>
            <span>姓名</span>
            <input
              autoComplete="name"
              autoFocus
              maxLength={24}
              name="investigatorName"
              onChange={(event) => setName(event.target.value)}
              placeholder="輸入調查者姓名"
              type="text"
              value={name}
            />
          </label>

          <label>
            <span>職業</span>
            <select
              name="occupation"
              onChange={(event) => setOccupationId(event.target.value)}
              value={occupationId}
            >
              {occupationOptions.map((occupation) => (
                <option key={occupation.id} value={occupation.id}>
                  {occupation.title}
                </option>
              ))}
            </select>
          </label>

          {previewInvestigator && (
            <dl className="setup-occupation-preview">
              <div>
                <dt>初始理智</dt>
                <dd>
                  {
                    previewInvestigator.attributes.find(([label]) => label === '意志')
                      ?.[1]
                  }
                </dd>
              </div>
              <div className="setup-carry-items">
                <dt>隨身物品</dt>
                <dd>
                  <ul>
                    {previewInvestigator.initialInventory.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </dd>
              </div>
            </dl>
          )}

          <button disabled={!canStart} type="submit">
            建立紀錄
          </button>
        </form>
      </section>
    </main>
  )
}
