# Deep Records

手機直式優先的單人 COC 跑團 Web 遊戲骨架。玩家將建立自己的調查者，由 AI 擔任守密人，透過小說式敘事、行動選項、自由文字輸入與骰子檢定推進故事。

目前版本只建立可執行的前端基礎架構，尚未加入 AI API、會員、登入、資料庫或完整遊戲流程。

## Tech Stack

- React
- TypeScript
- Vite
- npm

## Development

```bash
npm install
npm run dev
```

## Production Build

```bash
npm run build
```

產物會輸出到 `dist/`，可作為後續部署到 Cloudflare 的靜態前端基礎。

## Project Structure

```text
src/
├── assets/
├── components/
├── features/
│   ├── character/
│   ├── dice/
│   └── investigation/
├── layouts/
├── pages/
├── styles/
├── types/
├── App.tsx
├── index.css
└── main.tsx
```
