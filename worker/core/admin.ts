// 遊玩統計儀表板：/admin 頁面 + /api/admin/* 資料端點。
// 以 ADMIN_KEY secret 保護資料端點；頁面本身是無資料的殼。
type AdminEnv = {
  ADMIN_KEY?: string
  ANALYTICS_DB?: D1Database
}

function isAuthorized(request: Request, env: AdminEnv): boolean {
  if (!env.ADMIN_KEY) {
    return false
  }

  const url = new URL(request.url)
  const key =
    request.headers.get('x-admin-key') ?? url.searchParams.get('key') ?? ''

  return key === env.ADMIN_KEY
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    status,
  })
}

export async function handleAdminStats(
  request: Request,
  env: AdminEnv,
): Promise<Response> {
  if (!isAuthorized(request, env)) {
    return json({ error: 'unauthorized' }, 401)
  }

  if (!env.ANALYTICS_DB) {
    return json({ error: 'analytics_unavailable' }, 503)
  }

  const db = env.ANALYTICS_DB
  const [totals, funnel, endings, kinds, sources, recent] = await db.batch([
    db.prepare(
      `SELECT COUNT(DISTINCT session_id) AS sessions,
              COUNT(*) AS turns,
              COUNT(DISTINCT CASE WHEN ending_id IS NOT NULL THEN session_id END) AS completed
         FROM turn_events`,
    ),
    db.prepare(
      `SELECT scene_id, COUNT(DISTINCT session_id) AS n
         FROM turn_events GROUP BY scene_id`,
    ),
    db.prepare(
      `SELECT ending_id, COUNT(*) AS n
         FROM turn_events WHERE ending_id IS NOT NULL GROUP BY ending_id ORDER BY n DESC`,
    ),
    db.prepare(
      `SELECT action_kind, COUNT(*) AS n
         FROM turn_events GROUP BY action_kind ORDER BY n DESC`,
    ),
    db.prepare(
      `SELECT turn_source, COUNT(*) AS n, CAST(AVG(latency_ms) AS INTEGER) AS avg_latency
         FROM turn_events GROUP BY turn_source ORDER BY n DESC`,
    ),
    db.prepare(
      `SELECT session_id,
              MIN(ts) AS started_ts,
              MAX(ts) AS last_ts,
              COUNT(*) AS turns,
              MAX(occupation) AS occupation,
              MAX(ending_id) AS ending_id
         FROM turn_events GROUP BY session_id ORDER BY MAX(ts) DESC LIMIT 30`,
    ),
  ])

  return json({
    endings: endings.results,
    funnel: funnel.results,
    kinds: kinds.results,
    recent: recent.results,
    sources: sources.results,
    totals: totals.results[0] ?? { completed: 0, sessions: 0, turns: 0 },
  })
}

export async function handleAdminSession(
  request: Request,
  env: AdminEnv,
): Promise<Response> {
  if (!isAuthorized(request, env)) {
    return json({ error: 'unauthorized' }, 401)
  }

  if (!env.ANALYTICS_DB) {
    return json({ error: 'analytics_unavailable' }, 503)
  }

  const sessionId = new URL(request.url).searchParams.get('id') ?? ''

  if (!/^[a-zA-Z0-9-]{8,64}$/.test(sessionId)) {
    return json({ error: 'invalid_session_id' }, 400)
  }

  const { results } = await env.ANALYTICS_DB.prepare(
    `SELECT turn_index, ts, scene_id, action_kind, player_action,
            selected_action_id, turn_source, belief_stage, sanity,
            ending_id, latency_ms
       FROM turn_events WHERE session_id = ? ORDER BY turn_index, ts`,
  )
    .bind(sessionId)
    .all()

  return json({ sessionId, turns: results })
}

export function handleAdminPage(): Response {
  return new Response(adminPageHtml, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  })
}

const adminPageHtml = `<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Deep Records — 遊玩統計</title>
<style>
:root {
  --surface: #0a1613;
  --card: #0e1d19;
  --line: rgba(148, 190, 170, 0.14);
  --ink: rgba(220, 226, 212, 0.92);
  --ink-2: rgba(163, 184, 170, 0.72);
  --ink-3: rgba(130, 148, 136, 0.5);
  --accent: #55b28f;
  --accent-soft: rgba(85, 178, 143, 0.24);
  --warn: #d0925a;
}
* { box-sizing: border-box; margin: 0; }
body {
  background: var(--surface);
  color: var(--ink);
  font: 14px/1.6 ui-sans-serif, system-ui, "Noto Sans TC", sans-serif;
  padding: 24px;
  max-width: 980px;
  margin: 0 auto;
}
h1 { font-size: 18px; letter-spacing: 0.12em; font-weight: 600; }
h1 small { color: var(--ink-3); font-weight: 400; letter-spacing: 0.04em; }
h2 { font-size: 12px; letter-spacing: 0.18em; color: var(--ink-2); font-weight: 600; margin: 0 0 12px; }
.grid { display: grid; gap: 16px; margin-top: 20px; }
.tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 12px; }
.card { background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 16px 18px; }
.tile .num { font-size: 28px; font-weight: 650; letter-spacing: 0.02em; }
.tile .lbl { color: var(--ink-3); font-size: 11px; letter-spacing: 0.14em; margin-top: 2px; }
.bars { display: grid; gap: 8px; }
.bar-row { display: grid; grid-template-columns: 150px 1fr 48px; gap: 10px; align-items: center; }
.bar-row .lbl { color: var(--ink-2); font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.bar-track { height: 14px; border-radius: 4px; background: rgba(255,255,255,0.03); overflow: hidden; }
.bar-fill { display: block; height: 100%; border-radius: 0 4px 4px 0; background: linear-gradient(90deg, var(--accent-soft), var(--accent)); min-width: 2px; }
.bar-row .val { text-align: right; font-variant-numeric: tabular-nums; color: var(--ink); font-size: 12px; }
table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
th { text-align: left; color: var(--ink-3); font-weight: 500; letter-spacing: 0.08em; padding: 6px 8px; border-bottom: 1px solid var(--line); }
td { padding: 7px 8px; border-bottom: 1px solid rgba(148,190,170,0.06); font-variant-numeric: tabular-nums; }
tr.clickable { cursor: pointer; }
tr.clickable:hover td { background: rgba(85, 178, 143, 0.06); }
.mono { font-family: ui-monospace, monospace; font-size: 11px; color: var(--ink-2); }
.pill { display: inline-block; padding: 1px 8px; border-radius: 99px; font-size: 11px; border: 1px solid var(--line); color: var(--ink-2); }
.pill.warn { color: var(--warn); border-color: rgba(208,146,90,0.4); }
#gate { display: grid; place-items: center; min-height: 60vh; }
#gate[hidden], #app[hidden], .card[hidden] { display: none; }
#gate .card { width: min(90%, 340px); display: grid; gap: 10px; }
input[type=password] { background: rgba(255,255,255,0.04); border: 1px solid var(--line); border-radius: 8px; color: var(--ink); padding: 9px 12px; font-size: 14px; }
button { background: var(--accent-soft); color: var(--ink); border: 1px solid rgba(85,178,143,0.4); border-radius: 8px; padding: 9px 12px; font-size: 13px; cursor: pointer; letter-spacing: 0.08em; }
#replay .turn { border-left: 2px solid var(--line); padding: 6px 0 6px 12px; margin: 6px 0; }
#replay .turn .meta { color: var(--ink-3); font-size: 11px; }
#replay .turn .act { color: var(--ink); }
.err { color: var(--warn); font-size: 12px; }
a.back { color: var(--accent); font-size: 12px; cursor: pointer; text-decoration: none; }
</style>
</head>
<body data-palette="#55b28f">
<div id="gate">
  <div class="card">
    <h2>DEEP RECORDS / 統計後台</h2>
    <input id="key" type="password" placeholder="管理金鑰" autocomplete="current-password" />
    <button id="enter">進入</button>
    <p id="gate-err" class="err" hidden>金鑰不正確</p>
  </div>
</div>
<div id="app" hidden>
  <h1>Deep Records <small>遊玩統計</small></h1>
  <div class="grid">
    <div class="tiles" id="tiles"></div>
    <div class="card"><h2>場景到達（不重複 SESSION）</h2><div class="bars" id="funnel"></div></div>
    <div class="card"><h2>結局分佈</h2><div class="bars" id="endings"></div></div>
    <div class="card"><h2>行動類型</h2><div class="bars" id="kinds"></div></div>
    <div class="card"><h2>回應來源與延遲</h2><table id="sources"></table></div>
    <div class="card" id="sessions-card"><h2>最近 SESSION（點擊回放）</h2><table id="sessions"></table></div>
    <div class="card" id="replay-card" hidden>
      <h2>SESSION 回放 <a class="back" id="back">← 返回列表</a></h2>
      <p class="mono" id="replay-id"></p>
      <div id="replay"></div>
    </div>
  </div>
</div>
<script>
const sceneOrder = ['000_prologue','001_apartment_entrance','002_friend_apartment','003_friend_apartment_livingroom','003_friend_bedroom','004_friend_kitchen','005_friend_bathroom','006_friend_balcony','007_landlord_apartment'];
const sceneNames = {
  '000_prologue':'楔子','001_apartment_entrance':'一樓入口','002_friend_apartment':'四樓門外',
  '003_friend_apartment_livingroom':'客廳','003_friend_bedroom':'臥室','004_friend_kitchen':'廚房',
  '005_friend_bathroom':'浴室','006_friend_balcony':'陽台','007_landlord_apartment':'五樓儀式'
};
const endingNames = {
  ending_ordinary_departure:'平庸的結局', ending_uneasy_departure:'揮之不去的不安',
  ending_surrendered_evidence:'被否定的真相', ending_suppressed_truth:'被清空的四樓',
  ending_truth_in_hand:'真相仍在手中', ending_buried_together:'兩具無名屍體',
  ending_great_witness:'偉大的見證者'
};
const kindNames = { option:'點選選項', free_text:'自由輸入', check_result:'擲骰回報', system:'系統回合' };
let adminKey = localStorage.getItem('dr-admin-key') || '';

async function api(path) {
  const res = await fetch(path, { headers: { 'x-admin-key': adminKey } });
  if (!res.ok) throw new Error(String(res.status));
  return res.json();
}

function bars(el, rows, nameOf) {
  const max = Math.max(1, ...rows.map(r => r.n));
  el.innerHTML = rows.map(r =>
    '<div class="bar-row" title="' + nameOf(r) + '：' + r.n + '">' +
      '<span class="lbl">' + nameOf(r) + '</span>' +
      '<span class="bar-track"><span class="bar-fill" style="width:' + (r.n / max * 100) + '%"></span></span>' +
      '<span class="val">' + r.n + '</span>' +
    '</div>'
  ).join('') || '<p class="mono">尚無資料</p>';
}

function fmtTime(ts) {
  return new Date(ts).toLocaleString('zh-TW', { hour12: false, month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

async function load() {
  const d = await api('/api/admin/stats');
  const t = d.totals;
  const completion = t.sessions ? Math.round(t.completed / t.sessions * 100) : 0;
  const fallbacks = (d.sources.find(s => s.turn_source === 'fallback') || {}).n || 0;
  const modelRow = d.sources.find(s => s.turn_source === 'model') || {};
  document.getElementById('tiles').innerHTML = [
    [t.sessions, '總 SESSION 數'],
    [t.turns, '總回合數'],
    [t.completed + '（' + completion + '%）', '抵達結局'],
    [(modelRow.avg_latency || 0) + ' ms', '模型平均延遲'],
    [fallbacks, 'FALLBACK 回合'],
  ].map(([n, l]) => '<div class="card tile"><div class="num">' + n + '</div><div class="lbl">' + l + '</div></div>').join('');

  const funnelRows = sceneOrder
    .map(id => ({ id, n: (d.funnel.find(f => f.scene_id === id) || {}).n || 0 }))
    .filter(r => r.n > 0 || sceneOrder.indexOf(r.id) < 4);
  bars(document.getElementById('funnel'), funnelRows, r => sceneNames[r.id] || r.id);
  bars(document.getElementById('endings'), d.endings.map(e => ({ ...e, n: e.n })), r => endingNames[r.ending_id] || r.ending_id);
  bars(document.getElementById('kinds'), d.kinds, r => kindNames[r.action_kind] || r.action_kind);

  document.getElementById('sources').innerHTML =
    '<tr><th>來源</th><th>回合數</th><th>平均延遲</th></tr>' +
    d.sources.map(s =>
      '<tr><td>' + (s.turn_source === 'fallback' ? '<span class="pill warn">fallback</span>' : s.turn_source) + '</td>' +
      '<td>' + s.n + '</td><td>' + (s.avg_latency || 0) + ' ms</td></tr>'
    ).join('');

  document.getElementById('sessions').innerHTML =
    '<tr><th>開始時間</th><th>回合</th><th>職業</th><th>結局</th><th>SESSION</th></tr>' +
    d.recent.map(s =>
      '<tr class="clickable" data-id="' + s.session_id + '">' +
      '<td>' + fmtTime(s.started_ts) + '</td><td>' + s.turns + '</td>' +
      '<td>' + (s.occupation || '—').replace('occupation_','') + '</td>' +
      '<td>' + (endingNames[s.ending_id] || '未完') + '</td>' +
      '<td class="mono">' + s.session_id.slice(0, 13) + '…</td></tr>'
    ).join('');

  document.querySelectorAll('tr.clickable').forEach(tr =>
    tr.addEventListener('click', () => replay(tr.dataset.id)));
}

async function replay(id) {
  const d = await api('/api/admin/session?id=' + encodeURIComponent(id));
  document.getElementById('sessions-card').hidden = true;
  const card = document.getElementById('replay-card');
  card.hidden = false;
  document.getElementById('replay-id').textContent = id;
  document.getElementById('replay').innerHTML = d.turns.map(t =>
    '<div class="turn">' +
    '<div class="meta">#' + t.turn_index + '　' + (sceneNames[t.scene_id] || t.scene_id) +
    '　' + (kindNames[t.action_kind] || t.action_kind) + '　' + t.turn_source +
    (t.latency_ms ? '　' + t.latency_ms + 'ms' : '') +
    '　SAN ' + (t.sanity ?? '—') + '　' + t.belief_stage +
    (t.ending_id ? '　→ ' + (endingNames[t.ending_id] || t.ending_id) : '') + '</div>' +
    '<div class="act">' + (t.player_action || '') + '</div>' +
    '</div>'
  ).join('');
}

document.getElementById('back').addEventListener('click', () => {
  document.getElementById('replay-card').hidden = true;
  document.getElementById('sessions-card').hidden = false;
});

async function tryEnter() {
  try {
    await api('/api/admin/stats');
    localStorage.setItem('dr-admin-key', adminKey);
    document.getElementById('gate').hidden = true;
    document.getElementById('app').hidden = false;
    load();
  } catch {
    document.getElementById('gate-err').hidden = false;
  }
}

document.getElementById('enter').addEventListener('click', () => {
  adminKey = document.getElementById('key').value.trim();
  tryEnter();
});
document.getElementById('key').addEventListener('keydown', e => {
  if (e.key === 'Enter') { adminKey = e.target.value.trim(); tryEnter(); }
});

const urlKey = new URLSearchParams(location.search).get('key');
if (urlKey) { adminKey = urlKey; tryEnter(); }
else if (adminKey) tryEnter();
</script>
</body>
</html>`
