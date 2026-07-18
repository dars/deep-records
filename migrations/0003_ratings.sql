-- 遊戲結束後的星級評分（每 session 一筆，重評覆蓋）
CREATE TABLE IF NOT EXISTS ratings (
  session_id TEXT PRIMARY KEY,
  rating REAL NOT NULL,
  ts INTEGER NOT NULL
);
