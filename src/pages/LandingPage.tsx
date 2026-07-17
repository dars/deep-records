type LandingPageProps = {
  onEnter: () => void
}

export function LandingPage({ onEnter }: LandingPageProps) {
  return (
    <main className="app-shell setup-shell" aria-labelledby="landing-title">
      <section className="setup-card landing-card">
        <p className="setup-kicker">CASE FILE / RESTRICTED</p>
        <h1 id="landing-title">Deep Records</h1>
        <p className="landing-subtitle">單人克蘇魯式調查紀錄</p>

        <div className="landing-warning" role="note">
          <p className="landing-warning-title">內容警告</p>
          <p>
            本作品包含恐怖、暴力、獻祭儀式、精神壓力與心理驚悚描寫，
            部分情節可能引起不適，建議由成年玩家遊玩。
          </p>
          <p>
            故事中的人物、地點、信仰與事件皆屬虛構。
            調查過程沒有標準答案——你的選擇、懷疑與相信，都會成為紀錄的一部分。
          </p>
        </div>

        <button className="landing-enter-button" type="button" onClick={onEnter}>
          我已了解，翻開紀錄
        </button>
      </section>
    </main>
  )
}
