# Deep Records

手機直式優先的單人 COC 跑團 Web 遊戲。玩家建立自己的調查者，由 AI（Gemini）擔任守密人，透過小說式敘事、行動選項、自由文字輸入與骰子檢定推進故事。

劇情、人物、場景、道具、結局與規則全部以 `scenarios/**/*.md` 的 markdown + frontmatter 設定，程式端由 codegen 產生內容註冊表。

## Tech Stack

- React + TypeScript + Vite（前端）
- Cloudflare Workers + Workers Static Assets（API 與靜態站台同一個 worker）
- Gemini（`gemini-3.5-flash`，structured output）
- Vitest（單元測試）

## Development

```bash
npm install
npm run dev:worker   # 終端機 A：wrangler dev（API，port 8787）
npm run dev          # 終端機 B：vite dev server（/api 會 proxy 到 8787）
```

本地要讓 AI 回合運作，需提供 Gemini 金鑰：在專案根目錄建立 `.dev.vars`：

```
GEMINI_API_KEY=your-key
```

## Test / Typecheck

```bash
npm test          # vitest
npm run typecheck # tsc -b（app / node / worker 三個 project）
```

## Deploy

```bash
npm run deploy    # generate + typecheck + vite build + vitest + wrangler deploy
```

正式站台與 API 皆為 `https://keeper.devlin-865.workers.dev`（`/api/keeper` 與 `/health` 走 worker，其餘路徑為 SPA 靜態資產）。`GEMINI_API_KEY` 以 `wrangler secret put GEMINI_API_KEY` 設定。

## Project Structure

```text
scenarios/            劇本內容（markdown + frontmatter，內容的唯一來源）
├── scene/            場景（connects_to / items_available / references）
├── item/             道具（once 等屬性）
├── ending/           結局（id / title / 觸發條件）
├── occupation/       職業
├── character/        NPC
├── faction/          陣營
└── *-rules.md        Keeper 參考規則（keeper_reference）

scripts/
└── generate-content.mjs   掃描 scenarios/ 產生 worker/generated/content.ts

shared/
└── keeper.ts         前後端共用的 Keeper 協定型別與 normalize

worker/
├── keeper.ts         入口：路由、rate limit、回合流程編排
├── config/           資料表：轉場規則、參考觸發、備援選項
├── core/             prompt / gemini / validate / deterministic / ending / sanitize
└── generated/        codegen 產物（勿手動編輯）

src/
├── features/investigation/   遊戲主流程、狀態 reducer、存檔、API client
├── layouts/ pages/ styles/   UI
└── types/                    前端型別（協定型別 re-export 自 shared/）

tests/                vitest 單元測試（validate / deterministic / content 完整性）
```

## 新增內容的方式

1. 在 `scenarios/` 對應資料夾新增 md 檔，填好 frontmatter（`id`、`type`、`title`，場景另需 `connects_to`、`items_available`、`references`）。
2. `npm run generate`（`dev` / `build` / `deploy` 都會自動執行）。
3. 若需要不經 LLM 的確定性轉場，在 `worker/config/transitions.ts` 加一條規則；測試會自動驗證它與 frontmatter 的 `connects_to` 一致。
